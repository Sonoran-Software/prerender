const util = require('./util.js');
const { version: prerenderVersion } = require('../package.json');
const validUrl = require('valid-url');
const { v4: uuidv4 } = require('uuid');

const WAIT_AFTER_LAST_REQUEST = process.env.WAIT_AFTER_LAST_REQUEST || 500;

const PAGE_DONE_CHECK_INTERVAL = process.env.PAGE_DONE_CHECK_INTERVAL || 500;

const PAGE_LOAD_TIMEOUT = process.env.PAGE_LOAD_TIMEOUT || 20 * 1000;

const FOLLOW_REDIRECTS = process.env.FOLLOW_REDIRECTS || false;

const LOG_REQUESTS = process.env.LOG_REQUESTS || false;

const CAPTURE_CONSOLE_LOG = process.env.CAPTURE_CONSOLE_LOG || false;

const ENABLE_SERVICE_WORKER = process.env.ENABLE_SERVICE_WORKER || false;

const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT, 10) || 60000;

//try to restart the browser only if there are zero requests in flight
const BROWSER_TRY_RESTART_PERIOD =
  process.env.BROWSER_TRY_RESTART_PERIOD || 600000;

const BROWSER_DEBUGGING_PORT = process.env.BROWSER_DEBUGGING_PORT || 9222;

const TIMEOUT_STATUS_CODE = process.env.TIMEOUT_STATUS_CODE;
const RENDERING_ERROR_STATUS_CODE = process.env.RENDERING_ERROR_STATUS_CODE || 504;

const PARSE_SHADOW_DOM = process.env.PARSE_SHADOW_DOM || false;

const server = {};

server.init = function (options) {
  this.plugins = this.plugins || [];
  this.options = options || {};
  this.browserStartedAt = null;
  this.isShuttingDown = false;

  this.options.waitAfterLastRequest =
    this.options.waitAfterLastRequest || WAIT_AFTER_LAST_REQUEST;
  this.options.pageDoneCheckInterval =
    this.options.pageDoneCheckInterval || PAGE_DONE_CHECK_INTERVAL;
  this.options.pageLoadTimeout =
    this.options.pageLoadTimeout || PAGE_LOAD_TIMEOUT;
  this.options.followRedirects =
    this.options.followRedirects || FOLLOW_REDIRECTS;
  this.options.logRequests = this.options.logRequests || LOG_REQUESTS;
  this.options.captureConsoleLog =
    this.options.captureConsoleLog || CAPTURE_CONSOLE_LOG;
  this.options.enableServiceWorker =
    this.options.enableServiceWorker || ENABLE_SERVICE_WORKER;
  this.options.requestTimeout = this.options.requestTimeout || REQUEST_TIMEOUT;
  this.options.pdfOptions = this.options.pdfOptions || {
    printBackground: true,
  };
  this.options.browserDebuggingPort =
    this.options.browserDebuggingPort || BROWSER_DEBUGGING_PORT;
  this.options.timeoutStatusCode =
    this.options.timeoutStatusCode || TIMEOUT_STATUS_CODE;
  this.options.renderErrorStatusCode = this.options.renderErrorStatusCode || RENDERING_ERROR_STATUS_CODE;
  this.options.parseShadowDom = this.options.parseShadowDom || PARSE_SHADOW_DOM;
  this.options.browserTryRestartPeriod =
    this.options.browserTryRestartPeriod || BROWSER_TRY_RESTART_PERIOD;

  this.browser = require('./browsers/chrome');

  return this;
};

