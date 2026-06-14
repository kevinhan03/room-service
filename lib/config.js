const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 3000);

function loadEnv(filePath) {
  const values = { ...process.env };
  if (!fs.existsSync(filePath)) return values;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    values[key] = value;
  }
  return values;
}

const env = loadEnv(path.join(root, ".env.local"));
const configuredTimeoutMs = Number(env.API_TIMEOUT_MS || 120000);
const apiTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 120000;
const openaiResponsesUrl = env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const perplexitySonarUrl = env.PERPLEXITY_SONAR_URL || "https://api.perplexity.ai/v1/sonar";
const openaiModel = env.OPENAI_MODEL || "gpt-4.1-mini";
const openaiWritingModel = env.OPENAI_WRITING_MODEL || "gpt-5.4";
const perplexityModel = env.PERPLEXITY_MODEL || "sonar-pro";
const perplexityDeepResearchModel = env.PERPLEXITY_DEEP_RESEARCH_MODEL || "sonar-deep-research";
const supabaseUrl = env.SUPABASE_URL || "https://ioobqwtwnkaqxyemprld.supabase.co";
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
const sitePassword = env.SITE_PASSWORD || "";
const authSecret = env.AUTH_SECRET || "";
const authCookieName = "dig_session";
const authMaxAgeSeconds = 60 * 60 * 24 * 365 * 10;
const autoCollectTimezone = env.AUTO_COLLECT_TIMEZONE || "Asia/Seoul";
const autoCollectLimit = Math.max(1, Math.min(Number(env.AUTO_COLLECT_LIMIT) || 5, 8));
const tasteAnalysisBatchSize = 100;

class AppError extends Error {
  constructor(message, status = 500, code = "APP_ERROR", details = "", userMessage = "") {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.userMessage = userMessage;
  }
}

const categories = new Set(["Fashion", "Space", "Food", "Travel", "Hotel", "Object", "Perfume", "Architecture", "Product", "Brand", "Book", "Magazine", "Artwork", "Playlist", "Restaurant", "Cafe", "Store", "Exhibition"]);
const sourceTypes = new Set(["Magazine", "Brand", "Kevin"]);

module.exports = {
  root,
  port,
  env,
  apiTimeoutMs,
  openaiResponsesUrl,
  perplexitySonarUrl,
  openaiModel,
  openaiWritingModel,
  perplexityModel,
  perplexityDeepResearchModel,
  supabaseUrl,
  supabaseServiceRoleKey,
  sitePassword,
  authSecret,
  authCookieName,
  authMaxAgeSeconds,
  autoCollectTimezone,
  autoCollectLimit,
  tasteAnalysisBatchSize,
  AppError,
  categories,
  sourceTypes
};
