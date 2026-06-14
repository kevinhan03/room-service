const service = require("./service");

module.exports = {
  parseFeedDate: service.parseFeedDate,
  absolutizeUrl: service.absolutizeUrl,
  parseFeedItems: service.parseFeedItems,
  fetchRssItems: service.fetchRssItems,
  isEyesMagUrl: service.isEyesMagUrl,
  fetchEyesMagItems: service.fetchEyesMagItems,
  metaContent: service.metaContent,
  fetchArticleMetadata: service.fetchArticleMetadata,
  fetchWebItems: service.fetchWebItems,
  fetchSourceItems: service.fetchSourceItems
};