server.start = function () {
  util.log(`Starting Prerender v${prerenderVersion}`);
  this.isBrowserConnected = false;
  this.startPrerender()
    .then(() => {
      const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
      const handleShutdown = (signal) => {
        if (this.isShuttingDown) {
          util.log('Shutdown already in progress', 'signal=' + signal);
          return;
        }

        this.isShuttingDown = true;
        util.log('Received ' + signal + ', shutting down Prerender');
        this.killBrowser();
        setTimeout(() => {
          util.log('Stopping Prerender');
          process.exit();
        }, 500);
      };

      shutdownSignals.forEach((signal) => {
        process.on(signal, () => handleShutdown(signal));
      });

      process.on('exit', () => {
        if (this.isShuttingDown) {
          return;
        }

        this.isShuttingDown = true;
        util.log('Process exit detected, cleaning up browser');
        this.killBrowser();
      });
    })
    .catch(() => {
      if (process.exit) {
        process.exit();
      }
    });
};

server.startPrerender = function () {
  return new Promise((resolve, reject) => {
    this.spawnBrowser()
      .then(() => {
        this.listenForBrowserClose();
        return this.connectToBrowser();
      })
      .then(() => {
        this.browserRequestsInFlight = new Map();
        this.lastRestart = new Date().getTime();
        this.isBrowserConnected = true;
        util.log(`Started ${this.browser.name}: ${this.browser.version}`);
        return this.firePluginEvent('connectedToBrowser', { server });
      })
      .then(() => resolve())
      .catch((err) => {
        util.log(err);
        util.log(
          `Failed to start and/or connect to ${this.browser.name}. Please make sure ${this.browser.name} is running`,
        );
        this.killBrowser();
        reject();
      });
  });
};

server.addRequestToInFlight = function (req) {
  if (!this.browserRequestsInFlight) {
    util.log(
      'in-flight add skipped',
      'reqId=' + req.prerender.reqId,
      'tracker=uninitialized',
      'url=' + req.prerender.url,
    );
    return;
  }

  this.browserRequestsInFlight.set(req.prerender.reqId, req.prerender.url);
  util.log(
    'in-flight add',
    'reqId=' + req.prerender.reqId,
    'active=' + this.browserRequestsInFlight.size,
    'url=' + req.prerender.url,
  );
};

server.removeRequestFromInFlight = function (req) {
  if (!this.browserRequestsInFlight) {
    util.log(
      'in-flight remove skipped',
      'reqId=' + req.prerender.reqId,
      'tracker=uninitialized',
    );
    return;
  }

  const existed = this.browserRequestsInFlight.delete(req.prerender.reqId);
  const active = this.browserRequestsInFlight.size;

  if (!existed) {
    util.log(
      'in-flight remove missing',
      'reqId=' + req.prerender.reqId,
      'active=' + active,
    );
    return;
  }

  const message = [
    'in-flight remove',
    'reqId=' + req.prerender.reqId,
    'active=' + active,
    'url=' + req.prerender.url,
  ];
  if (active > 0) {
    const remainingSample = Array.from(this.browserRequestsInFlight.entries())
      .slice(0, 3)
      .map(([id, pendingUrl]) => id + ':' + pendingUrl)
      .join(',');
    if (remainingSample) {
      message.push('remainingSample=' + remainingSample);
    }
  }
  util.log(...message);
};

server.isAnyRequestInFlight = function () {
  return this.browserRequestsInFlight.size !== 0;
};

server.isThisTheOnlyInFlightRequest = function (req) {
  return (
    this.browserRequestsInFlight.size === 1 &&
    this.browserRequestsInFlight.has(req.prerender.reqId)
  );
};

server.spawnBrowser = function () {
  if (this.spawningBrowser) return;
  this.spawningBrowser = true;
  util.log(`Starting ${this.browser.name}`, 'port=' + this.options.browserDebuggingPort);
  this.browserStartedAt = Date.now();
  return this.browser.spawn(this.options);
};

