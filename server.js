const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { calculateRecommendationScore, recommendationTier } = require("./lib/recommendations");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const env = loadEnv(path.join(root, ".env.local"));
const configuredTimeoutMs = Number(env.API_TIMEOUT_MS || 120000);
const apiTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 120000;
const openaiResponsesUrl = env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const perplexitySonarUrl = env.PERPLEXITY_SONAR_URL || "https://api.perplexity.ai/v1/sonar";
const openaiModel = env.OPENAI_MODEL || "gpt-4.1-mini";
const perplexityModel = env.PERPLEXITY_MODEL || "sonar-deep-research";
const supabaseUrl = env.SUPABASE_URL || "https://ioobqwtwnkaqxyemprld.supabase.co";
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
const autoCollectTimezone = env.AUTO_COLLECT_TIMEZONE || "Asia/Seoul";
const autoCollectLimit = Math.max(1, Math.min(Number(env.AUTO_COLLECT_LIMIT) || 5, 8));

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
    MIGRATION_REQUIRED: "Supabase에 Human Saved migration이 필요합니다. supabase/migrations/20260609_human_saved.sql을 SQL Editor에서 실행해 주세요.",
    RSS_FETCH_ERROR: "RSS 피드를 가져오지 못했습니다. URL과 피드 형식을 확인해 주세요.",
    SOURCE_UNSUPPORTED: "이 사이트에서는 RSS 또는 정적 기사 목록을 찾지 못했습니다. JavaScript 렌더링이나 로그인/봇 차단이 필요할 수 있습니다.",
    API_TIMEOUT: "외부 API 응답 시간이 초과됐습니다. 잠시 후 다시 시도하세요.",
    API_NETWORK_ERROR: "외부 API에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.",
    OPENAI_API_ERROR: "OpenAI API 호출에 실패했습니다. 키, 모델명, 사용량 제한을 확인해 주세요.",
    PERPLEXITY_API_ERROR: "Perplexity API 호출에 실패했습니다. 키, 모델명, 사용량 제한을 확인해 주세요.",
    API_INVALID_JSON: "외부 API 응답 형식이 예상과 다릅니다. 잠시 후 다시 시도하세요.",
    MODEL_JSON_PARSE_FAILED: "AI가 편집 가능한 JSON 형식으로 응답하지 않았습니다. 다시 생성해 주세요.",
    MODEL_OUTPUT_INVALID: "AI 응답에 필요한 카드 데이터가 부족합니다. 다시 생성해 주세요."
  }[code] || "처리 중 오류가 발생했습니다. 콘솔과 서버 로그를 확인해 주세요.";
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
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

function slugFromUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "manual note";
  }
}

function getOpenAIText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonText(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function fetchWithTimeout(url, options, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError(`${label} request timed out.`, 504, "API_TIMEOUT");
    }
    throw new AppError(`${label} request failed.`, 502, "API_NETWORK_ERROR", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonResponse(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(`${label} returned invalid JSON.`, 502, "API_INVALID_JSON", text.slice(0, 500));
  }
}

function parseModelJson(text, label) {
  try {
    return parseJsonText(text);
  } catch {
    throw new AppError(`${label} returned a response that could not be parsed as JSON.`, 502, "MODEL_JSON_PARSE_FAILED", text.slice(0, 500));
  }
}

function cleanString(value, fallback = "") {
  return String(value || "").trim() || fallback;
}

function assertMaxLength(value, max, field) {
  if (value.length > max) {
    throw new AppError(`${field} is too long.`, 400, "INVALID_INPUT", `${field} length=${value.length}, max=${max}`);
  }
}

function validateUrl(value) {
  if (!value) return "";
  assertMaxLength(value, 2000, "sourceUrl");
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
    return value;
  } catch {
    throw new AppError("sourceUrl must be a valid http or https URL.", 400, "INVALID_INPUT", value.slice(0, 200));
  }
}

function validateResearchInput(body) {
  const input = {
    name: cleanString(body.name, "Untitled Space"),
    sourceUrl: validateUrl(cleanString(body.sourceUrl)),
    category: cleanString(body.category, "Space"),
    notes: cleanString(body.notes),
    imageCredit: cleanString(body.imageCredit),
    imageUsageStatus: cleanString(body.imageUsageStatus, "unknown")
  };
  assertMaxLength(input.name, 120, "name");
  assertMaxLength(input.category, 40, "category");
  assertMaxLength(input.notes, 12000, "notes");
  assertMaxLength(input.imageCredit, 240, "imageCredit");
  assertMaxLength(input.imageUsageStatus, 40, "imageUsageStatus");
  if (!categories.has(input.category)) {
    throw new AppError("category is not supported.", 400, "INVALID_INPUT", input.category);
  }
  return input;
}

function validateDeckInput(body) {
  const input = {
    title: cleanString(body.title, "Untitled Space"),
    format: cleanString(body.format, "Check-in"),
    angle: cleanString(body.angle),
    hook: cleanString(body.hook),
    notes: cleanString(body.notes),
    imageCredit: cleanString(body.imageCredit),
    imageUsageStatus: cleanString(body.imageUsageStatus, "unknown")
  };
  assertMaxLength(input.title, 120, "title");
  assertMaxLength(input.format, 40, "format");
  assertMaxLength(input.angle, 2000, "angle");
  assertMaxLength(input.hook, 1000, "hook");
  assertMaxLength(input.notes, 12000, "notes");
  assertMaxLength(input.imageCredit, 240, "imageCredit");
  assertMaxLength(input.imageUsageStatus, 40, "imageUsageStatus");
  return input;
}

function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 10) {
    throw new AppError("Model returned an invalid number of cards.", 502, "MODEL_OUTPUT_INVALID", `cards=${Array.isArray(cards) ? cards.length : typeof cards}`);
  }
  return cards.map((card, index) => {
    const title = cleanString(card?.title);
    const copy = cleanString(card?.copy);
    if (!title || !copy) {
      throw new AppError("Model returned an incomplete card.", 502, "MODEL_OUTPUT_INVALID", `card index=${index}`);
    }
    if (title.length > 80 || copy.length > 1000) {
      throw new AppError("Model returned a card that is too long.", 502, "MODEL_OUTPUT_INVALID", `card index=${index}, title=${title.length}, copy=${copy.length}`);
    }
    return { title, copy };
  });
}

function validateResearchGenerated(generated) {
  return {
    brief: generated.brief && typeof generated.brief === "object" ? generated.brief : {},
    analysis: generated.analysis && typeof generated.analysis === "object" ? generated.analysis : {},
    researchFacts: Array.isArray(generated.researchFacts) ? generated.researchFacts : [],
    cards: Array.isArray(generated.cards) && generated.cards.length ? validateCards(generated.cards) : [],
    caption: cleanString(generated.caption),
    sourceSummary: Array.isArray(generated.sourceSummary) ? generated.sourceSummary : []
  };
}

function validateDeckGenerated(generated) {
  const cards = validateCards(generated.cards).map((card) => ({
    ...card,
    title: card.title === "Editor&apos;s Note" ? "Editor's Note" : card.title
  }));
  if (cards.length !== 7) {
    throw new AppError("Model returned a deck that is not exactly seven slides.", 502, "MODEL_OUTPUT_INVALID", `cards=${cards.length}`);
  }
  return {
    cards,
    caption: cleanString(generated.caption),
    hashtags: Array.isArray(generated.hashtags) ? generated.hashtags.map((tag) => cleanString(tag)).filter(Boolean) : [],
    creditNote: cleanString(generated.credit_note || generated.creditNote),
    sourceNote: cleanString(generated.source_note || generated.sourceNote)
  };
}


function requireSupabase() {
  if (!supabaseServiceRoleKey) {
    throw new AppError("SUPABASE_SERVICE_ROLE_KEY is missing.", 500, "MISSING_SUPABASE_KEY");
  }
}

