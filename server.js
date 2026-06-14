const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const {
  root,
  port,
  apiTimeoutMs,
  openaiModel,
  perplexityModel,
  openaiResponsesUrl,
  perplexitySonarUrl,
  autoCollectTimezone,
  autoCollectLimit
} = require("./lib/config");
const { sendJson, sendText, log } = require("./lib/http");
const { authConfigured, isAuthenticated, sendLoginPage, handleLogin } = require("./lib/auth");
const { beginCollectionRun } = require("./lib/feeds");
const { dispatchApiRequest } = require("./routes");

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const requested = path.normalize(path.join(root, pathname));
  if (!requested.startsWith(root)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(requested, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(requested).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(data);
  });
}

function requestHandler(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  if (req.method === "GET" && pathname === "/auth/login") {
    if (isAuthenticated(req)) {
      res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
      res.end();
    } else {
      sendLoginPage(res, authConfigured() ? 200 : 503, authConfigured() ? "" : "SITE_PASSWORD와 AUTH_SECRET 환경변수 설정이 필요합니다.");
    }
    return;
  }
  if (req.method === "POST" && pathname === "/auth/login") {
    handleLogin(req, res);
    return;
  }
  if (!isAuthenticated(req)) {
    if (pathname.startsWith("/api/")) {
      sendJson(res, 401, { error: "Authentication required.", code: "AUTH_REQUIRED", userMessage: "로그인이 필요합니다." });
    } else {
      sendLoginPage(res, authConfigured() ? 401 : 503, authConfigured() ? "" : "SITE_PASSWORD와 AUTH_SECRET 환경변수 설정이 필요합니다.");
    }
    return;
  }

  if (pathname.startsWith("/api/") && dispatchApiRequest(req, res, parsed) !== false) return;
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  sendText(res, 405, "Method not allowed");
}

const server = http.createServer(requestHandler);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Set PORT to another value and restart.`);
    process.exit(1);
  }
  throw error;
});

if (require.main === module) {
  server.listen(port, () => {
    log("info", "dig.everyday server started", {
      url: `http://localhost:${port}`,
      openaiModel,
      perplexityModel,
      apiTimeoutMs,
      autoCollectTimezone,
      autoCollectLimit,
      openaiResponsesUrl,
      perplexitySonarUrl
    });
  });
}

module.exports = { requestHandler, beginCollectionRun };
