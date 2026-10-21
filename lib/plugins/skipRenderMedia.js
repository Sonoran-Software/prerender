// Embeds need the HTML's image URLs, not decoded images, video or web fonts.
// Keep scripts, styles and API calls so client-rendered metadata still loads.
module.exports = {
  tabCreated: (req, res, next) => {
    if (req.prerender.renderType !== 'html') return next();
    const { Fetch } = req.prerender.tab;
    Fetch.requestPaused(({ requestId }) => {
      Fetch.failRequest({ requestId, errorReason: 'Aborted' }).catch(() => {});
    });
    Fetch.enable({
      patterns: ['Image', 'Media', 'Font'].map(resourceType => ({ resourceType })),
    }).then(next).catch(next);
  },
};
