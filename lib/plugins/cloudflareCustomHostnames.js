const https = require('https');
const { URL } = require('url');
const util = require('../util');

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_PER_PAGE = 1000;
const DEFAULT_API_BASE_URL = 'https://api.cloudflare.com/client/v4';

const state = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  apiToken: '',
  requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
  zoneIds: [],
  allowedHostnamesStatic: new Set(),
  allowedSuffixes: [],
  allowedHostnames: new Set(),
  syncInFlight: null,
  timer: null,
  hasCompletedInitialSync: false,
  lastSuccessfulSyncAt: null,
};

function parseCsv(value) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHostname(value) {
  return (value || '').trim().toLowerCase().replace(/\.$/, '');
}

function normalizeSuffix(value) {
  const normalized = normalizeHostname(value).replace(/^\*\./, '');
  return normalized.startsWith('.') ? normalized.slice(1) : normalized;
}

function matchesAllowedSuffix(hostname) {
  return state.allowedSuffixes.some((suffix) => {
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  });
}

function matchesAllowedHostname(hostname) {
  return state.allowedHostnamesStatic.has(hostname);
}

function getHostname(rawUrl) {
  try {
    return normalizeHostname(new URL(rawUrl).hostname);
  } catch (err) {
    return '';
  }
}

function delayNextSync() {
  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    syncAllowedHostnames().catch((err) => {
      util.log('Cloudflare custom hostname sync failed', err.message);
    });
  }, state.syncIntervalMs);

  if (typeof state.timer.unref === 'function') {
    state.timer.unref();
  }
}

function apiRequest(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${state.apiToken}`,
          Accept: 'application/json',
        },
        timeout: state.requestTimeoutMs,
      },
      (response) => {
        let body = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch (err) {
            return reject(new Error(`Cloudflare API returned invalid JSON (${response.statusCode})`));
          }

          if (response.statusCode < 200 || response.statusCode >= 300 || parsed.success === false) {
            const message =
              parsed?.errors?.map((error) => error.message).filter(Boolean).join('; ') ||
              `Cloudflare API request failed (${response.statusCode})`;
            const error = new Error(message);
            error.statusCode = response.statusCode;
            error.rateLimit = response.headers.ratelimit;
            error.retryAfter = response.headers['retry-after'];
            return reject(error);
          }

          resolve({
            body: parsed,
            headers: response.headers,
          });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Cloudflare API request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchZoneHostnames(zoneId) {
  const hostnames = new Set();
  let page = 1;
  let totalPages = 1;
  let lastRateLimit = '-';

  while (page <= totalPages) {
    const requestUrl = new URL(
      `/client/v4/zones/${zoneId}/custom_hostnames`,
      state.apiBaseUrl.endsWith('/') ? state.apiBaseUrl : `${state.apiBaseUrl}/`,
    );
    requestUrl.searchParams.set('page', page);
    requestUrl.searchParams.set('per_page', DEFAULT_PER_PAGE);

    const { body, headers } = await apiRequest(requestUrl);
    const results = Array.isArray(body.result) ? body.result : [];
    const resultInfo = body.result_info || {};
    totalPages = Math.max(page, Number(resultInfo.total_pages) || 1);
    lastRateLimit = headers.ratelimit || '-';

    for (const result of results) {
      const hostname = normalizeHostname(result?.hostname);
      if (!hostname) {
        continue;
      }

      if (result?.status === 'active' && result?.ssl?.status === 'active') {
        hostnames.add(hostname);
      }
    }

    util.debug(
      'Cloudflare custom hostname page fetched',
      `zoneId=${zoneId}`,
      `page=${page}/${totalPages}`,
      `items=${results.length}`,
      `ratelimit=${headers.ratelimit || '-'}`,
    );

    page += 1;
  }

  return {
    hostnames,
    totalPages,
    rateLimit: lastRateLimit,
  };
}

async function syncAllowedHostnames() {
  if (!state.apiToken || state.zoneIds.length === 0) {
    delayNextSync();
    return;
  }

  if (state.syncInFlight) {
    return state.syncInFlight;
  }

  state.syncInFlight = (async () => {
    try {
      const mergedHostnames = new Set();

      for (const zoneId of state.zoneIds) {
        const { hostnames, totalPages, rateLimit } = await fetchZoneHostnames(zoneId);
        hostnames.forEach((hostname) => mergedHostnames.add(hostname));
        util.log(
          'Cloudflare custom hostname zone sync complete',
          `zoneId=${zoneId}`,
          `hostnames=${hostnames.size}`,
          `pages=${totalPages}`,
          `ratelimit=${rateLimit}`,
        );
      }

      state.allowedHostnames = mergedHostnames;
      state.hasCompletedInitialSync = true;
      state.lastSuccessfulSyncAt = new Date();

      util.log(
        'Cloudflare custom hostname sync complete',
        `zones=${state.zoneIds.length}`,
        `hostnames=${state.allowedHostnames.size}`,
        `syncedAt=${state.lastSuccessfulSyncAt.toISOString()}`,
      );
    } finally {
      state.syncInFlight = null;
      delayNextSync();
    }
  })();

  return state.syncInFlight;
}

module.exports = {
  init: () => {
    state.allowedHostnamesStatic = new Set(
      parseCsv(process.env.ALLOWED_HOSTNAMES).map(normalizeHostname),
    );
    state.allowedSuffixes = parseCsv(process.env.ALLOWED_DOMAIN_SUFFIXES).map(normalizeSuffix);
    state.zoneIds = parseCsv(process.env.CF_ZONE_IDS);
    state.apiToken = (process.env.CF_API_TOKEN || '').trim();
    state.requestTimeoutMs = Number(process.env.CF_CUSTOM_HOSTNAMES_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    state.syncIntervalMs =
      Number(process.env.CF_CUSTOM_HOSTNAMES_SYNC_INTERVAL_MS) || DEFAULT_SYNC_INTERVAL_MS;
    state.apiBaseUrl = (process.env.CF_API_BASE_URL || DEFAULT_API_BASE_URL).trim();

    const hasCloudflareConfig = state.apiToken && state.zoneIds.length > 0;

    if (!state.allowedSuffixes.length && !hasCloudflareConfig) {
      util.log('Cloudflare custom hostname plugin disabled (no config)');
      return;
    }

    util.log(
      'Cloudflare custom hostname plugin enabled',
      `allowedHostnames=${state.allowedHostnamesStatic.size}`,
      `allowedSuffixes=${state.allowedSuffixes.join('|') || '-'}`,
      `zones=${state.zoneIds.length}`,
      `syncIntervalMs=${state.syncIntervalMs}`,
    );

    if (!hasCloudflareConfig) {
      util.log('Cloudflare custom hostname sync disabled (missing CF_API_TOKEN or CF_ZONE_IDS)');
      return;
    }

    syncAllowedHostnames().catch((err) => {
      util.log('Cloudflare custom hostname initial sync failed', err.message);
    });
  },

  requestReceived: (req, res, next) => {
    const hostname = getHostname(req?.prerender?.url);

    if (!hostname) {
      return next();
    }

    if (matchesAllowedHostname(hostname)) {
      return next();
    }

    if (matchesAllowedSuffix(hostname)) {
      return next();
    }

    if (!state.apiToken || state.zoneIds.length === 0) {
      return res.send(404);
    }

    if (!state.hasCompletedInitialSync) {
      util.log('Cloudflare custom hostname cache not ready', hostname);
      return res.send(503);
    }

    if (state.allowedHostnames.has(hostname)) {
      return next();
    }

    util.log('Blocking prerender request for unapproved hostname', hostname);
    return res.send(404);
  },
};