async function supabaseRequest(pathname, options = {}) {
  requireSupabase();
  const response = await fetchWithTimeout(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  }, "Supabase API");
  const text = await response.text();
  if (!response.ok) {
    const migrationMissing = response.status === 400
      && ["human_decision", "human_saved", "last_recommended_at", "recommendation_count"].some((column) => text.includes(column));
    if (migrationMissing) {
      throw new AppError("Human Saved migration has not been applied.", 503, "MIGRATION_REQUIRED", text.slice(0, 500));
    }
    throw new AppError(`Supabase API failed with status ${response.status}.`, 502, "SUPABASE_API_ERROR", text.slice(0, 500));
  }
  if (!text || response.status === 204) return null;
  return parseJsonResponse(text, "Supabase API");
}

function toDbAnalysis(brief) {
  return {
    generated_title: cleanString(brief.generatedTitle),
    one_line_summary: cleanString(brief.oneLineSummary),
    three_line_summary: cleanString(brief.threeLineSummary),
    category: cleanString(brief.category, "Space"),
    recommendation_reason: cleanString(brief.recommendationReason),
    why_this_feels_good: cleanString(brief.whyThisFeelsGood),
    editorial_angle: cleanString(brief.editorialAngle || brief.angle),
    visual_strength: cleanString(brief.visualStrength),
    kevin_taste_fit: cleanString(brief.kevinTasteFit),
    suitability_score: Number.isFinite(Number(brief.suitabilityScore)) ? Number(brief.suitabilityScore) : null,
    taste_fit_score: Number.isFinite(Number(brief.tasteFitScore)) ? Number(brief.tasteFitScore) : null,
    visual_score: Number.isFinite(Number(brief.visualScore)) ? Number(brief.visualScore) : null,
    story_score: Number.isFinite(Number(brief.storyScore)) ? Number(brief.storyScore) : null,
    suggested_status: cleanString(brief.suggestedStatus, "Candidate"),
    key_points: Array.isArray(brief.keyPoints) ? brief.keyPoints : [],
    source_facts: Array.isArray(brief.sourceFacts) ? brief.sourceFacts : [],
    risk_notes: cleanString(brief.riskNotes),
    verification_needed: cleanString(brief.verificationNeeded || brief.verification),
    model: openaiModel
  };
}

function normalizeBoardRow(row) {
  const content = row.content_items || null;
  const kevinFind = row.kevin_finds || null;
  const analysis = row.ai_analyses || null;
  const source = content || kevinFind || {};
  const displayTitle = decodeXml(source.title || source.name || analysis?.generated_title || "Untitled Find");
  return {
    id: row.id,
    itemType: row.item_type,
    status: row.status,
    priority: row.priority,
    humanDecision: row.human_decision || "none",
    humanSaved: Boolean(row.human_saved),
    humanSavedAt: row.human_saved_at || null,
    lastRecommendedAt: row.last_recommended_at || null,
    recommendationCount: Number(row.recommendation_count || 0),
    editorNote: row.editor_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentItemId: row.content_item_id,
    kevinFindId: row.kevin_find_id,
    aiAnalysisId: row.ai_analysis_id,
    name: displayTitle,
    title: displayTitle,
    sourceUrl: source.url || "",
    sourceName: decodeXml(source.publisher || source.location || (source.url ? slugFromUrl(source.url) : row.item_type)),
    category: analysis?.category || source.category || "Space",
    notes: decodeXml(source.raw_content || source.notes || ""),
    angle: decodeXml(analysis?.editorial_angle || row.editor_note || ""),
    oneLineSummary: decodeXml(analysis?.one_line_summary || ""),
    whyThisFeelsGood: analysis?.why_this_feels_good || "",
    visualStrength: analysis?.visual_strength || "",
    kevinTasteFit: analysis?.kevin_taste_fit || "",
    recommendationReason: analysis?.recommendation_reason || "",
    suggestedStatus: analysis?.suggested_status || "Candidate",
    suitabilityScore: analysis?.suitability_score ?? null,
    tasteFitScore: analysis?.taste_fit_score ?? null,
    visualScore: analysis?.visual_score ?? null,
    storyScore: analysis?.story_score ?? null,
    verification: analysis?.verification_needed || "",
    imageUrl: normalizeExternalUrl(source.image_url || "", source.url || ""),
    imageCredit: source.image_credit || "",
    imageUsageStatus: source.image_usage_status || "unknown",
    createdAtLabel: row.created_at ? new Date(row.created_at).toLocaleString("ko-KR") : ""
  };
}


function decodeXml(value) {
  return cleanString(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&#([0-9]+);/g, (match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}

function decodeXmlDeep(value) {
  let decoded = cleanString(value);
  for (let index = 0; index < 3; index += 1) {
    const next = decodeXml(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function normalizeExternalUrl(value, baseUrl = "") {
  const decoded = decodeXmlDeep(value);
  const nestedHttpIndex = decoded.indexOf("https://", decoded.startsWith("https://") ? 8 : 0);
  const candidate = nestedHttpIndex > 0 ? decoded.slice(nestedHttpIndex) : decoded;
  return absolutizeUrl(candidate, baseUrl);
}

function stripHtml(value) {
  return decodeXmlDeep(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function firstTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function firstAttr(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseFeedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absolutizeUrl(value, baseUrl) {
  try {
    return new URL(decodeXmlDeep(value), baseUrl).toString();
  } catch {
    return cleanString(value);
  }
}

function parseFeedItems(xml, feedUrl) {
  const items = [];
  const rssItemPattern = /<item\b[\s\S]*?<\/item>/gi;
  const atomEntryPattern = /<entry\b[\s\S]*?<\/entry>/gi;
  const blocks = xml.match(rssItemPattern) || xml.match(atomEntryPattern) || [];
  for (const block of blocks.slice(0, 30)) {
    const title = stripHtml(firstTag(block, "title"));
    const link = absolutizeUrl(firstTag(block, "link") || firstAttr(block, "link", "href"), feedUrl);
    const description = stripHtml(firstTag(block, "description") || firstTag(block, "summary") || firstTag(block, "content:encoded") || firstTag(block, "content"));
    const imageUrl = absolutizeUrl(
      firstTag(block, "media:thumbnail") ||
      firstAttr(block, "media:thumbnail", "url") ||
      firstAttr(block, "media:content", "url") ||
      firstAttr(block, "enclosure", "url"),
      feedUrl
    );
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      rawExcerpt: description.slice(0, 1200),
      imageUrl,
      publishedAt: parseFeedDate(firstTag(block, "pubDate") || firstTag(block, "published") || firstTag(block, "updated"))
    });
  }
  return items;
}

async function fetchRssItems(feedUrl) {
  const response = await fetchWithTimeout(feedUrl, {
    headers: {
      "User-Agent": "dig.everyday RSS collector/0.1",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
    }
  }, "RSS Feed");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`RSS feed failed with status ${response.status}.`, 502, "RSS_FETCH_ERROR", text.slice(0, 500));
  }
  const items = parseFeedItems(text, feedUrl);
  if (!items.length) {
    throw new AppError("RSS feed did not contain readable items.", 422, "RSS_FETCH_ERROR", text.slice(0, 500));
  }
  return items;
}

function isEyesMagUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "eyesmag.com" || hostname === "www.eyesmag.com";
  } catch {
    return false;
  }
}

async function fetchEyesMagItems(siteUrl, limit) {
  const baseUrl = new URL(siteUrl);
  const apiUrl = new URL("/api/v1/posts", baseUrl);
  apiUrl.searchParams.set("page", "1");
  apiUrl.searchParams.set("limit", String(Math.max(1, Math.min(Number(limit) || autoCollectLimit, 8))));
  const response = await fetchWithTimeout(apiUrl.toString(), {
    headers: {
      "User-Agent": "dig.everyday source collector/0.1",
      Accept: "application/json"
    }
  }, "EYESMAG API");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`EYESMAG API failed with status ${response.status}.`, 502, "RSS_FETCH_ERROR", text.slice(0, 500));
  }
  const data = parseJsonResponse(text, "EYESMAG API");
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((item) => {
    const id = Number(item.id);
    const slug = cleanString(item.name);
    const title = stripHtml(item.title);
    if (!Number.isFinite(id) || !slug || !title) return null;
    const category = Array.isArray(item.categories)
      ? item.categories.map((entry) => cleanString(entry?.name)).filter(Boolean).join(", ")
      : "";
    const tags = Array.isArray(item.tags) ? item.tags.map(cleanString).filter(Boolean).join(", ") : "";
    const context = [stripHtml(item.excerpt), category && `카테고리: ${category}`, tags && `태그: ${tags}`].filter(Boolean).join(" / ");
    return {
      title,
      url: new URL(`/posts/${id}/${encodeURIComponent(slug)}`, baseUrl).toString(),
      rawExcerpt: context.slice(0, 1200),
      imageUrl: item.thumbnail ? new URL(cleanString(item.thumbnail), "https://cdn.eyesmag.com/").toString() : "",
      publishedAt: parseFeedDate(item.publishedAt)
    };
  }).filter(Boolean);
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(score <= 10 ? score * 10 : score, 100));
}

