const service = require("./service");

module.exports = {
  resolveSourceDefinition: service.resolveSourceDefinition,
  findSourceByUrl: service.findSourceByUrl,
  validateSourceCompatibility: service.validateSourceCompatibility,
  saveSource: service.saveSource,
  listActiveSources: service.listActiveSources
};
