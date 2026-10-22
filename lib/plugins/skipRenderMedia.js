// Embeds need the HTML's image URLs, not decoded images, video or web fonts.
// Keep application scripts, styles and API calls so metadata still loads.
// TikTok's independent analytics loader can stall the load event for 20s;
// exclude only its exact Script host, only for HTML renders.
module.exports = {
  tabCreated: (req, res, next) => {
    if (req.prerender.renderType !== 'html') return next();
    const { Fetch } = req.prerender.tab;
    Fetch.requestPaused(({ requestId }) => {
      Fetch.failRequest({ requestId, errorReason: 'Aborted' }).catch(() => {});
    });
    Fetch.enable({
      patterns: [
        ...['Image', 'Media', 'Font'].map(resourceType => ({ resourceType })),
        { resourceType: 'Script', urlPattern: 'https://analytics.tiktok.com/*' },
        { resourceType: 'Script', urlPattern: 'http://analytics.tiktok.com/*' },
      ],
    }).then(next).catch(next);
  },
};
