const { URL } = require('url');
const path = require('path');
const util = require('../util');

const DEFAULT_EXTENSIONS = [
  '.js',
  '.cjs',
  '.mjs',
  '.css',
  '.less',
  '.scss',
  '.sass',
  '.json',
  '.xml',
  '.txt',
  '.map',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.bmp',
  '.webp',
  '.avif',
  '.tif',
  '.tiff',
  '.ttf',
  '.otf',
  '.eot',
  '.woff',
  '.woff2',
  '.mp3',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.ogv',
  '.zip',
  '.gz',
  '.rar',
];

const DEFAULT_SEGMENTS = ['=404'];

let skipExtensions;
let skipSegments;

function parseExtensions() {
  const value = process.env.PRERENDER_SKIP_EXTENSIONS;
  const entries = value ? value.split(',') : DEFAULT_EXTENSIONS;

  return new Set(
    entries
      .map((ext) => ext.trim().toLowerCase())
      .filter(Boolean)
      .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)),
  );
}

function parseSegments() {
  const value = process.env.PRERENDER_SKIP_PATH_SEGMENTS;
  const entries = value ? value.split(',') : DEFAULT_SEGMENTS;

  return entries.map((segment) => segment.trim().toLowerCase()).filter(Boolean);
}

function shouldSkip(pathname) {
  if (!pathname) {
    return false;
  }

  const normalizedPath = pathname.toLowerCase();
  const ext = path.extname(normalizedPath);
  const lastSegment = normalizedPath.split('/').pop();

  if (ext && skipExtensions.has(ext)) {
    return true;
  }

  if (lastSegment && skipSegments.includes(lastSegment)) {
    return true;
  }

  return false;
}

module.exports = {
  init: () => {
    skipExtensions = parseExtensions();
    skipSegments = parseSegments();
  },

  requestReceived: (req, res, next) => {
    if (!skipExtensions) {
      skipExtensions = parseExtensions();
    }

    if (!skipSegments) {
      skipSegments = parseSegments();
    }

    if (!req || !req.prerender || !req.prerender.url) {
      return next();
    }

    let pathname;
    try {
      pathname = new URL(req.prerender.url).pathname || '';
    } catch (err) {
      return next();
    }

    if (!shouldSkip(pathname)) {
      return next();
    }

    util.log('skipping static asset request', req.prerender.url);
    req.prerender.statusCodeReason = 'static asset filtered';
    res.send(404);
  },
};
