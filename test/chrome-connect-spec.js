const assert = require('assert');
const sinon = require('sinon');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

describe('owned ephemeral Chrome endpoint', function () {
  let clock, chrome, version, child;
  beforeEach(function () {
    clock = sinon.useFakeTimers();
    const filename = path.resolve(__dirname, '../lib/browsers/chrome.js');
    const realRequire = createRequire(filename);
    version = sinon.stub().resolves({ 'User-Agent':'fixture', Browser:'fixture',
      webSocketDebuggerUrl:'ws://127.0.0.1:19283/devtools/browser/owned-123' });
    const context = {module:{exports:{}}, process, setTimeout, clearTimeout, URL, console,
      require: name => name === 'chrome-remote-interface' ? {Version:version} :
        name === 'fs' ? {...fs, readFileSync:()=> '19283\n/devtools/browser/owned-123\n'} : realRequire(name)};
    vm.runInNewContext(fs.readFileSync(filename,'utf8'), context, {filename});
    chrome = context.module.exports;
    child = {pid:123,exitCode:null};
    chrome.chromeChild = child;
    chrome.options = {automaticDebuggingPort:true,browserDebuggingPort:0};
    chrome.userDataDir = '/fixture';
  });
  afterEach(function () {clock.restore();});
  it('connects only to the endpoint written by its isolated profile', async function () {
    const result = chrome.connect();
    await clock.tickAsync(501); await result;
    assert.equal(version.firstCall.args[0].port,19283);
    assert.equal(chrome.webSocketDebuggerURL,'ws://127.0.0.1:19283/devtools/browser/owned-123');
  });
  it('rejects a mismatched browser endpoint within the startup bound', async function () {
    version.resolves({webSocketDebuggerUrl:'ws://127.0.0.1:19283/devtools/browser/unowned'});
    const result = chrome.connect().then(()=>false,()=>true);
    await clock.tickAsync(20001);
    assert.equal(await result,true);
    assert.equal(chrome.webSocketDebuggerURL,undefined);
  });
  it('does not publish a connection after the owned process exits', async function () {
    let resolve;
    version.callsFake(()=>new Promise(r=>{resolve=r;}));
    const result = chrome.connect().then(()=>false,()=>true);
    await clock.tickAsync(501);
    child.exitCode=0;
    resolve({webSocketDebuggerUrl:'ws://127.0.0.1:19283/devtools/browser/owned-123'});
    await clock.tickAsync(20001);
    assert.equal(await result,true);
    assert.equal(chrome.webSocketDebuggerURL,undefined);
  });
});
