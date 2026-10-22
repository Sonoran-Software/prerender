const assert = require('assert');
const sinon = require('sinon');
const plugin = require('../../lib/plugins/skipRenderMedia');

describe('HTML render media filtering', function () {
  it('blocks media and only the exact TikTok analytics Script host', async function () {
    const Fetch = { requestPaused: sinon.spy(), enable: sinon.stub().resolves() };
    await new Promise(resolve => plugin.tabCreated({prerender:{renderType:'html',tab:{Fetch}}}, {}, resolve));
    assert.deepEqual(Fetch.enable.firstCall.args[0].patterns, [
      { resourceType: 'Image' },
      { resourceType: 'Media' },
      { resourceType: 'Font' },
      { resourceType: 'Script', urlPattern: 'https://analytics.tiktok.com/*' },
      { resourceType: 'Script', urlPattern: 'http://analytics.tiktok.com/*' },
    ]);
  });
  it('keeps media for screenshots and PDFs', function () {
    for (const renderType of ['png','jpeg','pdf','har']) {
      let continued = false;
      plugin.tabCreated({prerender:{renderType}}, {}, () => { continued = true; });
      assert(continued);
    }
  });
});
