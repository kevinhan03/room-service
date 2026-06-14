const service = require("./service");

module.exports = {
  callOpenAIRssAnalysis: service.callOpenAIRssAnalysis,
  callOpenAIInboxIdeas: service.callOpenAIInboxIdeas,
  callOpenAI: service.callOpenAI,
  researchResponse: service.researchResponse
};
