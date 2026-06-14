const crypto = require("node:crypto");
const { sitePassword, authSecret, authCookieName, authMaxAgeSeconds } = require("./config");
const { readFormBody, sendError } = require("./http");

function authConfigured() {
  return Boolean(sitePassword && authSecret);
}

function authSignature() {
  return crypto.createHmac("sha256", authSecret).update(`dig.everyday:${sitePassword}`).digest("base64url");
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthenticated(req) {
  return authConfigured() && safeEqual(cookieValue(req, authCookieName), authSignature());
}

function loginPage(message = "") {
  const safeMessage = String(message).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dig.everyday login</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f7f2;color:#222321;font-family:system-ui,"Apple SD Gothic Neo",sans-serif}
main{width:min(100%,390px);padding:30px;border:1px solid #d9dbd2;border-radius:12px;background:#fff;box-shadow:0 24px 70px rgba(34,35,33,.1)}
.brand{font:32px Georgia,serif;margin:0 0 8px}.note{margin:0 0 26px;color:#686a64;font-size:13px;line-height:1.6}
label{display:block;margin-bottom:8px;color:#686a64;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
input{width:100%;height:48px;padding:0 13px;border:1px solid #d9dbd2;border-radius:7px;font:inherit;outline:none}input:focus{border-color:#303b38;box-shadow:0 0 0 3px rgba(48,59,56,.1)}
button{width:100%;height:46px;margin-top:12px;border:0;border-radius:7px;background:#222321;color:#fff;font:inherit;cursor:pointer}
.error{margin:14px 0 0;color:#a34d39;font-size:12px;line-height:1.5}
</style>
</head>
<body><main><h1 class="brand">dig.everyday</h1><p class="note">이 CMS는 비공개입니다. 이 기기에서 한 번 인증하면 계속 사용할 수 있습니다.</p>
<form method="post" action="/auth/login"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">들어가기</button></form>
${safeMessage ? `<p class="error">${safeMessage}</p>` : ""}</main></body></html>`;
}

function sendLoginPage(res, status = 200, message = "") {
  const html = loginPage(message);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(html)
  });
  res.end(html);
}

async function handleLogin(req, res) {
  if (!authConfigured()) {
    sendLoginPage(res, 503, "SITE_PASSWORD와 AUTH_SECRET 환경변수 설정이 필요합니다.");
    return;
  }
  try {
    const body = await readFormBody(req);
    if (!safeEqual(body.password || "", sitePassword)) {
      sendLoginPage(res, 401, "비밀번호가 올바르지 않습니다.");
      return;
    }
    const secure = process.env.VERCEL || req.headers["x-forwarded-proto"] === "https";
    res.writeHead(303, {
      Location: "/",
      "Cache-Control": "no-store",
      "Set-Cookie": `${authCookieName}=${encodeURIComponent(authSignature())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${authMaxAgeSeconds}${secure ? "; Secure" : ""}`
    });
    res.end();
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = {
  authConfigured,
  isAuthenticated,
  sendLoginPage,
  handleLogin
};
