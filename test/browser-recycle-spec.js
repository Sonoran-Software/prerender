const assert = require('assert');
const sinon = require('sinon');
const server = require('../lib/server');

describe('periodic browser replacement', function () {
  let clock, sandbox, old, next, connectResolve;
  function browser(pid) {
    return { name: 'Chrome', version: 'fixture', options: {},
      getPid: () => pid, kill: sinon.spy(), spawn: sinon.stub().resolves(),
      onClose(callback) { this.closed = () => { pid = null; callback(0, null, pid); }; },
    };
  }
  beforeEach(function () {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    server.init({ healthCheckUrl: 'http://127.0.0.1:1' });
    old = browser(1); next = browser(2);
    next.connect = () => new Promise(resolve => { connectResolve = resolve; });
    server.browser = old;
    server.isBrowserConnected = true;
    server.listenForBrowserClose();
    // The factory belongs to the server so tests never launch Chrome.
    server.createBrowser = () => next;
  });
  afterEach(function () { server.killBrowser(); sandbox.restore(); });

  it('copies required page instrumentation without sharing process state', function () {
    const chrome = require('../lib/browsers/chrome');
    const instance = chrome.createInstance();
    assert.equal(instance.iframeLoadTrackerSource, chrome.iframeLoadTrackerSource);
    assert.equal(typeof instance.iframeLoadTrackerSource, 'string');
    assert.equal(instance.chromeChild, undefined);
    assert.equal(instance.options, undefined);
  });

  it('does not create more than one replacement at a time', async function () {
    const factory = sinon.spy(server, 'createBrowser');
    server.restartBrowser('periodic-idle-check');
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    assert.equal(factory.callCount, 1);
    connectResolve();
    await clock.tickAsync(30);
    server.restartBrowser('periodic-idle-check');
    assert.equal(factory.callCount, 1, 'wait for retired process exit before reusing its profile');
  });

  it('does not spawn a candidate cancelled before its launch microtask', async function () {
    server.restartBrowser('periodic-idle-check');
    server.killBrowser();
    await clock.tickAsync(30);
    assert.equal(next.spawn.callCount, 0);
  });

  it('keeps the serving browser if the candidate exits before connecting', async function () {
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    next.closed();
    connectResolve();
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    assert.equal(server.isBrowserConnected, true);
    assert.equal(old.kill.callCount, 0);
  });

  it('still fails health on a real serving-browser crash during preparation', async function () {
    const recover = sandbox.stub(server, 'startPrerender').resolves();
    await clock.tickAsync(1001);
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    old.closed();
    assert.equal(server.isBrowserConnected, false);
    await assert.rejects(server.healthCheck({ liveness: true }),
      error => error.code === 'HEALTHCHECK_BROWSER_DISCONNECTED');
    connectResolve();
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    assert.equal(recover.callCount, 1);
    assert.equal(next.kill.callCount, 1);
  });

  it('handles startup rejection without an error object', async function () {
    next.spawn = () => Promise.reject();
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    assert.equal(server.isBrowserConnected, true);
    assert.equal(old.kill.callCount, 0);
  });

  it('keeps the serving browser connected until a replacement is ready', async function () {
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    assert.equal(old.kill.callCount, 0);
    assert.equal((await server.healthCheck({ liveness: true })).browserConnected, true);
    assert.equal(server.browser, old);
    connectResolve();
    await clock.tickAsync(30);
    assert.equal(server.browser, next);
    assert.equal(server.browserGeneration, 1);
    assert.equal(old.kill.callCount, 1);
    old.closed();
    assert.equal(server.isBrowserConnected, true);
  });

  it('waits for active render cleanup and in-flight requests before swapping', async function () {
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    server.renderQueue.active = 1;
    server.browserRequestsInFlight.set('active', 'https://example.com');
    connectResolve();
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    server.browserRequestsInFlight.clear();
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    server.renderQueue.active = 0;
    await clock.tickAsync(30);
    assert.equal(server.browser, next);
  });

  it('keeps the healthy browser if replacement startup fails', async function () {
    next.connect = sinon.stub().rejects(new Error('fixture startup failed'));
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    assert.equal(server.isBrowserConnected, true);
    assert.equal(old.kill.callCount, 0);
    assert.equal(next.kill.callCount, 1);
  });

  it('bounds replacement lifetime when existing work never becomes idle', async function () {
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    server.renderQueue.active = 1;
    connectResolve();
    await clock.tickAsync(60001);
    assert.equal(server.browser, old);
    assert.equal(old.kill.callCount, 0);
    assert.equal(next.kill.callCount, 1);
  });

  it('does not adopt a late candidate after shutdown', async function () {
    server.restartBrowser('periodic-idle-check');
    await clock.tickAsync(1);
    server.isShuttingDown = true;
    server.killBrowser();
    connectResolve();
    await clock.tickAsync(30);
    assert.equal(server.browser, old);
    assert.equal(next.kill.callCount, 1);
  });
});
