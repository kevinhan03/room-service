module.exports = {
  ...require("./feeds/parsers"),
  ...require("./feeds/sources"),
  ...require("./feeds/collector"),
  ...require("./feeds/runs")
};