function decisionPatch(decision) {
  const now = new Date().toISOString();
  const patches = {
    post_today: { human_decision: "post_today", human_saved: true, human_saved_at: now, status: "Approved" },
    saved_candidate: { human_decision: "saved_candidate", human_saved: true, human_saved_at: now, status: "Candidate" },
    dig_more: { human_decision: "dig_more", human_saved: true, human_saved_at: now, status: "Dig More Candidate" },
    rejected: { human_decision: "rejected", human_saved: false, human_saved_at: null, status: "Rejected" }
  };
  if (!patches[decision]) throw new AppError("decision is not supported.", 400, "INVALID_INPUT", decision);
  return { ...patches[decision], updated_at: now };
}

function normalizeAnalysisForDb(analysis, category) {
  return {
    generated_title: cleanString(analysis.generated_title),
    one_line_summary: cleanString(analysis.one_line_summary),
    three_line_summary: cleanString(analysis.three_line_summary),
    category: cleanString(analysis.category, category || "Space"),
    recommendation_reason: cleanString(analysis.recommendation_reason),
    why_this_feels_good: cleanString(analysis.why_this_feels_good),
    editorial_angle: cleanString(analysis.editorial_angle),
    visual_strength: cleanString(analysis.visual_strength),
    kevin_taste_fit: cleanString(analysis.kevin_taste_fit),
    suitability_score: normalizeScore(analysis.suitability_score),
    taste_fit_score: normalizeScore(analysis.taste_fit_score),
    visual_score: normalizeScore(analysis.visual_score),
    story_score: normalizeScore(analysis.story_score),
    suggested_status: cleanString(analysis.suggested_status, "Candidate"),
    key_points: Array.isArray(analysis.key_points) ? analysis.key_points : [],
    source_facts: Array.isArray(analysis.source_facts) ? analysis.source_facts : [],
    risk_notes: cleanString(analysis.risk_notes),
    verification_needed: cleanString(analysis.verification_needed),
    model: openaiModel
  };
}

async function callOpenAIRssAnalysis(feed, item, category) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }
  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You are the first-pass editor for dig.everyday.",
            "Judge RSS items as lifestyle curation candidates, not news headlines.",
            "Prefer quiet, minimal, editorial, curated, timeless finds.",
            "Reject generic viral news, listicles, hype, and clickbait.",
            "All user-facing JSON string values must be Korean, except proper nouns.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Analyze this RSS item for curation.",
            "All score fields must be integers from 0 to 100.",
            "JSON shape:",
            "{",
            '  "generated_title": "...",',
            '  "one_line_summary": "...",',
            '  "three_line_summary": "...",',
            '  "category": "Fashion|Space|Food|Travel|Hotel|Object|Perfume|Architecture|Product|Brand|Book|Magazine|Artwork|Playlist",',
            '  "recommendation_reason": "...",',
            '  "why_this_feels_good": "...",',
            '  "editorial_angle": "...",',
            '  "visual_strength": "...",',
            '  "kevin_taste_fit": "...",',
            '  "suitability_score": 0,',
            '  "taste_fit_score": 0,',
            '  "visual_score": 0,',
            '  "story_score": 0,',
            '  "suggested_status": "Candidate|Approved|Hold|Rejected|Dig More Candidate",',
            '  "risk_notes": "...",',
            '  "verification_needed": "...",',
            '  "key_points": ["..."],',
            '  "source_facts": [{"section": "Context|Visual|Taste|Practical", "fact": "...", "confidence": "high|medium|low"}]',
            "}",
            "",
            JSON.stringify({ feed, item, preferredCategory: category }, null, 2)
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }
  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

async function resolveSourceDefinition(inputUrl) {
  const response = await fetchWithTimeout(inputUrl, {
    headers: {
      "User-Agent": "dig.everyday source discovery/0.1",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*"
    }
  }, "Source discovery");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`Source discovery failed with status ${response.status}.`, 502, "RSS_FETCH_ERROR", text.slice(0, 500));
  }
  const contentType = cleanString(response.headers.get("content-type")).toLowerCase();
  if (contentType.includes("xml") || /^\s*<\?xml|^\s*<(rss|feed)\b/i.test(text)) {
    return { type: "rss", url: inputUrl };
  }
  const linkTags = text.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = firstAttr(tag, "link", "rel").toLowerCase();
    const type = firstAttr(tag, "link", "type").toLowerCase();
    const href = firstAttr(tag, "link", "href");
    if (rel.includes("alternate") && (type.includes("rss") || type.includes("atom")) && href) {
      return { type: "rss", url: absolutizeUrl(href, inputUrl) };
    }
  }
  return { type: "url", url: inputUrl };
}

async function findSourceByUrl(url) {
  const rows = await supabaseRequest(`sources?select=*&url=eq.${encodeURIComponent(url)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  return rows?.[0] || null;
}

async function validateSourceCompatibility(definition) {
  if (definition.type === "rss") {
    const items = await fetchRssItems(definition.url);
    if (!items.length) throw new AppError("RSS feed contains no readable entries.", 422, "SOURCE_UNSUPPORTED", definition.url);
    return { type: "rss", readableItems: items.length };
  }
  const items = isEyesMagUrl(definition.url)
    ? await fetchEyesMagItems(definition.url, 1)
    : await fetchWebItems(definition.url, 1);
  if (!items.length) throw new AppError("Website contains no readable article links.", 422, "SOURCE_UNSUPPORTED", definition.url);
  return { type: "url", readableItems: items.length };
}

async function saveSource({ name, url, category, isActive = true }) {
  const definition = await resolveSourceDefinition(url);
  await validateSourceCompatibility(definition);
  const existing = await findSourceByUrl(definition.url);
  if (existing) {
    const rows = await supabaseRequest(`sources?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name, category, is_active: isActive })
    });
    return rows?.[0] || existing;
  }
  const rows = await supabaseRequest("sources", {
    method: "POST",
    body: JSON.stringify({ type: definition.type, name, url: definition.url, category, is_active: isActive })
  });
  return rows?.[0];
}

function metaContent(html, key, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrValue = firstAttr(tag, "meta", key).toLowerCase();
    if (attrValue === value.toLowerCase()) return decodeXml(firstAttr(tag, "meta", "content"));
  }
  return "";
}

