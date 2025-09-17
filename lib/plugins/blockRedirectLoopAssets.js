const { URL } = require('url');
const util = require('../util');

const DEFAULT_SEGMENTS = ['=404'];

let cachedSegments;

function getSegments() {
  if (cachedSegments) {
    return cachedSegments;
  }

  const raw = process.env.PRERENDER_BLOCK_REDIRECT_SEGMENTS;
  const entries = raw ? raw.split(',') : DEFAULT_SEGMENTS;

  cachedSegments = entries
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  return cachedSegments;
}

module.exports = {
  init: () => {
    cachedSegments = null;
    getSegments();
  },
  requestReceived: (req, res, next) => {
    if (!req || !req.prerender || !req.prerender.url) {
      return next();
    }

    let pathname;
    try {
      pathname = new URL(req.prerender.url).pathname || '';
    } catch (err) {
      return next();
    }

    const normalized = pathname.toLowerCase();
    const lastSegment = normalized.split('/').pop();

    if (!lastSegment || !getSegments().includes(lastSegment)) {
      return next();
    }

    util.log('blocking redirect-prone asset request', req.prerender.url);
    req.prerender.statusCodeReason = 'redirect loop filtered';
    res.send(404);
  },
};