server.killBrowser = function () {
  this.spawningBrowser = false;
  const pid = this.browser.getPid ? this.browser.getPid() : undefined;
  const inFlight = this.browserRequestsInFlight
    ? this.browserRequestsInFlight.size
    : 0;
  const logParts = [
    `Stopping ${this.browser.name}`,
    'pid=' + (pid || '-'),
    'inFlight=' + inFlight,
  ];
  if (this.browserStartedAt) {
    logParts.push('uptimeMs=' + (Date.now() - this.browserStartedAt));
  }
  if (this.browserRequestsInFlight && inFlight > 0) {
    const remainingSample = Array.from(this.browserRequestsInFlight.entries())
      .slice(0, 3)
      .map(([id, pendingUrl]) => id + ':' + pendingUrl)
      .join(',');
    if (remainingSample) {
      logParts.push('remainingSample=' + remainingSample);
    }
  }
  util.log(...logParts);
  this.isBrowserClosing = true;
  this.browser.kill();
};

server.restartBrowser = function (reason) {
  this.isBrowserConnected = false;
  this.spawningBrowser = false;
  const pid = this.browser.getPid ? this.browser.getPid() : undefined;
  const inFlight = this.browserRequestsInFlight
    ? this.browserRequestsInFlight.size
    : 0;
  const logParts = [
    `Restarting ${this.browser.name}`,
    'pid=' + (pid || '-'),
    'inFlight=' + inFlight,
  ];
  if (this.browserStartedAt) {
    logParts.push('uptimeMs=' + (Date.now() - this.browserStartedAt));
  }
  if (this.browserRequestsInFlight && inFlight > 0) {
    const remainingSample = Array.from(this.browserRequestsInFlight.entries())
      .slice(0, 3)
      .map(([id, pendingUrl]) => id + ':' + pendingUrl)
      .join(',');
    if (remainingSample) {
      logParts.push('remainingSample=' + remainingSample);
    }
  }
  if (reason) {
    logParts.push('reason=' + reason);
  }
  util.log(...logParts);
  this.browser.kill();
  this.startPrerender();
};

server.connectToBrowser = function () {
  return this.browser.connect();
};

server.listenForBrowserClose = function () {
  const start = Date.now();
  this.browserStartedAt = start;

  this.isBrowserClosing = false;

  this.browser.onClose((code, signal, pid) => {
    this.isBrowserConnected = false;

    const uptime = Date.now() - start;
    const inFlight = this.browserRequestsInFlight
      ? this.browserRequestsInFlight.size
      : 0;
    const formattedCode = code === null || code === undefined ? 'null' : code;
    const closeLogParts = [
      `${this.browser.name} process closed`,
      'pid=' + (pid || '-'),
      'code=' + formattedCode,
      'signal=' + (signal || '-'),
      'uptimeMs=' + uptime,
      'inFlight=' + inFlight,
      'isBrowserClosing=' + this.isBrowserClosing,
    ];
    util.log(...closeLogParts);

    if (this.isBrowserClosing) {
      util.log(`Stopped ${this.browser.name}`);
      this.browserStartedAt = null;
      return;
    }

    this.spawningBrowser = false;

    if (uptime < 1000) {
      util.log(
        `${this.browser.name} died immediately after restart... stopping Prerender`,
      );
      this.browserStartedAt = null;
      return process.exit();
    }

    util.log(
      `${this.browser.name} connection closed... restarting ${this.browser.name}`,
      'pendingRequests=' + inFlight,
    );

    this.browserStartedAt = null;
    this.startPrerender();
  });
};

server.waitForBrowserToConnect = function () {
  return new Promise((resolve, reject) => {
    var checks = 0;

    let check = () => {
      if (++checks > 300) {
        return reject(`Timed out waiting for ${this.browser.name} connection`);
      }

      if (!this.isBrowserConnected) {
        return setTimeout(check, 200);
      }

      resolve();
    };

    check();
  });
};

server.use = function (plugin) {
  this.plugins.push(plugin);
  if (typeof plugin.init === 'function') plugin.init(this);
};

