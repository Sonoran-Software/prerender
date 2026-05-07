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
const DEFAULT_ALLOWED_HIDDEN_SEGMENTS = ['.well-known'];

let skipExtensions;
let skipSegments;
let allowedHiddenSegments;

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

function parseAllowedHiddenSegments() {
  const value = process.env.PRERENDER_ALLOW_HIDDEN_PATH_SEGMENTS;
  const entries = value ? value.split(',') : DEFAULT_ALLOWED_HIDDEN_SEGMENTS;

  return new Set(
    entries.map((segment) => segment.trim().toLowerCase()).filter(Boolean),
  );
}

function getSkipReason(pathname) {
  if (!pathname) {
    return null;
  }

  const normalizedPath = pathname.toLowerCase();
  const ext = path.extname(normalizedPath);
  const segments = normalizedPath.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  if (ext && skipExtensions.has(ext)) {
    return 'static asset filtered';
  }

  if (lastSegment && skipSegments.includes(lastSegment)) {
    return 'redirect loop filtered';
  }

  const hiddenSegment = segments.find(
    (segment) =>
      segment.startsWith('.') && !allowedHiddenSegments.has(segment),
  );
  if (hiddenSegment) {
    return 'hidden path filtered';
  }

  return null;
}

module.exports = {
  init: () => {
    skipExtensions = parseExtensions();
    skipSegments = parseSegments();
    allowedHiddenSegments = parseAllowedHiddenSegments();
  },

  requestReceived: (req, res, next) => {
    if (!skipExtensions) {
      skipExtensions = parseExtensions();
    }

    if (!skipSegments) {
      skipSegments = parseSegments();
    }

    if (!allowedHiddenSegments) {
      allowedHiddenSegments = parseAllowedHiddenSegments();
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

    const skipReason = getSkipReason(pathname);
    if (!skipReason) {
      return next();
    }

    util.log('skipping filtered request', req.prerender.url, 'reason=' + skipReason);
    req.prerender.statusCodeReason = skipReason;
    res.send(404);
  },
};