async function fetchArticleMetadata(url, fallbackTitle) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "dig.everyday crawler/0.1", Accept: "text/html,application/xhtml+xml,*/*" }
    }, "Article page");
    const html = await response.text();
    if (!response.ok) return { title: fallbackTitle, url, rawExcerpt: "", imageUrl: "", publishedAt: null };
    const title = stripHtml(metaContent(html, "property", "og:title") || firstTag(html, "title") || fallbackTitle);
    const description = stripHtml(metaContent(html, "property", "og:description") || metaContent(html, "name", "description"));
    const imageUrl = normalizeExternalUrl(metaContent(html, "property", "og:image"), url);
    const publishedAt = parseFeedDate(metaContent(html, "property", "article:published_time") || metaContent(html, "name", "date"));
    return { title, url, rawExcerpt: description.slice(0, 1200), imageUrl, publishedAt };
  } catch {
    return { title: fallbackTitle, url, rawExcerpt: "", imageUrl: "", publishedAt: null };
  }
}

async function fetchWebItems(siteUrl, limit) {
  const response = await fetchWithTimeout(siteUrl, {
    headers: { "User-Agent": "dig.everyday crawler/0.1", Accept: "text/html,application/xhtml+xml,*/*" }
  }, "Website crawl");
  const html = await response.text();
  if (!response.ok) throw new AppError(`Website crawl failed with status ${response.status}.`, 502, "RSS_FETCH_ERROR", html.slice(0, 500));
  const base = new URL(siteUrl);
  const anchors = html.match(/<a\b[\s\S]*?<\/a>/gi) || [];
  const candidates = [];
  const seen = new Set();
  const excluded = /\/(tag|tags|category|categories|author|about|contact|privacy|terms|login|signup|search)(\/|$)/i;
  for (const anchor of anchors) {
    const href = firstAttr(anchor, "a", "href");
    const title = stripHtml(anchor.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
    if (!href || title.length < 12 || title.length > 180) continue;
    const url = absolutizeUrl(href, siteUrl);
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== base.hostname || parsed.pathname === "/" || excluded.test(parsed.pathname)) continue;
      parsed.hash = "";
      const canonical = parsed.toString();
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      candidates.push({ title, url: canonical });
    } catch {}
    if (candidates.length >= Math.max(limit * 3, 12)) break;
  }
  if (!candidates.length) throw new AppError("No readable article links were found in the initial HTML. The site may require JavaScript rendering, login, or browser automation.", 422, "SOURCE_UNSUPPORTED", siteUrl);
  const items = [];
  for (const candidate of candidates.slice(0, limit)) {
    items.push(await fetchArticleMetadata(candidate.url, candidate.title));
  }
  return items;
}

async function fetchSourceItems(source, limit) {
  if (isEyesMagUrl(source.url)) return fetchEyesMagItems(source.url, limit);
  if (source.type === "url") return fetchWebItems(source.url, limit);
  return (await fetchRssItems(source.url)).slice(0, limit);
}

