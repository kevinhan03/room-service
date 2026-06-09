const cronHandler = require("./cron");
const { requestHandler } = require("../server");

module.exports = function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const route = url.searchParams.get("__path") || "";

  if (route === "cron") {
    return cronHandler(req, res);
  }

  url.searchParams.delete("__path");
  const query = url.searchParams.toString();
  req.url = `/api/${route}${query ? `?${query}` : ""}`;
  return requestHandler(req, res);
};
