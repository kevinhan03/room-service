const service = require("./service");

module.exports = {
  getRejectedCount: service.getRejectedCount,
  getLatestTasteProfile: service.getLatestTasteProfile,
  getRecentRejectedItems: service.getRecentRejectedItems,
  callOpenAITasteAnalysis: service.callOpenAITasteAnalysis,
  maybeUpdateTasteProfile: service.maybeUpdateTasteProfile
};
