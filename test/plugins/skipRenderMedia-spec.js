const assert = require('assert');
const sinon = require('sinon');
const plugin = require('../../lib/plugins/skipRenderMedia');

describe('HTML render media filtering', function () {
  it('blocks media without intercepting scripts, styles or API requests', async function () {
    const Fetch = { requestPaused: sinon.spy(), enable: sinon.stub().resolves() };
    await new Promise(resolve => plugin.tabCreated({prerender:{renderType:'html',tab:{Fetch}}}, {}, resolve));
    assert.deepEqual(Fetch.enable.firstCall.args[0].patterns.map(p => p.resourceType), ['Image','Media','Font']);
  });
  it('keeps media for screenshots and PDFs', function () {
    for (const renderType of ['png','jpeg','pdf','har']) {
      let continued = false;
      plugin.tabCreated({prerender:{renderType}}, {}, () => { continued = true; });
      assert(continued);
    }
  });
});
