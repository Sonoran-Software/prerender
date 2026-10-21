const assert = require('assert');
const sinon = require('sinon');

const plugin = require('../../lib/plugins/skipStaticAssets');

describe('skipStaticAssets plugin', function () {
  it('rejects observed filesystem and deployment probes while preserving page routes', function () {
    const probes = [
      '/proc/self/environ?raw?&', '/api/proc/self/environ',
      '/proc/self/cgroup', '/terraform.tfstate', '/terraform.tfstate.backup',
      '/@fs/var/run/secrets/kubernetes.io/serviceaccount/ca.crt?raw?&',
      '/%40fs/etc/passwd', '/__vite_rsc_findSourceMapURL?filename=file:///proc/self/environ&environmentName=rsc',
      '/userfiles/x?path=../../../../proc/self/environ',
      '/*.auto.tfvars', '/key.pem', '/id_rsa', '/privatekey.key',
      '/railway.toml', '/docker-compose.yml', '/docker-compose.dev.yml',
      '/supabase/config.toml', '/config/env/aws_credentials.env',
    ];
    for (const target of probes) {
      const send = sinon.spy();
      const next = sinon.spy();
      plugin.requestReceived({prerender: {url: 'https://community.sonorancms.com' + target}}, {send}, next);
      assert(send.calledOnceWithExactly(404), target);
      assert(!next.called, target);
    }
    for (const target of ['/blog/', '/news/', '/press/', '/site/', '/erlc',
      '/compare/imperialcad', '/discovery/community/omega-roleplay-v3',
      '/login?community=abc', '/userfiles/x?path=community/rules',
      '/.well-known/oauth-authorization-server']) {
      const send = sinon.spy();
      const next = sinon.spy();
      plugin.requestReceived({prerender: {url: 'https://community.sonorancms.com' + target}}, {send}, next);
      assert(next.calledOnce, target);
      assert(!send.called, target);
    }
  });
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
