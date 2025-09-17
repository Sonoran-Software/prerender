const assert = require('assert');
const sinon = require('sinon');

const plugin = require('../../lib/plugins/blockRedirectLoopAssets');

describe('blockRedirectLoopAssets plugin', function () {
  beforeEach(function () {
    if (typeof plugin.init === 'function') {
      plugin.init();
    }
  });

  it('should short circuit requests ending in =404', function () {
    const send = sinon.spy();
    const req = {
      prerender: {
        url: 'https://example.com/assets/js/=404',
      },
    };

    plugin.requestReceived(req, { send }, () => {
      throw new Error('next should not be called');
    });

    assert.strictEqual(send.calledOnce, true);
    assert.strictEqual(send.firstCall.args[0], 404);
    assert.strictEqual(req.prerender.statusCodeReason, 'redirect loop filtered');
  });

  it('should allow non-matching requests to proceed', function (done) {
    const req = {
      prerender: {
        url: 'https://example.com/assets/js/app.js',
      },
    };

    plugin.requestReceived(
      req,
      { send: () => done(new Error('send should not be called')) },
      () => done(),
    );
  });

  it('should ignore invalid URLs', function (done) {
    const req = {
      prerender: {
        url: '::::',
      },
    };

    plugin.requestReceived(
      req,
      { send: () => done(new Error('send should not be called')) },
      () => done(),
    );
  });
});
