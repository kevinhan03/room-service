const service = require("./service");

module.exports = {
  beginCollectionRun: service.beginCollectionRun,
  recordSourceCollection: service.recordSourceCollection,
  finalizeCollectionRun: service.finalizeCollectionRun,
  getZonedParts: service.getZonedParts
};
