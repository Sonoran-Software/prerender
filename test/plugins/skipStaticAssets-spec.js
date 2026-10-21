const assert = require('assert');
const sinon = require('sinon');

const plugin = require('../../lib/plugins/skipStaticAssets');

describe('skipStaticAssets plugin', function () {
  it('rejects WordPress probes without rejecting community pages', function () {
    plugin.init();
    for (const path of ['/blog/?rest_route=/', '/press/wp-json/', '/wp-admin/', '/wp-login.php', '/xmlrpc.php']) {
      const send = sinon.spy();
      const next = sinon.spy();
      plugin.requestReceived({prerender: {url: 'https://community.sonorancms.com' + path}}, {send}, next);
      assert(send.calledOnceWithExactly(404), path);
      assert(!next.called, path);
    }
    for (const path of ['/blog/', '/news/', '/press/', '/erlc', '/compare/melonly', '/login?community=abc']) {
      const send = sinon.spy();
      const next = sinon.spy();
      plugin.requestReceived({prerender: {url: 'https://community.sonorancms.com' + path}}, {send}, next);
      assert(next.calledOnce, path);
      assert(!send.called, path);
    }
  });
  beforeEach(function () {
    delete process.env.PRERENDER_ALLOW_HIDDEN_PATH_SEGMENTS;
    if (typeof plugin.init === 'function') {
      plugin.init();
    }
  });

  it('should short circuit obvious hidden file probes', function () {
    const send = sinon.spy();
    const req = {
      prerender: {
        url: 'https://example.com/.git/config',
      },
    };

    plugin.requestReceived(req, { send }, () => {
      throw new Error('next should not be called');
    });

    assert.strictEqual(send.calledOnce, true);
    assert.strictEqual(send.firstCall.args[0], 404);
    assert.strictEqual(req.prerender.statusCodeReason, 'hidden path filtered');
  });

  it('should allow .well-known routes to proceed', function (done) {
    const req = {
      prerender: {
        url: 'https://example.com/.well-known/oauth-authorization-server',
      },
    };

    plugin.requestReceived(
      req,
      { send: () => done(new Error('send should not be called')) },
      () => done(),
    );
  });

  it('should still short circuit static assets', function () {
    const send = sinon.spy();
    const req = {
      prerender: {
        url: 'https://example.com/assets/app.js',
      },
    };

    plugin.requestReceived(req, { send }, () => {
      throw new Error('next should not be called');
    });

    assert.strictEqual(send.calledOnce, true);
    assert.strictEqual(send.firstCall.args[0], 404);
    assert.strictEqual(req.prerender.statusCodeReason, 'static asset filtered');
  });
});
