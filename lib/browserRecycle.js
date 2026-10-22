const os = require('os');
const path = require('path');
const util = require('./util');

// Only planned idle recycling uses a warm replacement. Crash/error recovery
// still exposes the real disconnected state and follows the existing path.
class BrowserRecycle {
  constructor(server) {
    this.server = server;
    this.pending = null;
    this.retiring = null;
  }

  prepare() {
    const server = this.server;
    if (this.pending || this.retiring || server.isShuttingDown) return;
    const serving = server.browser;
    const candidate = server.createBrowser();
    const slot = serving.recycleSlot === 1 ? 0 : 1;
    const baseProfile = server.options.chromeUserDataDir || path.join(os.tmpdir(), 'prerender-chrome');
    candidate.recycleSlot = slot;
    const pending = this.pending = { candidate, serving };
    // Two bounded, reusable profiles; never reset the currently serving one.
    const options = { ...server.options, browserDebuggingPort: 0,
      chromeUserDataDir: slot === 0 ? baseProfile : baseProfile + '-recycle' };
    util.log('Preparing Chrome replacement', 'servingPid=' + serving.getPid());
    pending.deadline = setTimeout(() => this.discard(pending, 'replacement deadline'), 60000);
    pending.deadline.unref?.();
    Promise.resolve().then(() => {
      if (this.pending !== pending) throw new Error('replacement cancelled before spawn');
      return candidate.spawn(options);
    }).then(() => {
      server.listenForBrowserClose(candidate);
      if (this.pending !== pending) {
        this.retiring = candidate;
        return candidate.kill();
      }
      return candidate.connect();
    }).then(() => {
      if (this.pending !== pending) return;
      this.tryActivate(pending);
    }).catch(error => this.discard(pending, error?.message || 'startup failed'));
  }

  tryActivate(pending) {
    const server = this.server;
    if (this.pending !== pending) return;
    if (server.isShuttingDown || server.browser !== pending.serving ||
        !server.isBrowserConnected || !pending.candidate.getPid()) {
      return this.discard(pending, 'serving state changed');
    }
    // finish() removes in-flight accounting before async tab cleanup. Wait for
    // the render slot as well, so the old process owns every request to its end.
    if (server.browserRequestsInFlight.size || server.renderQueue.active || server.renderQueue.waiting.length) {
      pending.poll = setTimeout(() => this.tryActivate(pending), 25);
      pending.poll.unref?.();
      return;
    }
    clearTimeout(pending.deadline);
    this.pending = null;
    const previous = pending.serving;
    server.browser = pending.candidate;
    server.browserStartedAt = pending.candidate.startedAt;
    server.browserGeneration++;
    server.lastRestart = Date.now();
    server.healthState.lastRestartAt = Date.now();
    server.healthState.lastRestartReason = 'periodic-idle-check';
    server.healthState.restartInProgress = false;
    server.healthState.consecutiveRenderErrors = 0;
    this.retiring = previous;
    util.log('Activated Chrome replacement', 'generation=' + server.browserGeneration,
      'pid=' + server.browser.getPid(), 'retiringPid=' + previous.getPid());
    // Publication is synchronous and only happens after an owned CDP endpoint
    // responds. Health never reports a disconnected browser as connected.
    previous.kill();
    server.firePluginEvent('connectedToBrowser', { server }).catch(error => util.log(error));
  }

  discard(pending, reason) {
    if (this.pending !== pending) return;
    clearTimeout(pending.deadline);
    clearTimeout(pending.poll);
    this.pending = null;
    this.retiring = pending.candidate;
    util.log('Discarding Chrome replacement', 'reason=' + reason);
    pending.candidate.kill();
    if (!pending.candidate.getPid()) this.retiring = null;
  }

  onInactiveClose(browser) {
    if (this.pending?.candidate === browser) this.discard(this.pending, 'candidate exited');
    if (this.retiring === browser) this.retiring = null;
  }

  stop() {
    if (this.pending) this.discard(this.pending, 'server stopping or recovering');
    else if (this.retiring) this.retiring.kill();
  }
}

module.exports = BrowserRecycle;
