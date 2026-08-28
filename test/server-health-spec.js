const assert = require('assert');
const sinon = require('sinon');
const server = require('../lib/server');

describe('server health and render outcomes', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    server.init({
      consecutiveErrorThreshold: 5,
      healthCheckConsecutiveErrorThreshold: 5,
      healthCheckUrl: 'http://127.0.0.1:1/unreachable',
      renderErrorStatusCode: 504,
    });
    server.healthState = {
      consecutiveRenderErrors: 0,
      lastErrorAt: null,
      lastErrorReason: null,
      lastErrorStatusCode: null,
      lastErrorUrl: null,
      lastErrorStreak: 0,
      lastSuccessfulRenderAt: null,
      lastRestartAt: null,
      lastRestartReason: null,
      restartInProgress: false,
    };
    server.browserRequestsInFlight = new Map();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('keeps liveness healthy when only page-level diagnostics are failing', async function () {
    server.isBrowserConnected = true;
    server.healthState.consecutiveRenderErrors = 9;

    const status = await server.healthCheck({ liveness: true });

    assert.equal(status.browserConnected, true);
    assert.equal(status.consecutiveRenderErrors, 9);
    assert.equal(status.latencyMs, 0);
  });

  it('fails liveness when Chrome is disconnected', async function () {
    server.isBrowserConnected = false;

    await assert.rejects(
      server.healthCheck({ liveness: true }),
      (err) => err.code === 'HEALTHCHECK_BROWSER_DISCONNECTED',
    );
  });

  it('treats a successful page-load cutoff as a successful render', function () {
    server.recordRequestOutcome({
      prerender: {
        statusCode: 200,
        timedout: true,
        cancelled: false,
        errors: [],
        url: 'https://example.com/',
      },
    });

    assert.equal(server.healthState.consecutiveRenderErrors, 0);
    assert.ok(server.healthState.lastSuccessfulRenderAt);
  });

  it('still counts a cancelled outer request timeout as a render failure', function () {
    server.recordRequestOutcome({
      prerender: {
        statusCode: 200,
        timedout: true,
        cancelled: true,
        errors: [],
        url: 'https://example.com/',
      },
    });

    assert.equal(server.healthState.consecutiveRenderErrors, 1);
    assert.equal(server.healthState.lastErrorReason, 'request timed out');
  });
});
