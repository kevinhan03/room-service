const { AppError } = require("./config");

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error.status || 500;
  const code = error.code || "INTERNAL_ERROR";
  log("error", error.message, { code, status, details: error.details || "" });
  sendJson(res, status, { error: error.message, code, userMessage: error.userMessage || userMessageForCode(code) });
}

function log(level, message, meta = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

function userMessageForCode(code) {
  return {
    INVALID_JSON: "요청 형식이 올바르지 않습니다. 페이지를 새로고침한 뒤 다시 시도하세요.",
    REQUEST_TOO_LARGE: "입력 내용이 너무 깁니다. 메모를 줄인 뒤 다시 시도하세요.",
    INVALID_INPUT: "입력값을 확인해 주세요. URL 형식이나 글자 수 제한을 벗어났습니다.",
    MISSING_OPENAI_KEY: "OpenAI API 키가 설정되지 않았습니다. .env.local을 확인해 주세요.",
    MISSING_PERPLEXITY_KEY: "Perplexity API 키가 설정되지 않았습니다. .env.local을 확인해 주세요.",
    MISSING_SUPABASE_KEY: "Supabase service role key가 설정되지 않았습니다. .env.local을 확인해 주세요.",
    SUPABASE_API_ERROR: "Supabase 저장/조회에 실패했습니다. 테이블, RLS, service role key를 확인해 주세요.",
    MIGRATION_REQUIRED: "Supabase에 필요한 migration이 적용되지 않았습니다. 최신 supabase/migrations SQL을 실행해 주세요.",
    RSS_FETCH_ERROR: "RSS 피드를 가져오지 못했습니다. URL과 피드 형식을 확인해 주세요.",
    SOURCE_UNSUPPORTED: "이 사이트에서는 RSS 또는 정적 기사 목록을 찾지 못했습니다. JavaScript 렌더링이나 로그인/봇 차단이 필요할 수 있습니다.",
    API_TIMEOUT: "외부 API 응답 시간이 초과됐습니다. 잠시 후 다시 시도하세요.",
    API_NETWORK_ERROR: "외부 API에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.",
    OPENAI_API_ERROR: "OpenAI API 호출에 실패했습니다. 키, 모델명, 사용량 제한을 확인해 주세요.",
    PERPLEXITY_API_ERROR: "Perplexity API 호출에 실패했습니다. 키, 모델명, 사용량 제한을 확인해 주세요.",
    API_INVALID_JSON: "외부 API 응답 형식이 예상과 다릅니다. 잠시 후 다시 시도하세요.",
    MODEL_JSON_PARSE_FAILED: "AI가 편집 가능한 JSON 형식으로 응답하지 않았습니다. 다시 생성해 주세요.",
    MODEL_OUTPUT_INVALID: "AI 응답에 필요한 카드 데이터가 부족합니다. 다시 생성해 주세요.",
    AUTH_REQUIRED: "로그인이 필요합니다."
  }[code] || "처리 중 오류가 발생했습니다. 콘솔과 서버 로그를 확인해 주세요.";
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        req.destroy();
        reject(new AppError("Request body is too large.", 413, "REQUEST_TOO_LARGE"));
      }
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        finish(reject, new AppError("Request body is too large.", 413, "REQUEST_TOO_LARGE"));
      }
    });
    req.on("end", () => {
      try {
        finish(resolve, body ? JSON.parse(body) : {});
      } catch {
        finish(reject, new AppError("Invalid JSON body.", 400, "INVALID_JSON"));
      }
    });
    req.on("error", (error) => finish(reject, error));
  });
}

function readLargeJsonBody(req, maxBytes = 8_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        finish(reject, new AppError("Request body is too large.", 413, "REQUEST_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        finish(resolve, body ? JSON.parse(body) : {});
      } catch {
        finish(reject, new AppError("Invalid JSON body.", 400, "INVALID_JSON"));
      }
    });
    req.on("error", (error) => finish(reject, error));
  });
}

module.exports = {
  sendJson,
  sendError,
  sendText,
  log,
  userMessageForCode,
  readBody,
  readLargeJsonBody,
  readFormBody
};
