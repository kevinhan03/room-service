const { requestHandler } = require("../server");

module.exports = function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const route = url.searchParams.get("__path") || "";
  const sitePath = url.searchParams.get("__site_path");

  url.searchParams.delete("__path");
  url.searchParams.delete("__site_path");
  const query = url.searchParams.toString();
  const normalizedSitePath = sitePath === null ? null : sitePath.replace(/^\/+/, "");
  req.url = normalizedSitePath !== null
    ? `/${normalizedSitePath}${query ? `?${query}` : ""}`
    : `/api/${route}${query ? `?${query}` : ""}`;
  return requestHandler(req, res);
};
