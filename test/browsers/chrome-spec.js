const chrome = require('../../lib/browsers/chrome'),
  sinon = require('sinon'),
  assert = require('assert'),
  fs = require('fs'),
  os = require('os'),
  path = require('path');

describe('chrome', function () {
  it('keeps polling readiness during navigation only while the target remains alive', async function () {
    chrome.options = { ...(chrome.options || {}), renderErrorStatusCode: 504 };
    const tab = {
      prerender: { renderType: 'html', requests: {}, domContentEventFired: true, errors: [], statusCode: 200 },
      Runtime: { evaluate: async () => { throw new Error('Inspected target navigated or closed'); } },
      Page: { getFrameTree: async () => ({ frameTree: { frame: { id: 'live' } } }) },
    };
    assert.equal(await chrome.checkIfPageIsDoneLoading(tab), false);
    assert.equal(tab.prerender.statusCode, 200);
    assert.deepStrictEqual(tab.prerender.errors, []);
    tab.Page.getFrameTree = async () => { throw new Error('Target closed'); };
    await assert.rejects(chrome.checkIfPageIsDoneLoading(tab));
    assert(tab.prerender.errors.includes('UnableToEvaluateJavascript'));
  });
  it('does not block a child that writes more than a pipe buffer', function (done) {
    this.timeout(6000);
    const { spawn } = require('node:child_process');
    const source = `
      const chrome = require('./lib/browsers/chrome');
      chrome.spawn({chromeLocation: process.execPath, chromeFlags: ['-e',
        'process.stdout.write(Buffer.alloc(1024*1024), () => process.stderr.write(Buffer.alloc(1024*1024), () => process.exit(0)))'
      ]}).then(() => {
        const timeout = setTimeout(() => { chrome.chromeChild.kill(); process.exit(1); }, 3000);
        chrome.chromeChild.once('exit', code => { clearTimeout(timeout); process.exit(code); });
      });`;
    // Discard the fixture's output, while exercising the real spawn path.
    const child = spawn(process.execPath, ['-e', source], {
      cwd: path.resolve(__dirname, '../..'), stdio: 'ignore', windowsHide: true,
    });
    child.once('error', done);
    child.once('exit', code => {
      try { assert.equal(code, 0); done(); } catch (err) { done(err); }
    });
  });
  describe('context cleanup', function () {
    it('closes both CDP connections even when disposing a context fails', async function () {
      const tab = {
        browserContextId: 'failed-context',
        close: sinon.stub().resolves(),
        browser: {
          Target: { disposeBrowserContext: sinon.stub().rejects(new Error('browser gone')) },
          close: sinon.stub().resolves(),
        },
      };
      await assert.rejects(chrome.closeTab(tab), /browser gone/);
      assert(tab.close.calledOnce);
      assert(tab.browser.close.calledOnce);
    });

    it('closes connections after a stalled dispose operation', async function () {
      const clock = sinon.useFakeTimers();
      try {
        const tab = {
          browserContextId: 'stuck-context',
          close: sinon.stub().resolves(),
          browser: {
            Target: { disposeBrowserContext: () => new Promise(() => {}) },
            close: sinon.stub().resolves(),
          },
        };
        const result = assert.rejects(chrome.closeTab(tab), /timed out/);
        await clock.tickAsync(5000);
        await result;
        assert(tab.close.calledOnce);
        assert(tab.browser.close.calledOnce);
      } finally { clock.restore(); }
    });
  });
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
      tab.Page.addScriptToEvaluateOnNewDocument = sandbox.stub().resolves();
      tab.Page.navigate = sandbox.stub();
      tab.Page.navigate.resolves(1);

      tab.Emulation = sandbox.stub();
      tab.Emulation.setDeviceMetricsOverride = sandbox.stub().resolves();

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
