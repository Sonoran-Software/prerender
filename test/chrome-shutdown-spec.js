const assert = require('assert');
const sinon = require('sinon');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { EventEmitter } = require('events');

describe('bounded Chrome shutdown', function () {
  let clock, chrome, connect, kill, child, client;
  beforeEach(function () {
    clock = sinon.useFakeTimers();
    connect = sinon.stub();
    kill = sinon.stub();
    const filename = path.resolve(__dirname, '../lib/browsers/chrome.js');
    const realRequire = createRequire(filename);
    const context = {
      module: { exports: {} },
      require: name => name === 'chrome-remote-interface' ? connect : realRequire(name),
      process: { env: {}, kill }, setTimeout, clearTimeout, URL, console,
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    chrome = context.module.exports;
    child = Object.assign(new EventEmitter(), { pid: 12345 });
    chrome.chromeChild = child;
    chrome.webSocketDebuggerURL = 'ws://127.0.0.1:9222/devtools/browser/owned';
    client = { Browser: { close: sinon.stub().resolves() }, close: sinon.stub().resolves() };
    connect.resolves(client);
    chrome.onClose(() => {});
  });
  afterEach(function () { clock.restore(); });

  it('closes the exact browser through CDP without signals when it exits', async function () {
    client.Browser.close.callsFake(async () => child.emit('close', 0, null));
    chrome.kill();
    await clock.tickAsync(11000);
    assert.equal(connect.firstCall.args[0].target, 'ws://127.0.0.1:9222/devtools/browser/owned');
    assert(client.Browser.close.calledOnce);
    assert(client.close.called);
    assert(kill.notCalled);
  });

  it('retains bounded signal escalation if CDP acknowledges but Chrome stays alive', async function () {
    chrome.kill();
    await clock.tickAsync(999);
    assert(kill.notCalled);
    await clock.tickAsync(1);
    assert(kill.calledOnceWithExactly(-12345, 'SIGINT'));
    await clock.tickAsync(9000);
    assert(kill.calledWithExactly(-12345, 'SIGKILL'));
  });

  it('falls back immediately when no browser endpoint is available', async function () {
    chrome.webSocketDebuggerURL = undefined;
    chrome.kill();
    assert(connect.notCalled);
    assert(kill.calledOnceWithExactly(-12345, 'SIGINT'));
  });

  it('bounds a stalled CDP connection and closes a late connection without a command', async function () {
    let resolveConnection;
    connect.callsFake(() => new Promise(resolve => { resolveConnection = resolve; }));
    chrome.kill();
    await clock.tickAsync(1000);
    assert(kill.calledOnceWithExactly(-12345, 'SIGINT'));
    resolveConnection(client);
    await clock.tickAsync(1);
    assert(client.Browser.close.notCalled);
    assert(client.close.called);
  });

  it('falls back immediately if the CDP endpoint refuses the connection', async function () {
    connect.rejects(new Error('connection refused'));
    chrome.kill();
    await clock.tickAsync(0);
    assert(kill.calledOnceWithExactly(-12345, 'SIGINT'));
    await clock.tickAsync(1000);
    assert(kill.calledOnce);
  });

  it('does not send a late close command or signals to a replacement', async function () {
    let resolveConnection;
    connect.callsFake(() => new Promise(resolve => { resolveConnection = resolve; }));
    chrome.kill();
    child.emit('close', 0, null);
    chrome.chromeChild = Object.assign(new EventEmitter(), { pid: 67890 });
    resolveConnection(client);
    await clock.tickAsync(11000);
    assert(client.Browser.close.notCalled);
    assert(client.close.called);
    assert(kill.notCalled);
  });
});
