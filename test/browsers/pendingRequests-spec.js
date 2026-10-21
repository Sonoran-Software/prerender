const assert = require('assert');
const chrome = require('../../lib/browsers/chrome');

describe('pending request diagnostics', function () {
  it('keeps resource types and status without credentials, paths or query values', function () {
    const tab = { prerender: {
      requests: { a: 'https://user:secret@example.com/private/token?code=secret#secret', b: 'data:text/plain,secret' },
      pageLoadInfo: { entries: { a: { requestParams: { type: 'Document' }, responseParams: { response: { status: 200 } } } } },
    } };
    const result = chrome.pendingRequestDiagnostics(tab);
    assert.equal(result.count, 2);
    assert.deepStrictEqual(result.requests[0], { origin: 'https://example.com', type: 'Document', responseStatus: 200, frame: undefined });
    assert.equal(result.requests[1].origin, 'data:');
    assert(!JSON.stringify(result).includes('secret'));
  });

  it('distinguishes frame swaps from loading completion without clearing requests', function () {
    const handlers = {};
    const Page = Object.fromEntries(['frameAttached', 'frameStartedLoading', 'frameStoppedLoading', 'frameDetached'].map(name => [name, callback => { handlers[name] = callback; }]));
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

  it('reconciles only swapped child documents after the page load event', function () {
    const tab = { prerender: { renderType: 'html', initialRequestId: 'main', numRequestsInFlight: 6,
      requests: Object.fromEntries(['main', 'swap', 'xhr', 'same', 'removed', 'no-response'].map(id => [id, 'https://example.com/'])),
      frameDiagnostics: new Map([['child', { isChild: true, detached: 'swap' }], ['removed', { isChild: true, detached: 'remove' }]]),
      pageLoadInfo: { entries: {} } } };
    for (const id of Object.keys(tab.prerender.requests)) tab.prerender.pageLoadInfo.entries[id] = {
      requestParams: { type: id === 'xhr' ? 'XHR' : 'Document', frameId: id === 'same' ? 'same' : id === 'removed' ? 'removed' : 'child' },
      responseParams: id === 'no-response' ? undefined : { response: { status: 200 } },
    };
    assert.equal(chrome.reconcileSwappedDocuments(tab), 0);
    tab.prerender.pageLoadInfo.loadEventFiredMs = 123;
    tab.prerender.renderType = 'pdf';
    assert.equal(chrome.reconcileSwappedDocuments(tab), 0);
    tab.prerender.renderType = 'html';
    assert.equal(chrome.reconcileSwappedDocuments(tab), 1);
    assert(!tab.prerender.requests.swap);
    assert.equal(tab.prerender.numRequestsInFlight, 5);
    assert.equal(chrome.reconcileSwappedDocuments(tab), 0);
    assert.equal(tab.prerender.numRequestsInFlight, 5);
    assert.deepStrictEqual(Object.keys(tab.prerender.requests), ['main', 'xhr', 'same', 'removed', 'no-response']);
  });

  it('bounds output while preserving the total pending count', function () {
    const requests = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, 'https://example.com/']));
    const result = chrome.pendingRequestDiagnostics({ prerender: { requests, pageLoadInfo: { entries: {} } } });
    assert.equal(result.count, 20);
    assert.equal(result.requests.length, 12);
  });
});
