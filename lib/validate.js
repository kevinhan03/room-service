const { URL } = require("node:url");
const { categories, AppError } = require("./config");

function slugFromUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "manual note";
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

function validateReferenceUrls(value, sourceUrl = "") {
  const rawUrls = Array.isArray(value) ? value : cleanString(value).split(/[\n,]+/);
  const urls = [];
  const seen = new Set();
  for (const rawUrl of [sourceUrl, ...rawUrls]) {
    const candidate = cleanString(rawUrl);
    if (!candidate) continue;
    const url = validateUrl(candidate);
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  if (urls.length > 10) {
    throw new AppError("referenceUrls can contain at most 10 URLs.", 400, "INVALID_INPUT");
  }
  return urls;
}

function validateResearchInput(body) {
  const sourceUrl = validateUrl(cleanString(body.sourceUrl));
  const input = {
    name: cleanString(body.name, "Untitled Space"),
    sourceUrl,
    referenceUrls: validateReferenceUrls(body.referenceUrls, sourceUrl),
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
    curationItemId: cleanString(body.curationItemId),
    title: cleanString(body.title, "Untitled Space"),
    format: cleanString(body.format, "Check-in"),
    angle: cleanString(body.angle),
    whyILikeThis: cleanString(body.whyILikeThis),
    kevinAngle: cleanString(body.kevinAngle),
    hook: cleanString(body.hook),
    notes: cleanString(body.notes),
    imageCredit: cleanString(body.imageCredit),
    imageUsageStatus: cleanString(body.imageUsageStatus, "unknown")
  };
  assertMaxLength(input.title, 120, "title");
  assertMaxLength(input.curationItemId, 80, "curationItemId");
  assertMaxLength(input.format, 40, "format");
  assertMaxLength(input.angle, 2000, "angle");
  assertMaxLength(input.whyILikeThis, 4000, "whyILikeThis");
  assertMaxLength(input.kevinAngle, 1000, "kevinAngle");
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
    const imageUrl = cleanString(card?.imageUrl || card?.image_url);
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      throw new AppError("Card image URL must use http or https.", 400, "INVALID_INPUT", `card index=${index}`);
    }
    return { title, copy, imageUrl };
  });
}

function validateDraftCards(cards) {
  if (!Array.isArray(cards)) {
    throw new AppError("Cards must be an array.", 400, "INVALID_INPUT");
  }
  return cards.map((card, index) => {
    const title = cleanString(card?.title);
    const copy = cleanString(card?.copy);
    assertMaxLength(title, 200, `cards[${index}].title`);
    assertMaxLength(copy, 4000, `cards[${index}].copy`);
    const imageUrl = cleanString(card?.imageUrl || card?.image_url);
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      throw new AppError("Card image URL must use http or https.", 400, "INVALID_INPUT", `card index=${index}`);
    }
    return { title, copy, imageUrl };
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
    kevinAngle: cleanString(generated.kevin_angle || generated.kevinAngle),
    caption: cleanString(generated.caption),
    hashtags: Array.isArray(generated.hashtags) ? generated.hashtags.map((tag) => cleanString(tag)).filter(Boolean) : [],
    creditNote: cleanString(generated.credit_note || generated.creditNote),
    sourceNote: cleanString(generated.source_note || generated.sourceNote)
  };
}

const unnaturalDeckPatterns = [
  ["체류형", /체류형/g],
  ["경험형", /경험형/g],
  ["라이프스타일 공간", /라이프스타일\s*공간/g],
  ["공간 경험", /공간\s*경험/g],
  ["브랜드 태도", /브랜드의?\s*태도/g],
  ["조명한다", /조명(?:한다|했다|하는)/g],
  ["선사한다", /선사(?:한다|했다|하는)/g],
  ["어우러진다", /어우러(?:진다|져|지는)/g],
  ["돋보인다", /돋보/g],
  ["주목한다", /주목(?:한다|할 만하다|해볼 만하다)/g],
  ["단순한 것을 넘어", /단순(?:한|히).{0,20}(?:넘어|아니라)/g],
  ["새로운 기준", /새로운\s*기준/g],
  ["특별한 경험", /특별한\s*경험/g],
  ["감각적인", /감각적(?:인|이다|으로)/g],
  ["매력적", /매력적(?:인|이다|으로)/g],
  ["좋은 곳", /좋은\s*곳/g],
  ["다른 모습", /(?:전혀|완전히)?\s*다른\s*모습/g],
  ["지루할 틈", /지루할\s*틈/g],
  ["한층 더", /한층\s*더/g],
  ["기분 전환", /기분\s*전환/g],
  ["~하기 좋다", /(?:하기|보기|쉬기|머물기|즐기기)\s*좋/g],
  ["자연스럽게", /자연스럽게/g],
  ["흥미롭다", /흥미롭/g],
  ["눈에 띈다", /눈에\s*띈/g],
  ["편하게", /편하게/g],
  ["꼭 확인", /꼭\s*확인/g],
  ["다른 얼굴", /다른\s*얼굴/g],
  ["~와 함께", /와\s*함께|과\s*함께/g],
  ["곳곳에", /곳곳에/g],
  ["시간을 보내다", /시간을\s*보내/g]
];

function deckNaturalnessIssues(deck) {
  const text = [
    ...deck.cards.flatMap((card) => [card.title, card.copy]),
    deck.caption
  ].join("\n");
  const issues = unnaturalDeckPatterns
    .filter(([, pattern]) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    })
    .map(([label]) => label);
  const atmosphereCount = (text.match(/분위기/g) || []).length;
  if (atmosphereCount >= 3) issues.push(`분위기 반복 ${atmosphereCount}회`);
  return issues;
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(score <= 10 ? score * 10 : score, 100));
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

function absolutizeUrl(value, baseUrl) {
  try {
    return new URL(decodeXmlDeep(value), baseUrl).toString();
  } catch {
    return cleanString(value);
  }
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

module.exports = {
  slugFromUrl,
  cleanString,
  assertMaxLength,
  validateUrl,
  validateReferenceUrls,
  validateResearchInput,
  validateDeckInput,
  validateCards,
  validateDraftCards,
  validateResearchGenerated,
  validateDeckGenerated,
  unnaturalDeckPatterns,
  deckNaturalnessIssues,
  normalizeScore,
  decodeXml,
  decodeXmlDeep,
  absolutizeUrl,
  normalizeExternalUrl,
  stripHtml,
  firstTag,
  firstAttr
};