server.onRequest = function (req, res) {
  req.prerender = util.getOptions(req);
  // Do not rename reqId!
  req.prerender.reqId = uuidv4();
  req.prerender.renderId = uuidv4();
  req.prerender.start = new Date();
  req.prerender.responseSent = false;
  req.server = this;

  const getRequestTimeoutError = () => {
    const error = new Error('Request timed out');
    error.code = 'PRERENDER_REQUEST_TIMEOUT';
    return error;
  };

  const ensureRequestActive = () => {
    if (req.prerender.cancelled) {
      throw getRequestTimeoutError();
    }
  };

  util.log('getting', req.prerender.url, 'reqId=' + req.prerender.reqId);
  if (this.browserRequestsInFlight === undefined) {
    util.log(
      'browser not ready for request',
      'reqId=' + req.prerender.reqId,
      'url=' + req.prerender.url,
    );
    return res.sendStatus(503);
  }
  this.addRequestToInFlight(req);

  this.firePluginEvent('requestReceived', req, res)
    .then(() => {
      if (!validUrl.isWebUri(encodeURI(req.prerender.url))) {
        util.log('invalid URL:', req.prerender.url);
        req.prerender.statusCode = 400;
        return Promise.reject();
      }

      req.prerender.startConnectingToBrowser = new Date();

      return this.firePluginEvent('connectingToBrowserStarted', req, res);
    })
    .then(() => this.waitForBrowserToConnect())
    .then(() => {
      req.prerender.startOpeningTab = new Date();

      //if there is a case where a page hangs, this will at least let us restart chrome
      const requestTimeout =
        req.prerender.requestTimeout || this.options.requestTimeout;

      req.prerender.timeoutHandle = setTimeout(() => {
        if (req.prerender.responseSent) {
          return;
        }

        req.prerender.cancelled = true;
        req.prerender.timedout = true;
        const elapsedMs = new Date().getTime() - req.prerender.start.getTime();
        util.log(
          'timing out request',
          'reqId=' + req.prerender.reqId,
          elapsedMs + 'ms',
          req.prerender.url,
        );

        const timeoutStatusCode =
          req.prerender.timeoutStatusCode ||
          this.options.timeoutStatusCode ||
          this.options.renderErrorStatusCode;

        req.prerender.statusCode = timeoutStatusCode;
        req.prerender.statusCodeReason =
          req.prerender.statusCodeReason || 'request timed out';

        this.finish(req, res);
      }, requestTimeout);

      return this.browser.openTab(req.prerender);
    })
    .then((tab) => {
      req.prerender.endOpeningTab = new Date();
      req.prerender.tab = tab;

      ensureRequestActive();

      return this.firePluginEvent('tabCreated', req, res);
    })
    .then(() => {
      ensureRequestActive();
      req.prerender.startLoadingUrl = new Date();
      return this.browser.loadUrlThenWaitForPageLoadEvent(
        req.prerender.tab,
        req.prerender.url,
        () => this.firePluginEvent('tabNavigated', req, res),
      );
    })
    .then(() => {
      ensureRequestActive();
      req.prerender.endLoadingUrl = new Date();

      if (req.prerender.javascript) {
        return this.browser.executeJavascript(
          req.prerender.tab,
          req.prerender.javascript,
        );
      } else {
        return Promise.resolve();
      }
    })
    .then(() => {
      ensureRequestActive();
      return this.firePluginEvent('beforeParse', req, res);
    })
    .then(() => {
      ensureRequestActive();
      req.prerender.startParse = new Date();

      if (req.prerender.renderType == 'png') {
        return this.browser.captureScreenshot(
          req.prerender.tab,
          'png',
          req.prerender.fullpage,
        );
      } else if (req.prerender.renderType == 'jpeg') {
        return this.browser.captureScreenshot(
          req.prerender.tab,
          'jpeg',
          req.prerender.fullpage,
        );
      } else if (req.prerender.renderType == 'pdf') {
        return this.browser.printToPDF(
          req.prerender.tab,
          this.options.pdfOptions,
        );
      } else if (req.prerender.renderType == 'har') {
        return this.browser.getHarFile(req.prerender.tab);
      } else {
        return this.browser.parseHtmlFromPage(req.prerender.tab);
      }
    })
    .then(() => {
      ensureRequestActive();
      req.prerender.endParse = new Date();

      req.prerender.statusCode = req.prerender.tab.prerender.statusCode;
      req.prerender.prerenderData = req.prerender.tab.prerender.prerenderData;
      req.prerender.content = req.prerender.tab.prerender.content;
      req.prerender.headers = req.prerender.tab.prerender.headers;

      return this.firePluginEvent('pageLoaded', req, res);
    })
    .then(() => {
      this.finish(req, res);
    })
    .catch((err) => {
      if (err && err.code !== 'PRERENDER_REQUEST_TIMEOUT') util.log(err);
      req.prerender.startCatchError = new Date();
      this.finish(req, res);
    })
    .finally(() => {
      if (
        this.browserRequestsInFlight &&
        this.browserRequestsInFlight.has(req.prerender.reqId)
      ) {
        this.removeRequestFromInFlight(req);
      }
    });
};

