const fs = require('fs');
const path = require('path');
const http = require('http');
const util = require('./util');
const basename = path.basename;
const server = require('./server');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const compression = require('compression');

const DEFAULT_HEALTHCHECK_PATH = process.env.PRERENDER_HEALTHCHECK_PATH || '/health';

exports = module.exports = (
  options = {
    logRequests: process.env.PRERENDER_LOG_REQUESTS === 'true',
  },
) => {
  const parsedOptions = Object.assign(
    {},
    {
      port: options.port || process.env.PORT || 3000,
    },
    options,
  );

  server.init(options);
  server.onRequest = server.onRequest.bind(server);

  app.disable('x-powered-by');
  app.use(compression());

  const healthCheckPath = parsedOptions.healthCheckPath || DEFAULT_HEALTHCHECK_PATH;

  app.get(healthCheckPath, async (req, res) => {
    const start = Date.now();
    try {
      const checks = await server.healthCheck();
      res.set('Cache-Control', 'no-store');
      res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        latencyMs: Date.now() - start,
        checks,
      });
    } catch (err) {
      const payload = {
        status: 'error',
        uptime: process.uptime(),
        latencyMs: Date.now() - start,
        error: err.message,
      };
      if (err.code) {
        payload.code = err.code;
      }
      if (err.details) {
        payload.checks = err.details;
      }
      res.set('Cache-Control', 'no-store');
      res.status(503).json(payload);
    }
  });

  util.log(
    'Healthcheck endpoint registered',
    'path=' + healthCheckPath,
    'targetUrl=' + server.options.healthCheckUrl,
  );

  app.get('*', server.onRequest);

  //dont check content-type and just always try to parse body as json
  app.post('*', bodyParser.json({ type: () => true }), server.onRequest);

  app.listen(parsedOptions, () =>
    util.log(
      `Prerender server accepting requests on port ${parsedOptions.port}`,
    ),
  );

  return server;
};

fs.readdirSync(__dirname + '/plugins').forEach((filename) => {
  if (!/\.js$/.test(filename)) return;

  var name = basename(filename, '.js');

  function load() {
    return require('./plugins/' + name);
  }

  Object.defineProperty(exports, name, {
    value: load,
  });
});
