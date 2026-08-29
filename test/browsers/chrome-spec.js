const chrome = require('../../lib/browsers/chrome'),
  sinon = require('sinon'),
  assert = require('assert'),
  fs = require('fs'),
  os = require('os'),
  path = require('path');

describe('chrome', function () {
  describe('getChromeFlags', function () {
    let userDataDir;

    beforeEach(function () {
      userDataDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'prerender-chrome-test-'),
      );
    });

    afterEach(function () {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    });

    it('resets and reuses a managed Chrome profile directory', function () {
      const staleDirectory = path.join(userDataDir, 'scoped_dir_stale');
      fs.mkdirSync(staleDirectory);
      fs.writeFileSync(path.join(staleDirectory, 'cache'), 'stale');

      const flags = chrome.getChromeFlags({
        browserDebuggingPort: 9222,
        chromeUserDataDir: userDataDir,
      });

      assert(flags.includes('--user-data-dir=' + userDataDir));
      assert.deepStrictEqual(fs.readdirSync(userDataDir), []);
    });

    it('refuses to remove a Chrome profile outside the temp directory', function () {
      assert.throws(
        () =>
          chrome.getChromeFlags({
            browserDebuggingPort: 9222,
            chromeUserDataDir: path.parse(os.tmpdir()).root,
          }),
        /must be inside the temp directory/,
      );
    });
  });

  describe('loadUrlThenWaitForPageLoadEvent', function () {
    let tab;
    let sandbox;

    beforeEach(function () {
      sandbox = sinon.createSandbox();

      tab = sandbox.stub();
      tab.prerender = sandbox.stub();
      tab.prerender.pageDoneCheckInterval = 1000;
      tab.prerender.pageLoadTimeout = 1;

      tab.Page = sandbox.stub();
      tab.Page.enable = sandbox.stub();
      tab.Page.enable.resolves(1);
      tab.Page.addScriptToEvaluateOnNewDocument = sandbox.stub();
      tab.Page.navigate = sandbox.stub();
      tab.Page.navigate.resolves(1);

      tab.Emulation = sandbox.stub();
      tab.Emulation.setDeviceMetricsOverride = sandbox.stub();

      chrome.options = chrome.options || {};
    });

    afterEach(function () {
      sandbox.restore();
    });

    it('Should NOT change tabs status code', async function () {
      const expectedStatusCode = 123;
      tab.prerender.statusCode = expectedStatusCode;

      await chrome.loadUrlThenWaitForPageLoadEvent(tab, 'the-url');

      assert.strictEqual(tab.prerender.statusCode, expectedStatusCode);
    });

    it('Should change tabs status code to the predefined value', async function () {
      const expectedStatusCode = 222;
      tab.prerender.statusCode = 111;
      tab.prerender.timeoutStatusCode = expectedStatusCode;

      await chrome.loadUrlThenWaitForPageLoadEvent(tab, 'the-url');

      assert.strictEqual(tab.prerender.statusCode, expectedStatusCode);
    });
  });
});