server.finish = function (req, res) {
  if (req.prerender.timeoutHandle) {
    clearTimeout(req.prerender.timeoutHandle);
    req.prerender.timeoutHandle = null;
  }

  const url = req.prerender.url;
  util.log(
    'finishing request',
    'reqId=' + req.prerender.reqId,
    'status=' + (req.prerender.statusCode || 'n/a'),
    'timedout=' + (req.prerender.timedout ? 'yes' : 'no'),
    'cancelled=' + (req.prerender.cancelled ? 'yes' : 'no'),
    'url=' + url,
  );

  if (req.prerender.tab && !req.prerender.tabClosed) {
    req.prerender.tabClosed = true;
    const targetId = req.prerender.tab.target || 'unknown';
    this.browser
      .closeTab(req.prerender.tab)
      .then(() => {
        util.log(
          'closed Chrome tab',
          'reqId=' + req.prerender.reqId,
          'target=' + targetId,
          'url=' + url,
        );
      })
      .catch((err) => {
        util.log(
          'error closing Chrome tab',
          'reqId=' + req.prerender.reqId,
          'target=' + targetId,
          'url=' + url,
          err,
        );
      });
  }
  if (req.prerender.responseSent) {
    if (req.prerender.cancelled) {
      util.log(
        'timed out request already finished',
        'reqId=' + req.prerender.reqId,
        req.prerender.url,
      );
    }
    return;
  }

  req.prerender.startFinish = new Date();

  req.prerender.responseSent = true;
  this.removeRequestFromInFlight(req);

  if (req.prerender.timedout) {
    util.log(
      'finishing timed out request',
      'reqId=' + req.prerender.reqId,
      req.prerender.url,
    );
  }

  if (Array.isArray(req.prerender.errors) && req.prerender.errors.length) {
    util.log(
      'chrome reported errors',
      'reqId=' + req.prerender.reqId,
      req.prerender.errors.join(','),
      req.prerender.url,
    );
  }

  if (
    !this.isAnyRequestInFlight() &&
    new Date().getTime() - this.lastRestart >
      this.options.browserTryRestartPeriod
  ) {
    this.lastRestart = new Date().getTime();
    this.restartBrowser('periodic-idle-check');
  }

  req.prerender.timeSpentConnectingToBrowser =
    (req.prerender.startOpeningTab || req.prerender.startFinish) -
      req.prerender.startConnectingToBrowser || 0;
  req.prerender.timeSpentOpeningTab =
    (req.prerender.endOpeningTab || req.prerender.startFinish) -
      req.prerender.startOpeningTab || 0;
  req.prerender.timeSpentLoadingUrl =
    (req.prerender.endLoadingUrl || req.prerender.startFinish) -
      req.prerender.startLoadingUrl || 0;
  req.prerender.timeSpentParsingPage =
    (req.prerender.endParse || req.prerender.startFinish) -
      req.prerender.startParse || 0;
  req.prerender.timeUntilError = 0;

  if (req.prerender.startCatchError) {
    req.prerender.timeUntilError =
      req.prerender.startCatchError - req.prerender.start;
  }

  this.firePluginEvent('beforeSend', req, res)
    .then(() => {
      this._send(req, res);
    })
    .catch(() => {
      this._send(req, res);
    })
    .finally(() => {
      req.prerender.tab = null;
    });
};

