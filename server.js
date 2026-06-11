#!/usr/bin/env node
var prerender = require('./lib');
var memoryCache = require('prerender-memory-cache');

var server = prerender();

if (
  process.env.ALLOWED_DOMAIN_SUFFIXES ||
  process.env.CF_API_TOKEN ||
  process.env.CF_ZONE_IDS
) {
  server.use(prerender.cloudflareCustomHostnames());
}
server.use(prerender.sendPrerenderHeader());
server.use(prerender.blockRedirectLoopAssets());
if (process.env.PRERENDER_SKIP_STATIC_ASSETS !== 'false') {
  server.use(prerender.skipStaticAssets());
}
// server.use(prerender.blockResources());
server.use(prerender.addMetaTags());
server.use(prerender.removeScriptTags());
server.use(prerender.httpHeaders());
if (process.env.MEMORY_CACHE == 1) server.use(memoryCache);

server.start();
