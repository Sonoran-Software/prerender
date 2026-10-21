const assert = require('assert');
const chrome = require('../../lib/browsers/chrome');

describe('pending request diagnostics', function () {
  it('identifies public build assets and request age without changing pending work', function () {
    const tab = { prerender: { requests: { a: 'https://user:secret@example.com/assets/js/CommunityDashboard.B_Z9-mPV.1.5.24-TGIRqgeE.js?token=secret#secret' },
      numRequestsInFlight: 1, pageLoadInfo: { entries: { a: { requestParams: { type: 'Script', wallTime: Date.now() / 1000 - 12, initiator: { type: 'script', url: 'https://example.com/private' } } } } } } };
    const result = chrome.pendingRequestDiagnostics(tab);
    assert.equal(result.requests[0].staticAsset, '/assets/js/CommunityDashboard.B_Z9-mPV.1.5.24-TGIRqgeE.js');
    assert.equal(result.requests[0].initiator, 'script');
    assert(result.requests[0].ageMs >= 12000 && result.requests[0].ageMs < 12500);
    assert(!JSON.stringify(result).includes('secret'));
    assert(!JSON.stringify(result).includes('private'));
    assert.equal(tab.prerender.numRequestsInFlight, 1);
    assert.equal(Object.keys(tab.prerender.requests).length, 1);
  });
  it('omits arbitrary paths, non-assets and malformed timing or initiators', function () {
    for (const [url, type] of [
      ['https://example.com/private/token.js', 'Script'],
      ['https://example.com/assets/js/nested/token.js', 'Script'],
      ['https://example.com/assets/js/' + 'x'.repeat(180) + '.js', 'Script'],
      ['https://example.com/assets/js/token.js', 'XHR'],
      ['https://example.com/assets/js/%73ecret.js', 'Script'],
    ]) {
      const result = chrome.pendingRequestDiagnostics({ prerender: { requests: { a: url }, pageLoadInfo: { entries: { a: { requestParams: { type, wallTime: Infinity, initiator: { type: 'secret' } } } } } } });
      assert.equal(result.requests[0].staticAsset, undefined);
      assert.equal(result.requests[0].ageMs, undefined);
      assert.equal(result.requests[0].initiator, undefined);
    }
  });
  it('retires only the replaced committed document in HTML after navigation', function () {
    const handlers = {};
    const Page = Object.fromEntries(['frameAttached','frameStartedLoading','frameStoppedLoading','frameDetached','frameNavigated'].map(name => [name, callback => { handlers[name] = callback; }]));
    const entries = {
      old: {requestParams:{frameId:'main',loaderId:'old',type:'Script'}},
      current: {requestParams:{frameId:'main',loaderId:'new',type:'Script'}},
      future: {requestParams:{frameId:'main',loaderId:'future',type:'Document'}},
      child: {requestParams:{frameId:'child',loaderId:'old',type:'XHR'}},
      unknown: {requestParams:{frameId:'main',type:'Fetch'}},
    };
    const tab={prerender:{renderType:'html',requests:Object.fromEntries(Object.keys(entries).map(id=>[id,'https://example.com/'])),numRequestsInFlight:5,pageLoadInfo:{entries},domContentEventFired:true,firstPrerenderReadyTime:1}};
    chrome.trackFrameDiagnostics(tab,Page);
    handlers.frameNavigated({frame:{id:'main',loaderId:'old'}});
    assert.equal(tab.prerender.numRequestsInFlight,5,'first observed document does not prove replacement');
    handlers.frameNavigated({frame:{id:'main',loaderId:'new'}});
    assert.deepStrictEqual(Object.keys(tab.prerender.requests),['current','future','child','unknown']);
    assert.equal(tab.prerender.numRequestsInFlight,4);
    assert.equal(tab.prerender.domContentEventFired,false);
    assert.equal(tab.prerender.firstPrerenderReadyTime,undefined);
    assert(entries.old,'keep HAR diagnostic history');
    handlers.frameNavigated({frame:{id:'main',loaderId:'new'}});
    assert.equal(tab.prerender.numRequestsInFlight,4,'duplicate event does not subtract twice');
    tab.prerender.renderType='har';
    handlers.frameNavigated({frame:{id:'main',loaderId:'future'}});
    assert.equal(tab.prerender.numRequestsInFlight,4,'leave non-HTML behavior unchanged');
  });
  it('keeps resource types and status without credentials, paths or query values', function () {
    const tab = { prerender: {
      requests: { a: 'https://user:secret@example.com/private/token?code=secret#secret', b: 'data:text/plain,secret' },
      pageLoadInfo: { entries: { a: { requestParams: { type: 'Document' }, responseParams: { response: { status: 200 } } } } },
    } };
    const result = chrome.pendingRequestDiagnostics(tab);
    assert.equal(result.count, 2);
    assert.deepStrictEqual(result.requests[0], { origin: 'https://example.com', type: 'Document', responseStatus: 200, document: 'unknown', frame: undefined });
    assert.equal(result.requests[1].origin, 'data:');
    assert(!JSON.stringify(result).includes('secret'));
  });

  it('distinguishes frame swaps from loading completion without clearing requests', function () {
    const handlers = {};
    const Page = Object.fromEntries(['frameAttached', 'frameStartedLoading', 'frameStoppedLoading', 'frameDetached', 'frameNavigated'].map(name => [name, callback => { handlers[name] = callback; }]));
    const tab = { prerender: { requests: { a: 'https://example.com/' }, numRequestsInFlight: 1,
      pageLoadInfo: { loadEventFiredMs: 123, entries: { a: { requestParams: { frameId: 'child', type: 'Document' } } } } } };
    chrome.trackFrameDiagnostics(tab, Page);
    handlers.frameStartedLoading({ frameId: 'child' });
    handlers.frameDetached({ frameId: 'child', reason: 'swap' });
    let result = chrome.pendingRequestDiagnostics(tab);
    assert.deepStrictEqual(result.requests[0].frame, { loading: true, detached: 'swap' });
    handlers.frameStoppedLoading({ frameId: 'child' });
    result = chrome.pendingRequestDiagnostics(tab);
    assert.deepStrictEqual(result.requests[0].frame, { loading: false, detached: 'swap' });
    assert.equal(result.pageLoadEventFired, true);
    assert.equal(result.count, 1);
    assert.equal(tab.prerender.numRequestsInFlight, 1);
    for (let i = 0; i < 150; i++) handlers.frameStartedLoading({ frameId: String(i) });
    assert.equal(tab.prerender.frameDiagnostics.size, 100);
  });

  it('distinguishes replaced document requests without dropping pending work', function () {
    const handlers = {};
    const Page = Object.fromEntries(['frameAttached', 'frameStartedLoading', 'frameStoppedLoading', 'frameDetached', 'frameNavigated'].map(name => [name, callback => { handlers[name] = callback; }]));
    const tab = { prerender: { requests: { old: 'https://example.com/old.js', current: 'https://example.com/new.js' }, numRequestsInFlight: 2,
      pageLoadInfo: { entries: {
        old: { requestParams: { frameId: 'main', loaderId: 'old', type: 'Script' } },
        current: { requestParams: { frameId: 'main', loaderId: 'new', type: 'Script' } },
      } } } };
    chrome.trackFrameDiagnostics(tab, Page);
    handlers.frameNavigated({ frame: { id: 'main', loaderId: 'old' } });
    handlers.frameNavigated({ frame: { id: 'main', loaderId: 'new', url: 'https://example.com/?code=secret' } });
    const result = chrome.pendingRequestDiagnostics(tab);
    assert.deepStrictEqual(result.requests.map(request => request.document), ['previous', 'current']);
    assert.equal(tab.prerender.numRequestsInFlight, 2);
    assert.equal(Object.keys(tab.prerender.requests).length, 2);
    assert(!JSON.stringify(result).includes('secret'));
    for (let i = 0; i < 150; i++) handlers.frameNavigated({ frame: { id: String(i), loaderId: 'new' } });
    assert.equal(tab.prerender.frameLoaderIds.size, 100);
  });

  it('reconciles only swapped child documents after their own load event', async function () {
    const tab = { prerender: { renderType: 'html', initialRequestId: 'main', numRequestsInFlight: 6,
      requests: Object.fromEntries(['main', 'swap', 'xhr', 'same', 'removed', 'no-response'].map(id => [id, 'https://example.com/'])),
      frameDiagnostics: new Map([['child', { isChild: true, detached: 'swap' }], ['removed', { isChild: true, detached: 'remove' }]]),
      pageLoadInfo: { entries: {} } } };
    for (const id of Object.keys(tab.prerender.requests)) tab.prerender.pageLoadInfo.entries[id] = {
      requestParams: { type: id === 'xhr' ? 'XHR' : 'Document', frameId: id === 'same' ? 'same' : id === 'removed' ? 'removed' : 'child' },
      responseParams: id === 'no-response' ? undefined : { response: { status: 200 } },
    };
    let loaded = false;
    let released = 0;
    tab.DOM = { getFrameOwner: async () => ({ backendNodeId: 1 }), resolveNode: async () => ({ object: { objectId: 'frame' } }) };
    tab.Runtime = { callFunctionOn: async () => ({ result: { value: loaded } }), releaseObject: async () => { released++; } };
    assert.equal(await chrome.reconcileSwappedDocuments(tab), 0);
    tab.prerender.pageLoadInfo.loadEventFiredMs = 123;
    assert.equal(await chrome.reconcileSwappedDocuments(tab), 0, 'parent load does not complete the iframe');
    loaded = true;
    tab.prerender.renderType = 'pdf';
    assert.equal(await chrome.reconcileSwappedDocuments(tab), 0);
    tab.prerender.renderType = 'html';
    assert.equal(await chrome.reconcileSwappedDocuments(tab), 1);
    assert(!tab.prerender.requests.swap);
    assert.equal(tab.prerender.numRequestsInFlight, 5);
    assert.equal(await chrome.reconcileSwappedDocuments(tab), 0);
    assert.equal(released, 3);
    assert.equal(tab.prerender.numRequestsInFlight, 5);
    assert.deepStrictEqual(Object.keys(tab.prerender.requests), ['main', 'xhr', 'same', 'removed', 'no-response']);
  });

  it('observes individual iframe loads and invalidates them on navigation', function () {
    const vm = require('vm');
    let listener, changed;
    // Element load events never propagate to Window, even in capture phase.
    const window = {};
    const document = { addEventListener: (name, callback, capture) => {
      assert.equal(name, 'load');
      assert.equal(capture, true);
      listener = callback;
    } };
    class MutationObserver { constructor(callback) { changed = callback; } observe() {} }
    vm.runInNewContext(chrome.iframeLoadTrackerSource, { window, document, MutationObserver });
    const frame = { tagName: 'IFRAME', src: 'https://example.com/one' };
    assert.equal(window.__prerenderFrameLoads.has(frame), false);
    listener({ target: window });
    assert.equal(window.__prerenderFrameLoads.has(frame), false);
    listener({ target: frame });
    assert.equal(window.__prerenderFrameLoads.get(frame), frame.src);
    frame.src = 'https://example.com/two';
    changed([{ target: frame }]);
    assert.equal(window.__prerenderFrameLoads.has(frame), false);
    listener({ target: frame });
    assert.equal(window.__prerenderFrameLoads.get(frame), frame.src);
    changed([{ target: frame }]); // Same-URL reload also invalidates completion.
    assert.equal(window.__prerenderFrameLoads.has(frame), false);
  });

  it('does not double-decrement a document completed while its owner is inspected', async function () {
    let released = false;
    const tab = { prerender: { renderType: 'html', requests: { a: 'https://example.com/' }, numRequestsInFlight: 1,
      frameDiagnostics: new Map([['child', { isChild: true, detached: 'swap' }]]),
      pageLoadInfo: { entries: { a: { requestParams: { type: 'Document', frameId: 'child' }, responseParams: { response: { status: 200 } } } } } },
      DOM: { getFrameOwner: async () => ({ backendNodeId: 1 }), resolveNode: async () => ({ object: { objectId: 'owner' } }) },
      Runtime: { callFunctionOn: async () => {
        delete tab.prerender.requests.a;
        tab.prerender.numRequestsInFlight--;
        return { result: { value: true } };
      }, releaseObject: async () => { released = true; } },
    };
    assert.equal(await chrome.reconcileSwappedDocuments(tab), 0);
    assert.equal(tab.prerender.numRequestsInFlight, 0);
    assert.equal(released, true);
  });

  it('bounds output while preserving the total pending count', function () {
    const requests = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, 'https://example.com/']));
    const result = chrome.pendingRequestDiagnostics({ prerender: { requests, pageLoadInfo: { entries: {} } } });
    assert.equal(result.count, 20);
    assert.equal(result.requests.length, 12);
  });
});