server.firePluginEvent = function (methodName, req, res) {
  return new Promise((resolve, reject) => {
    let index = 0;
    let done = false;
    let next = null;
    let cancellationToken = null;
    var newRes = {};
    var args = [req, newRes];

    const url = req?.prerender?.url;
    util.debug(`Firing plugin event=${methodName}, url=${url}`);

    newRes.send = function (statusCode, content) {
      clearTimeout(cancellationToken);
      cancellationToken = null;

      if (statusCode) req.prerender.statusCode = statusCode;
      if (content) req.prerender.content = content;
      done = true;
      reject();
    };

    newRes.setHeader = function (key, value) {
      res.setHeader(key, value);
    };

    next = () => {
      clearTimeout(cancellationToken);
      cancellationToken = null;

      if (done) return;

      let layer = this.plugins[index++];
      if (!layer) {
        return resolve();
      }

      let method = layer[methodName];

      if (method) {
        try {
          cancellationToken = setTimeout(() => {
            util.log(
              `Plugin event ${methodName} timed out (10s), layer index: ${index}, url: ${req ? req.url : '-'}`,
            );
          }, 10000);

          method.apply(layer, args);
        } catch (e) {
          util.log(e);
          next();
        }
      } else {
        next();
      }
    };

    args.push(next);
    next();
  });
};

server._send = function (req, res) {
  req.prerender.statusCode = parseInt(req.prerender.statusCode) || this.options.renderErrorStatusCode;

  let contentTypes = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    pdf: 'application/pdf',
    har: 'application/json',
  };

  if (req.prerender.renderType == 'html') {
    Object.keys(req.prerender.headers || {}).forEach(function (header) {
      try {
        res.setHeader(header, req.prerender.headers[header].split('\n'));
      } catch (e) {
        util.log('warning: unable to set header:', header);
      }
    });
  }

  if (req.prerender.prerenderData) {
    res.setHeader('Content-Type', 'application/json');
  } else {
    res.setHeader(
      'Content-Type',
      contentTypes[req.prerender.renderType] || 'text/html;charset=UTF-8',
    );
  }

  if (!req.prerender.prerenderData) {
    if (req.prerender.content) {
      if (Buffer.isBuffer(req.prerender.content)) {
        res.setHeader('Content-Length', req.prerender.content.length);
      } else if (typeof req.prerender.content === 'string') {
        res.setHeader(
          'Content-Length',
          Buffer.byteLength(req.prerender.content, 'utf8'),
        );
      }
    }
  }

  //if the original server had a chunked encoding, we should remove it since we aren't sending a chunked response
  res.removeHeader('Transfer-Encoding');
  //if the original server wanted to keep the connection alive, let's close it
  res.removeHeader('Connection');

  res.removeHeader('Content-Encoding');

  if (req.prerender.statusCodeReason) {
    res.setHeader('x-prerender-504-reason', req.prerender.statusCodeReason);
  }

  res.status(req.prerender.statusCode);

  if (req.prerender.prerenderData) {
    res.json({
      prerenderData: req.prerender.prerenderData,
      content: req.prerender.content,
    });
  }

  if (!req.prerender.prerenderData && req.prerender.content) {
    res.send(req.prerender.content);
  }

  if (!req.prerender.content) {
    res.end();
  }

  var ms = new Date().getTime() - req.prerender.start.getTime();
  util.log(
    'got',
    req.prerender.statusCode,
    'in',
    ms + 'ms',
    'for',
    req.prerender.url,
  );
};

module.exports = server;