async function getExistingContent(url) {
  const rows = await supabaseRequest(`content_items?select=*&url=eq.${encodeURIComponent(url)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  return rows?.[0] || null;
}

async function getExistingCuration(contentItemId) {
  const rows = await supabaseRequest(`curation_items?select=*,content_items(*),ai_analyses(*)&content_item_id=eq.${encodeURIComponent(contentItemId)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  return rows?.[0] || null;
}

async function collectSource(source, limit = autoCollectLimit) {
  const sourceItems = await fetchSourceItems(source, limit);
  const result = { source, imported: 0, skipped: 0, failed: 0, items: [] };

  for (const item of sourceItems) {
    try {
      let contentItem = await getExistingContent(item.url);
      if (contentItem) {
        const existingCuration = await getExistingCuration(contentItem.id);
        if (existingCuration) {
          result.skipped += 1;
          continue;
        }
      } else {
        const contentRows = await supabaseRequest("content_items", {
          method: "POST",
          body: JSON.stringify({
            source_id: source.id,
            source_type: source.type,
            title: item.title,
            url: item.url,
            image_url: item.imageUrl,
            image_source_url: item.url,
            image_usage_status: "unknown",
            publisher: source.name,
            published_at: item.publishedAt,
            raw_excerpt: item.rawExcerpt,
            raw_content: item.rawExcerpt,
            language: "unknown"
          })
        });
        contentItem = contentRows?.[0];
      }
      if (!contentItem?.id) throw new AppError("content_items insert returned no id.", 502, "SUPABASE_API_ERROR");

      const analysis = normalizeAnalysisForDb(await callOpenAIRssAnalysis({ name: source.name, url: source.url }, item, source.category), source.category);
      const analysisRows = await supabaseRequest("ai_analyses", {
        method: "POST",
        body: JSON.stringify({ item_type: "daily_find", content_item_id: contentItem.id, ...analysis })
      });
      const aiAnalysis = analysisRows?.[0];
      const boardRows = await supabaseRequest("curation_items", {
        method: "POST",
        body: JSON.stringify({
          item_type: "daily_find",
          content_item_id: contentItem.id,
          ai_analysis_id: aiAnalysis?.id || null,
          status: "Candidate",
          editor_note: analysis.editorial_angle || analysis.one_line_summary || ""
        })
      });
      result.items.push(normalizeBoardRow({ ...boardRows[0], content_items: contentItem, ai_analyses: aiAnalysis }));
      result.imported += 1;
    } catch (itemError) {
      result.failed += 1;
      log("error", "source item import failed", { sourceId: source.id, title: item.title, url: item.url, details: itemError.message });
    }
  }

  await supabaseRequest(`sources?id=eq.${encodeURIComponent(source.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ last_fetched_at: new Date().toISOString() })
  });
  return result;
}

async function listActiveSources() {
  return await supabaseRequest("sources?select=*&is_active=eq.true&order=created_at.asc", { method: "GET", headers: { Prefer: "" } }) || [];
}

async function beginCollectionRun(trigger = "manual", sourceIds = []) {
  const activeSources = await listActiveSources();
  const requestedIds = new Set(Array.isArray(sourceIds) ? sourceIds.map(cleanString).filter(Boolean) : []);
  const sources = requestedIds.size ? activeSources.filter((source) => requestedIds.has(source.id)) : activeSources;
  if (!sources.length) throw new AppError("No active sources were selected.", 400, "INVALID_INPUT");
  const runRows = await supabaseRequest("collection_runs", {
    method: "POST",
    body: JSON.stringify({ trigger, status: "running", source_count: sources.length })
  });
  return {
    runId: runRows?.[0]?.id || null,
    trigger,
    sources: sources.map(({ id, name }) => ({ id, name }))
  };
}

async function recordSourceCollection(runId, source, result, error = null, startedAt = new Date().toISOString()) {
  if (!runId) return;
  await supabaseRequest("source_collection_runs", {
    method: "POST",
    body: JSON.stringify({
      run_id: runId,
      source_id: source.id,
      source_name: source.name,
      status: error ? "failed" : result.failed ? "partial" : "completed",
      imported_count: result.imported || 0,
      skipped_count: result.skipped || 0,
      failed_count: error ? 1 : result.failed || 0,
      error_message: error?.message || null,
      started_at: startedAt
    })
  });
}

async function finalizeCollectionRun(runId) {
  const runs = await supabaseRequest(`source_collection_runs?select=imported_count,skipped_count,failed_count&run_id=eq.${encodeURIComponent(runId)}`, { method: "GET", headers: { Prefer: "" } }) || [];
  const collectionRows = await supabaseRequest(`collection_runs?select=*&id=eq.${encodeURIComponent(runId)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  const collection = collectionRows?.[0];
  if (!collection) throw new AppError("Collection run not found.", 404, "INVALID_INPUT");
  const summary = runs.reduce((total, run) => ({
    imported: total.imported + Number(run.imported_count || 0),
    skipped: total.skipped + Number(run.skipped_count || 0),
    failed: total.failed + Number(run.failed_count || 0)
  }), { imported: 0, skipped: 0, failed: 0 });
  const missing = Math.max(0, Number(collection.source_count || 0) - runs.length);
  summary.failed += missing;
  const status = summary.failed === 0 ? "completed" : summary.imported > 0 || summary.skipped > 0 ? "partial" : "failed";
  await supabaseRequest(`collection_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      imported_count: summary.imported,
      skipped_count: summary.skipped,
      failed_count: summary.failed,
      completed_at: new Date().toISOString()
    })
  });
  return { runId, sources: Number(collection.source_count || 0), ...summary, status };
}

async function handleListSources(req, res) {
  try {
    const rows = await supabaseRequest("sources?select=*&order=created_at.desc", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { sources: rows || [], collection: { mode: "manual", limit: autoCollectLimit } });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleCreateSource(req, res) {
  try {
    const body = await readBody(req);
    const url = validateUrl(cleanString(body.url));
    const name = cleanString(body.name, slugFromUrl(url));
    const category = cleanString(body.category, "Magazine");
    if (!categories.has(category)) throw new AppError("category is not supported.", 400, "INVALID_INPUT", category);
    const source = await saveSource({ name, url, category, isActive: body.isActive !== false });
    sendJson(res, 200, { source });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleImportRss(req, res) {
  try {
    const body = await readBody(req);
    const url = validateUrl(cleanString(body.url));
    const name = cleanString(body.name, slugFromUrl(url));
    const category = cleanString(body.category, "Magazine");
    const limit = Math.max(1, Math.min(Number(body.limit) || autoCollectLimit, 8));
    if (!categories.has(category)) throw new AppError("category is not supported.", 400, "INVALID_INPUT", category);
    const source = await saveSource({ name, url, category, isActive: true });
    const result = await collectSource(source, limit);
    sendJson(res, 200, result);
  } catch (error) {
    sendError(res, error);
  }
}

async function handleRunAllSources(req, res) {
  try {
    const body = await readBody(req);
    sendJson(res, 200, await beginCollectionRun("manual", body.sourceIds));
  } catch (error) {
    sendError(res, error);
  }
}

async function handleRunSource(req, res, id) {
  let source = null;
  let runId = "";
  const startedAt = new Date().toISOString();
  try {
    const body = await readBody(req);
    runId = cleanString(body.runId);
    const rows = await supabaseRequest(`sources?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    if (!rows?.[0]) throw new AppError("Source not found.", 404, "INVALID_INPUT");
    source = rows[0];
    const result = await collectSource(source, autoCollectLimit);
    await recordSourceCollection(runId, source, result, null, startedAt);
    sendJson(res, 200, result);
  } catch (error) {
    if (source && runId) await recordSourceCollection(runId, source, {}, error, startedAt).catch(() => {});
    sendError(res, error);
  }
}

async function handleFinalizeCollectionRun(req, res, id) {
  try {
    sendJson(res, 200, await finalizeCollectionRun(id));
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdateSource(req, res, id) {
  try {
    const body = await readBody(req);
    const patch = {};
    if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
    if (body.name !== undefined) patch.name = cleanString(body.name);
    if (body.category !== undefined) patch.category = cleanString(body.category);
    const rows = await supabaseRequest(`sources?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    sendJson(res, 200, { source: rows?.[0] || null });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleDeleteSource(req, res, id) {
  try {
    await supabaseRequest(`sources?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

function getZonedParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: autoCollectTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function handleCollectionRuns(req, res) {
  try {
    const rows = await supabaseRequest("collection_runs?select=*,source_collection_runs(*)&order=started_at.desc&limit=20", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { runs: rows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleListBoard(req, res) {
  try {
    const rows = await supabaseRequest("curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&order=updated_at.desc&limit=80", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { items: (rows || []).map(normalizeBoardRow) });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleTodayRecommendations(req, res) {
  try {
    const recommendationDate = getZonedParts().date;
    const existing = await supabaseRequest(`recommendation_snapshots?select=*,recommendation_snapshot_items(*,curation_items(*,content_items(*),kevin_finds(*),ai_analyses(*)))&recommendation_date=eq.${recommendationDate}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    if (existing?.[0]) {
      const snapshot = existing[0];
      if (Number(snapshot.item_count || 0) > 0) {
        const items = (snapshot.recommendation_snapshot_items || [])
          .sort((a, b) => a.rank - b.rank)
          .map((entry) => ({ ...normalizeBoardRow(entry.curation_items), finalScore: Number(entry.final_score), rank: entry.rank }))
          .filter((item) => item.status === "Candidate" && item.humanDecision !== "rejected");
        sendJson(res, 200, { items, snapshotId: snapshot.id, generatedAt: snapshot.generated_at, isSnapshot: true, collection: { mode: "manual" } });
        return;
      }
      await supabaseRequest(`recommendation_snapshots?id=eq.${encodeURIComponent(snapshot.id)}`, { method: "DELETE", headers: { Prefer: "" } });
    }

    const rows = await supabaseRequest("curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&status=eq.Candidate&human_decision=neq.rejected&order=created_at.desc&limit=100", { method: "GET", headers: { Prefer: "" } });
    const now = Date.now();
    const items = (rows || [])
      .map(normalizeBoardRow)
      .map((item) => ({ ...item, finalScore: calculateRecommendationScore(item) }))
      .sort((a, b) => recommendationTier(a, now) - recommendationTier(b, now)
        || b.finalScore - a.finalScore
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
    const recommendedAt = new Date().toISOString();
    if (!items.length) {
      sendJson(res, 200, {
        items: [],
        snapshotId: null,
        generatedAt: recommendedAt,
        isSnapshot: false,
        collection: { mode: "manual" }
      });
      return;
    }
    const snapshotRows = await supabaseRequest("recommendation_snapshots", {
      method: "POST",
      body: JSON.stringify({ recommendation_date: recommendationDate, generated_at: recommendedAt, item_count: items.length })
    });
    const snapshot = snapshotRows?.[0];
    if (snapshot?.id && items.length) {
      await supabaseRequest("recommendation_snapshot_items", {
        method: "POST",
        body: JSON.stringify(items.map((item, index) => ({
          snapshot_id: snapshot.id,
          curation_item_id: item.id,
          rank: index + 1,
          final_score: item.finalScore
        })))
      });
      await Promise.all(items.map((item) => supabaseRequest(`curation_items?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ last_recommended_at: recommendedAt, recommendation_count: item.recommendationCount + 1 })
      })));
    }
    sendJson(res, 200, {
      items: items.map((item, index) => ({ ...item, rank: index + 1, lastRecommendedAt: recommendedAt, recommendationCount: item.recommendationCount + 1 })),
      snapshotId: snapshot?.id || null,
      generatedAt: recommendedAt,
      isSnapshot: true,
      collection: { mode: "manual" }
    });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleToday(req, res) {
  return handleTodayRecommendations(req, res);
}

async function handleDecision(req, res, id) {
  try {
    const body = await readBody(req);
    const decision = cleanString(body.decision);
    const rows = await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(decisionPatch(decision))
    });
    if (!rows?.[0]) throw new AppError("Board item not found.", 404, "INVALID_INPUT", id);
    sendJson(res, 200, { item: rows[0], decision });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleBulkDecision(req, res) {
  try {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(cleanString).filter(Boolean))] : [];
    const decision = cleanString(body.decision);
    if (!ids.length || ids.length > 50) throw new AppError("ids must contain between 1 and 50 items.", 400, "INVALID_INPUT");
    if (decision === "post_today") throw new AppError("Bulk Post Today is not supported.", 400, "INVALID_INPUT");
    const encodedIds = ids.map((id) => encodeURIComponent(id)).join(",");
    const rows = await supabaseRequest(`curation_items?id=in.(${encodedIds})`, {
      method: "PATCH",
      body: JSON.stringify(decisionPatch(decision))
    });
    sendJson(res, 200, { items: rows || [], updated: rows?.length || 0, decision });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdateBoardItem(req, res, id) {
  try {
    const body = await readBody(req);
    const status = cleanString(body.status);
    const allowed = new Set(["Candidate", "Approved", "Hold", "Rejected", "Dig More Candidate"]);
    if (!allowed.has(status)) throw new AppError("status is not supported.", 400, "INVALID_INPUT", status);
    const rows = await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    sendJson(res, 200, { item: rows?.[0] || null });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleSaveDailyFind(req, res) {
  try {
    const body = await readBody(req);
    const brief = body.brief && typeof body.brief === "object" ? body.brief : body;
    const title = cleanString(brief.name || brief.generatedTitle, "Untitled Find");
    const sourceUrl = cleanString(brief.sourceUrl, `manual://daily-find/${Date.now()}`);
    const contentRows = await supabaseRequest("content_items?on_conflict=url", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        title,
        url: sourceUrl,
        image_url: cleanString(brief.imageUrl),
        image_credit: cleanString(brief.imageCredit),
        image_source_url: cleanString(brief.imageSourceUrl || brief.sourceUrl),
        image_usage_status: cleanString(brief.imageUsageStatus, "unknown"),
        publisher: cleanString(brief.sourceName),
        raw_excerpt: cleanString(brief.oneLineSummary || brief.angle),
        raw_content: cleanString(brief.notes),
        language: "ko"
      })
    });
    const contentItem = contentRows?.[0];
    if (!contentItem?.id) throw new AppError("content_items insert returned no id.", 502, "SUPABASE_API_ERROR");

    const analysisRows = await supabaseRequest("ai_analyses", {
      method: "POST",
      body: JSON.stringify({
        item_type: "daily_find",
        content_item_id: contentItem.id,
        ...toDbAnalysis(brief)
      })
    });
    const analysis = analysisRows?.[0];

    const boardRows = await supabaseRequest("curation_items", {
      method: "POST",
      body: JSON.stringify({
        item_type: "daily_find",
        content_item_id: contentItem.id,
        ai_analysis_id: analysis?.id || null,
        status: "Candidate",
        human_decision: "saved_candidate",
        human_saved: true,
        human_saved_at: new Date().toISOString(),
        editor_note: cleanString(brief.editorNote || brief.angle)
      })
    });
    sendJson(res, 200, { item: normalizeBoardRow({ ...boardRows[0], content_items: contentItem, ai_analyses: analysis }) });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleSaveKevinFind(req, res) {
  try {
    const body = await readBody(req);
    const name = cleanString(body.name, "Untitled Find");
    const findRows = await supabaseRequest("kevin_finds", {
      method: "POST",
      body: JSON.stringify({
        name,
        category: cleanString(body.category, "Object"),
        location: cleanString(body.location),
        visited_at: cleanString(body.visitedAt) || null,
        rating: Number.isFinite(Number(body.rating)) ? Number(body.rating) : null,
        notes: cleanString(body.notes),
        why_saved: cleanString(body.whySaved),
        image_url: cleanString(body.imageUrl),
        image_credit: cleanString(body.imageCredit),
        image_source_url: cleanString(body.imageSourceUrl),
        image_usage_status: cleanString(body.imageUsageStatus, "owned")
      })
    });
    const kevinFind = findRows?.[0];
    if (!kevinFind?.id) throw new AppError("kevin_finds insert returned no id.", 502, "SUPABASE_API_ERROR");

    const boardRows = await supabaseRequest("curation_items", {
      method: "POST",
      body: JSON.stringify({
        item_type: "kevin_found",
        kevin_find_id: kevinFind.id,
        status: "Candidate",
        human_decision: "saved_candidate",
        human_saved: true,
        human_saved_at: new Date().toISOString(),
        editor_note: cleanString(body.whySaved || body.notes)
      })
    });
    sendJson(res, 200, { item: normalizeBoardRow({ ...boardRows[0], kevin_finds: kevinFind }) });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleDeleteBoardItem(req, res, id) {
  try {
    await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleGetBoardItem(req, res, id) {
  try {
    const rows = await supabaseRequest(`curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    const row = rows?.[0];
    if (!row) throw new AppError("Board item not found.", 404, "INVALID_INPUT");
    sendJson(res, 200, { item: normalizeBoardRow(row) });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleSavePostDraft(req, res) {
  try {
    const body = await readBody(req);
    const cards = validateCards(body.cards);
    if (cards.length !== 7) throw new AppError("Post draft must have exactly seven slides.", 400, "INVALID_INPUT");
    const draftRows = await supabaseRequest("post_drafts", {
      method: "POST",
      body: JSON.stringify({
        curation_item_id: cleanString(body.curationItemId) || null,
        title: cleanString(body.title, "Untitled Find"),
        category: cleanString(body.category),
        source_type: cleanString(body.sourceType, "daily_find"),
        status: "Draft",
        format: cleanString(body.format, "Check-in"),
        hook: cleanString(body.hook),
        image_credit: cleanString(body.imageCredit),
        image_usage_status: cleanString(body.imageUsageStatus, "unknown"),
        caption: cleanString(body.caption),
        hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
        credit_note: cleanString(body.creditNote),
        source_note: cleanString(body.sourceNote),
        editor_note: cleanString(body.editorNote)
      })
    });
    const draft = draftRows?.[0];
    if (!draft?.id) throw new AppError("post_drafts insert returned no id.", 502, "SUPABASE_API_ERROR");
    const slideRows = await supabaseRequest("post_slides", {
      method: "POST",
      body: JSON.stringify(cards.map((card, index) => ({
        post_draft_id: draft.id,
        slide_index: index + 1,
        slide_type: ["Cover", "Introduction", "Why It Matters", "Detail 1", "Detail 2", "Editor's Note", "CTA"][index],
        title: card.title,
        body: card.copy
      })))
    });
    sendJson(res, 200, { draft, slides: slideRows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleListPostDrafts(req, res) {
  try {
    const rows = await supabaseRequest("post_drafts?select=*,post_slides(*)&order=updated_at.desc&limit=50", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { drafts: rows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleGetPostDraft(req, res, id) {
  try {
    const rows = await supabaseRequest(`post_drafts?select=*,post_slides(*)&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    const draft = rows?.[0];
    if (!draft) throw new AppError("Post draft not found.", 404, "INVALID_INPUT");
    await supabaseRequest(`post_drafts?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ last_opened_at: new Date().toISOString() }) });
    sendJson(res, 200, { draft });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdatePostDraft(req, res, id) {
  try {
    const body = await readBody(req);
    const cards = validateCards(body.cards);
    if (cards.length !== 7) throw new AppError("Post draft must have exactly seven slides.", 400, "INVALID_INPUT");
    const allowedStatus = new Set(["Draft", "Editing", "Ready to Export", "Exported", "Published"]);
    const status = cleanString(body.status, "Editing");
    if (!allowedStatus.has(status)) throw new AppError("Draft status is not supported.", 400, "INVALID_INPUT");
    const draftRows = await supabaseRequest(`post_drafts?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: cleanString(body.title, "Untitled Find"),
        category: cleanString(body.category),
        status,
        format: cleanString(body.format, "Check-in"),
        hook: cleanString(body.hook),
        caption: cleanString(body.caption),
        editor_note: cleanString(body.editorNote),
        updated_at: new Date().toISOString()
      })
    });
    await supabaseRequest(`post_slides?post_draft_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    const slides = await supabaseRequest("post_slides", {
      method: "POST",
      body: JSON.stringify(cards.map((card, index) => ({
        post_draft_id: id,
        slide_index: index + 1,
        slide_type: ["Cover", "Introduction", "Why It Matters", "Detail 1", "Detail 2", "Editor's Note", "CTA"][index],
        title: card.title,
        body: card.copy
      })))
    });
    sendJson(res, 200, { draft: draftRows?.[0] || null, slides: slides || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleDeletePostDraft(req, res, id) {
  try {
    await supabaseRequest(`post_drafts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleListKevinFinds(req, res, parsed) {
  try {
    const search = cleanString(parsed.searchParams.get("search"));
    const category = cleanString(parsed.searchParams.get("category"));
    let query = "kevin_finds?select=*&order=updated_at.desc&limit=100";
    if (category && category !== "All") query += `&category=eq.${encodeURIComponent(category)}`;
    const rows = await supabaseRequest(query, { method: "GET", headers: { Prefer: "" } });
    const finds = search
      ? (rows || []).filter((item) => [item.name, item.location, item.notes, item.why_saved].some((value) => cleanString(value).toLowerCase().includes(search.toLowerCase())))
      : rows || [];
    sendJson(res, 200, { finds });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdateKevinFind(req, res, id) {
  try {
    const body = await readBody(req);
    const patch = { updated_at: new Date().toISOString() };
    ["name", "category", "location", "notes", "why_saved", "image_url", "image_credit", "image_source_url", "image_usage_status"].forEach((key) => {
      const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      if (body[camel] !== undefined) patch[key] = cleanString(body[camel]);
    });
    if (body.visitedAt !== undefined) patch.visited_at = cleanString(body.visitedAt) || null;
    if (body.rating !== undefined) patch.rating = Number(body.rating) || null;
    const rows = await supabaseRequest(`kevin_finds?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    sendJson(res, 200, { find: rows?.[0] || null });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleDeleteKevinFind(req, res, id) {
  try {
    await supabaseRequest(`kevin_finds?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

async function callPerplexity(input) {
  if (!env.PERPLEXITY_API_KEY) {
    throw new AppError("PERPLEXITY_API_KEY is missing.", 500, "MISSING_PERPLEXITY_KEY");
  }

  const prompt = [
    `URL: ${input.sourceUrl || "none"}`,
    `Name: ${input.name || "Untitled Space"}`,
    `Category: ${input.category || "Space"}`,
    `Notes: ${input.notes || "none"}`,
    "",
    "Do deep editorial research for dig.everyday, a Korean Instagram curation system about lifestyle finds.",
    "The output will be used for editorial curation first, so do not stop at a short summary.",
    "",
    "Research requirements:",
    "1. Identify official website, official social accounts, press/editorial articles, map/listing pages, and credible third-party mentions when available.",
    "2. Extract origin: founder/operator, opening year, neighborhood/city, original concept, prior context.",
    "3. Extract growth: expansion, collaborations, menu/product changes, design changes, media attention, visitor behavior.",
    "4. Extract signature: spatial details, facade, material, lighting, furniture, menu/object/product, service ritual, photo-worthy element.",
    "5. Explain why it matters: cultural context, trend signal, local meaning, brand strategy, why people save/share it.",
    "6. List uncertain claims separately. Do not present uncertain information as fact.",
    "7. Include practical facts only if found: address, opening hours, reservation method, price range, official links.",
    "",
    "Output language rule:",
    "- Write the entire research report in Korean.",
    "- If sources are English, translate the meaning into Korean.",
    "- Do not leave English paragraphs in the result unless it is a proper noun, brand name, menu name, address, or cited title.",
    "",
    "Output in Korean with compact but detailed bullets.",
    "Avoid marketing language, excessive adjectives, and exclamation marks.",
    "Prefer citations and source-aware details over generic claims."
  ].join("\n");

  const response = await fetchWithTimeout(perplexitySonarUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: perplexityModel,
      messages: [
        {
          role: "system",
          content: "You are a precise web researcher for dig.everyday, a Korean editorial Instagram curation system about lifestyle finds."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 6000
    })
  }, "Perplexity API");

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`Perplexity API failed with status ${response.status}.`, 502, "PERPLEXITY_API_ERROR", text.slice(0, 500));
  }

  const data = parseJsonResponse(text, "Perplexity API");
  return {
    content: data.choices?.[0]?.message?.content || "",
    citations: data.citations || [],
    searchResults: data.search_results || []
  };
}

async function callOpenAI(input, research) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }

  const sourceText = JSON.stringify({
    input,
    perplexityResearch: research.content,
    citations: research.citations,
    searchResults: research.searchResults
  }, null, 2);

  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You write for dig.everyday, a Korean editorial Instagram curation system.",
            "All user-facing JSON string values must be written in Korean.",
            "Translate English research material into natural Korean before writing.",
            "Keep proper nouns, brand names, place names, menu names, and URLs in their original form when needed.",
            "Tone: short, dry, dense with information.",
            "Analyze first. Separate summary, classification, and taste evaluation from post copy.",
            "Do not generate carousel slides in Analyze. Only generate analysis fields for curation.",
            "Forbidden: marketing copy, excessive adjectives, exclamation marks.",
            "Do not invent facts. Separate facts, interpretation, and verification needs.",
            "The brief must contain enough material for a later seven-slide post.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Create a production-ready Analyze result from this research.",
            "JSON shape:",
            "{",
            '  "brief": {"angle": "...", "notes": "8-12 dense Korean bullets grouped by Origin/Growth/Signature/Context", "verification": "specific unchecked claims and what source should confirm them"},',
            '  "analysis": {"generated_title": "...", "one_line_summary": "...", "three_line_summary": "...", "category": "Fashion|Space|Food|Travel|Hotel|Object|Perfume|Architecture|Product|Brand|Book|Magazine|Artwork|Playlist", "recommendation_reason": "...", "why_this_feels_good": "...", "editorial_angle": "...", "visual_strength": "...", "kevin_taste_fit": "...", "suitability_score": 0, "taste_fit_score": 0, "visual_score": 0, "story_score": 0, "suggested_status": "Candidate|Approved|Hold|Rejected|Dig More Candidate", "risk_notes": "...", "verification_needed": "..."},',
            '  "researchFacts": [{"section": "Origin|Context|Visual|Taste|Practical", "fact": "...", "sourceHint": "...", "confidence": "high|medium|low"}],',
            '  "sourceSummary": [{"title": "...", "url": "..."}]',
            "}",
            "",
            "Taste filter rules:",
            "- This is not a trend detector. Judge whether the find feels quiet, minimal, editorial, curated, and timeless.",
            "- why_this_feels_good must explain mood, material, context, restraint, or rhythm.",
            "- visual_strength must judge whether images can carry an Instagram carousel.",
            "- kevin_taste_fit must be honest. Reject generic viral content.",
            "- Avoid words like must-visit, hidden gem, perfect, special, amazing.",
            "",
            sourceText
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }

  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

async function callOpenAICreateDeck(input) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }

  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You write for dig.everyday, a Korean editorial Instagram curation system.",
            "All user-facing text must be Korean, except proper nouns.",
            "Tone: short, dry, dense with information.",
            "Forbidden: marketing copy, excessive adjectives, exclamation marks.",
            "Do not create a Source Note card.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Create an exact seven-slide Instagram carousel draft and caption.",
            "Use this fixed slide structure in order: Cover, Introduction, Why It Matters, Detail 1, Detail 2, Editor's Note, CTA.",
            "JSON shape:",
            "{",
            "  \"cards\": [{\"title\": \"Cover\", \"copy\": \"1-3 short Korean lines\"}, {\"title\": \"Introduction\", \"copy\": \"...\"}, {\"title\": \"Why It Matters\", \"copy\": \"...\"}, {\"title\": \"Detail 1\", \"copy\": \"...\"}, {\"title\": \"Detail 2\", \"copy\": \"...\"}, {\"title\": \"Editor's Note\", \"copy\": \"...\"}, {\"title\": \"CTA\", \"copy\": \"...\"}],",
            '  "caption": "short Korean caption",',
            '  "hashtags": ["#..."],',
            '  "credit_note": "image/source credit note",',
            '  "source_note": "source verification note"',
            "}",
            "",
            JSON.stringify(input, null, 2)
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }

  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

async function handleResearch(req, res) {
  try {
    const body = await readBody(req);
    const input = validateResearchInput(body);

    log("info", "analyze request started", { route: "/api/research", name: input.name, category: input.category, hasSourceUrl: Boolean(input.sourceUrl) });
    const research = await callPerplexity(input);
    const generated = validateResearchGenerated(await callOpenAI(input, research));
    const now = new Date();

    sendJson(res, 200, {
      brief: {
        id: Date.now(),
        name: input.name,
        sourceUrl: input.sourceUrl,
        category: input.category,
        sourceName: input.sourceUrl ? slugFromUrl(input.sourceUrl) : "manual note",
        notes: generated.brief?.notes || research.content,
        angle: generated.brief?.angle || generated.analysis?.editorial_angle || "",
        generatedTitle: generated.analysis?.generated_title || "",
        oneLineSummary: generated.analysis?.one_line_summary || "",
        threeLineSummary: generated.analysis?.three_line_summary || "",
        recommendationReason: generated.analysis?.recommendation_reason || "",
        whyThisFeelsGood: generated.analysis?.why_this_feels_good || "",
        editorialAngle: generated.analysis?.editorial_angle || "",
        visualStrength: generated.analysis?.visual_strength || "",
        kevinTasteFit: generated.analysis?.kevin_taste_fit || "",
        suitabilityScore: generated.analysis?.suitability_score ?? null,
        tasteFitScore: generated.analysis?.taste_fit_score ?? null,
        visualScore: generated.analysis?.visual_score ?? null,
        storyScore: generated.analysis?.story_score ?? null,
        suggestedStatus: generated.analysis?.suggested_status || "Candidate",
        riskNotes: generated.analysis?.risk_notes || "",
        verificationNeeded: generated.analysis?.verification_needed || generated.brief?.verification || "위치, 운영 시간, 예약 방식, 가격, 공식 표기 확인 필요",
        verification: generated.brief?.verification || generated.analysis?.verification_needed || "위치, 운영 시간, 예약 방식, 가격, 공식 표기 확인 필요",
        imageCredit: input.imageCredit,
        imageUsageStatus: input.imageUsageStatus,
        createdAt: now.toLocaleString("ko-KR")
      },
      cards: Array.isArray(generated.cards) ? generated.cards : [],
      caption: generated.caption || "",
      sources: generated.sourceSummary || research.searchResults || [],
      researchFacts: generated.researchFacts || [],
      citations: research.citations || []
    });
    log("info", "analyze request completed", { route: "/api/research", name: input.name, cardCount: generated.cards.length });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleCreateDeck(req, res) {
  try {
    const body = await readBody(req);
    const input = validateDeckInput(body);
    log("info", "deck request started", { route: "/api/create-deck", title: input.title, format: input.format });
    const generated = validateDeckGenerated(await callOpenAICreateDeck(input));

    sendJson(res, 200, {
      cards: generated.cards,
      caption: generated.caption || "",
      hashtags: generated.hashtags || [],
      creditNote: generated.creditNote || "",
      sourceNote: generated.sourceNote || ""
    });
    log("info", "deck request completed", { route: "/api/create-deck", title: input.title, cardCount: generated.cards.length });
  } catch (error) {
    sendError(res, error);
  }
}

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

  if (req.method === "POST" && pathname === "/api/research") {
    handleResearch(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/create-deck") {
    handleCreateDeck(req, res);
    return;
  }
  if (req.method === "GET" && pathname === "/api/collection-runs") {
    handleCollectionRuns(req, res);
    return;
  }
  const finalizeCollectionMatch = pathname.match(/^\/api\/collection-runs\/([^/]+)\/finalize$/);
  if (finalizeCollectionMatch && req.method === "POST") {
    handleFinalizeCollectionRun(req, res, finalizeCollectionMatch[1]);
    return;
  }
  if (req.method === "GET" && pathname === "/api/post-drafts") {
    handleListPostDrafts(req, res);
    return;
  }
  if (req.method === "GET" && pathname === "/api/kevin-finds") {
    handleListKevinFinds(req, res, parsed);
    return;
  }
  if (req.method === "GET" && pathname === "/api/curation-items") {
    handleListBoard(req, res);
    return;
  }
  if (req.method === "GET" && (pathname === "/api/today" || pathname === "/api/recommendations/today")) {
    handleTodayRecommendations(req, res);
    return;
  }
  if (req.method === "PATCH" && pathname === "/api/curation-items/bulk-decision") {
    handleBulkDecision(req, res);
    return;
  }
  if (req.method === "GET" && pathname === "/api/sources") {
    handleListSources(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/sources") {
    handleCreateSource(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/sources/run-all") {
    handleRunAllSources(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/curation-items/daily-find") {
    handleSaveDailyFind(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/sources/rss-import") {
    handleImportRss(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/kevin-finds") {
    handleSaveKevinFind(req, res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/post-drafts") {
    handleSavePostDraft(req, res);
    return;
  }
  const postDraftMatch = pathname.match(/^\/api\/post-drafts\/([^/]+)$/);
  if (postDraftMatch && req.method === "GET") {
    handleGetPostDraft(req, res, postDraftMatch[1]);
    return;
  }
  if (postDraftMatch && req.method === "PATCH") {
    handleUpdatePostDraft(req, res, postDraftMatch[1]);
    return;
  }
  if (postDraftMatch && req.method === "DELETE") {
    handleDeletePostDraft(req, res, postDraftMatch[1]);
    return;
  }
  const kevinFindMatch = pathname.match(/^\/api\/kevin-finds\/([^/]+)$/);
  if (kevinFindMatch && req.method === "PATCH") {
    handleUpdateKevinFind(req, res, kevinFindMatch[1]);
    return;
  }
  if (kevinFindMatch && req.method === "DELETE") {
    handleDeleteKevinFind(req, res, kevinFindMatch[1]);
    return;
  }
  const sourceRunMatch = pathname.match(/^\/api\/sources\/([^/]+)\/run$/);
  if (sourceRunMatch && req.method === "POST") {
    handleRunSource(req, res, sourceRunMatch[1]);
    return;
  }
  const sourceMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch && req.method === "PATCH") {
    handleUpdateSource(req, res, sourceMatch[1]);
    return;
  }
  if (sourceMatch && req.method === "DELETE") {
    handleDeleteSource(req, res, sourceMatch[1]);
    return;
  }
  const boardDecisionMatch = pathname.match(/^\/api\/curation-items\/([^/]+)\/decision$/);
  if (boardDecisionMatch && req.method === "PATCH") {
    handleDecision(req, res, boardDecisionMatch[1]);
    return;
  }
  const boardItemMatch = pathname.match(/^\/api\/curation-items\/([^/]+)$/);
  if (boardItemMatch && req.method === "GET") {
    handleGetBoardItem(req, res, boardItemMatch[1]);
    return;
  }
  if (boardItemMatch && req.method === "PATCH") {
    handleUpdateBoardItem(req, res, boardItemMatch[1]);
    return;
  }
  if (boardItemMatch && req.method === "DELETE") {
    handleDeleteBoardItem(req, res, boardItemMatch[1]);
    return;
  }
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
