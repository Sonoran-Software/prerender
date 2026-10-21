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
    assert.deepStrictEqual(result.requests[0], { origin: 'https://example.com', type: 'Document', responseStatus: 200 });
    assert.equal(result.requests[1].origin, 'data:');
    assert(!JSON.stringify(result).includes('secret'));
  });

  it('bounds output while preserving the total pending count', function () {
    const requests = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, 'https://example.com/']));
    const result = chrome.pendingRequestDiagnostics({ prerender: { requests, pageLoadInfo: { entries: {} } } });
    assert.equal(result.count, 20);
    assert.equal(result.requests.length, 12);
  });
});
