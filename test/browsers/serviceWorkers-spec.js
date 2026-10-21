const assert = require('assert');
const vm = require('vm');
const chrome = require('../../lib/browsers/chrome');

describe('HTML service worker isolation', function () {
  it('prevents feature-detected registration without changing other navigator APIs', function () {
    let registrations = 0;
    class Navigator {}
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true, get: () => ({ register: () => registrations++ }),
    });
    Navigator.prototype.userAgent = 'Chrome';
    const navigator = new Navigator();
    const context = { Navigator, navigator };
    vm.runInNewContext(chrome.disableServiceWorkerSource, context);
    vm.runInNewContext("if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')", context);
    assert.equal(registrations, 0);
    assert.equal(navigator.userAgent, 'Chrome');
    vm.runInNewContext(chrome.disableServiceWorkerSource, context);
  });

  it('installs the prevention before navigation only for HTML with worker bypass', async function () {
    const oldOptions = chrome.options;
    try {
      for (const [renderType, enabled, override, expectedBypass, expectedScript] of [
        ['html', undefined, undefined, true, true],
        ['html', true, undefined, false, false],
        ['html', 'true', undefined, false, false],
        ['html', true, false, true, true],
        ['html', false, true, false, false],
        ['har', false, undefined, true, false],
        ['png', false, undefined, true, false],
      ]) {
        const calls = [];
        chrome.options = { enableServiceWorker: enabled };
        await chrome.configureServiceWorkers({
          prerender: { renderType, enableServiceWorker: override },
          Network: { setBypassServiceWorker: async value => calls.push(value) },
          Page: { addScriptToEvaluateOnNewDocument: async value => calls.push(value) },
          Target: { attachedToTarget: () => {}, setAutoAttach: async () => {} },
        });
        assert.deepStrictEqual(calls[0], { bypass: expectedBypass });
        assert.equal(calls.length, expectedScript ? 2 : 1);
        if (expectedScript) assert.equal(calls[1].source, chrome.disableServiceWorkerSource);
      }
    } finally { chrome.options = oldOptions; }
  });

  it('prepares child and nested frames before resuming, without modifying workers', async function () {
    const calls = [];
    const tab = { send: async (method, params, sessionId) => { calls.push({method,params,sessionId}); } };
    await chrome.prepareChildServiceWorkers(tab, {sessionId:'child',targetInfo:{type:'iframe'}});
    assert.deepStrictEqual(calls.map(c=>c.method), ['Page.enable','Page.addScriptToEvaluateOnNewDocument','Target.setAutoAttach','Runtime.runIfWaitingForDebugger']);
    assert(calls.every(c=>c.sessionId==='child'));
    calls.length=0;
    await chrome.prepareChildServiceWorkers(tab, {sessionId:'worker',targetInfo:{type:'worker'}});
    assert.deepStrictEqual(calls.map(c=>c.method), ['Runtime.runIfWaitingForDebugger']);
  });

  it('resumes a child even when setup fails or the child closes', async function () {
    const calls=[];
    const tab={send:async method=>{calls.push(method);throw new Error('Target closed');}};
    await chrome.prepareChildServiceWorkers(tab,{sessionId:'gone',targetInfo:{type:'iframe'}});
    assert.deepStrictEqual(calls,['Page.enable','Runtime.runIfWaitingForDebugger']);
  });
});
