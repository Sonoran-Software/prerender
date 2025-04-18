#!/usr/bin/env node
var prerender = require('./lib');
var memoryCache = require('prerender-memory-cache');

var server = prerender();

server.use(prerender.sendPrerenderHeader());
server.use(prerender.browserForceRestart());
// server.use(prerender.blockResources());
server.use(prerender.addMetaTags());
server.use(prerender.removeScriptTags());
server.use(prerender.httpHeaders());
if (process.env.MEMORY_CACHE == 1) server.use(memoryCache);

server.start();
