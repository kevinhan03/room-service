const { supabaseRequest, normalizeBoardRow } = require("./supabase-client");
const { cleanString, normalizeScore } = require("./validate");
const { log } = require("./http");

const ACTION_WEIGHTS = Object.freeze({
  post_today: 10,
  save_candidate: 7,
  dig_more: 4,
  reject: -8,
  why_note: 8,
  inbox_created: 9,
  idea_selected: 7,
  idea_held: 0,
  idea_researched: 6,
  kevin_find_created: 9,
  board_approved: 5,
  board_held: 0
});

const STOP_WORDS = new Set([
  "그리고", "하지만", "대한", "위한", "있는", "없는", "하는", "되는", "같은",
  "에서", "으로", "에게", "보다", "까지", "부터", "이것", "저것", "그것",
  "공간", "브랜드", "게시물", "콘텐츠", "아이디어", "추천", "이유", "정도"
]);

function tokenize(value) {
  return cleanString(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function addWeight(map, key, weight) {
  const normalized = cleanString(key);
  if (!normalized || !Number.isFinite(Number(weight))) return;
  map.set(normalized, (map.get(normalized) || 0) + Number(weight));
}

function addTextWeights(map, value, weight) {
  [...new Set(tokenize(value))].forEach((token) => addWeight(map, token, weight));
}

function eventMetadataFromItem(item) {
  return {
    title: cleanString(item?.name || item?.title),
    angle: cleanString(item?.angle),
    whyILikeThis: cleanString(item?.whyILikeThis),
    category: cleanString(item?.category),
    sourceType: cleanString(item?.sourceKind || item?.itemType)
  };
}

async function recordRecommendationEvent(action, {
  curationItemId = null,
  inboxItemId = null,
  inboxIdeaId = null,
  category = "",
  sourceType = "",
  metadata = {}
} = {}) {
  const weight = ACTION_WEIGHTS[action];
  if (weight === undefined) return null;
  try {
    const rows = await supabaseRequest("recommendation_events", {
      method: "POST",
      body: JSON.stringify({
        curation_item_id: curationItemId || null,
        inbox_item_id: inboxItemId || null,
        inbox_idea_id: inboxIdeaId || null,
        action,
        weight,
        category: cleanString(category) || null,
        source_type: cleanString(sourceType) || null,
        metadata
      })
    });
    return rows?.[0] || null;
  } catch (error) {
    log("error", "recommendation event write failed", { action, details: error.message });
    return null;
  }
}

async function fetchBoardItem(id) {
  if (!id) return null;
  const rows = await supabaseRequest(`curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  return rows?.[0] ? normalizeBoardRow(rows[0]) : null;
}

async function recordCurationAction(action, curationItemId, metadata = {}) {
  const item = await fetchBoardItem(curationItemId);
  if (!item) return null;
  return recordRecommendationEvent(action, {
    curationItemId,
    category: item.category,
    sourceType: item.sourceKind,
    metadata: { ...eventMetadataFromItem(item), ...metadata }
  });
}

async function loadTasteSignals() {
  const [events, rows] = await Promise.all([
    supabaseRequest("recommendation_events?select=*&order=created_at.desc&limit=500", { method: "GET", headers: { Prefer: "" } }) || [],
    supabaseRequest("curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&or=(human_saved.eq.true,why_i_like_this.not.is.null)&order=updated_at.desc&limit=150", { method: "GET", headers: { Prefer: "" } }) || []
  ]);
  const categoryWeights = new Map();
  const sourceWeights = new Map();
  const keywordWeights = new Map();
  const eventCurationIds = new Set(events.map((event) => event.curation_item_id).filter(Boolean));

  for (const event of events) {
    const weight = Number(event.weight || 0);
    addWeight(categoryWeights, event.category, weight);
    addWeight(sourceWeights, event.source_type, weight);
    const metadata = event.metadata || {};
    addTextWeights(keywordWeights, [metadata.title, metadata.angle, metadata.whyILikeThis].filter(Boolean).join(" "), weight);
  }

  for (const row of rows) {
    if (eventCurationIds.has(row.id)) continue;
    const item = normalizeBoardRow(row);
    const stateWeight = item.whyILikeThis ? ACTION_WEIGHTS.why_note : item.humanSaved ? ACTION_WEIGHTS.save_candidate : 0;
    if (!stateWeight) continue;
    addWeight(categoryWeights, item.category, stateWeight);
    addWeight(sourceWeights, item.sourceKind, stateWeight);
    addTextWeights(keywordWeights, [item.name, item.angle, item.whyILikeThis].filter(Boolean).join(" "), stateWeight);
  }

  return { categoryWeights, sourceWeights, keywordWeights, sampleCount: events.length + rows.length };
}

function positiveScale(value, maximum) {
  if (!maximum || value <= 0) return 0;
  return Math.round(Math.min(100, (value / maximum) * 100) * 10) / 10;
}

function scoreIdea(idea, signals) {
  const positiveCategories = [...signals.categoryWeights.values()].filter((value) => value > 0);
  const negativeCategories = [...signals.categoryWeights.values()].filter((value) => value < 0).map(Math.abs);
  const categoryMax = Math.max(0, ...positiveCategories);
  const categoryWeight = signals.categoryWeights.get(cleanString(idea.category)) || 0;
  const categoryScore = positiveScale(categoryWeight, categoryMax);
  const categoryPenalty = positiveScale(Math.abs(Math.min(0, categoryWeight)), Math.max(0, ...negativeCategories));
  const ideaTokens = [...new Set(tokenize([idea.title, idea.angle, idea.why_publish].join(" ")))];
  const positiveKeywords = [...signals.keywordWeights.values()].filter((value) => value > 0);
  const negativeKeywords = [...signals.keywordWeights.values()].filter((value) => value < 0).map(Math.abs);
  const keywordMax = Math.max(0, ...positiveKeywords);
  const matchedTokens = ideaTokens
    .map((token) => ({ token, weight: signals.keywordWeights.get(token) || 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const keywordAverage = matchedTokens.length
    ? matchedTokens.slice(0, 5).reduce((sum, entry) => sum + positiveScale(entry.weight, keywordMax), 0) / Math.min(5, matchedTokens.length)
    : 0;
  const rejectedTokens = ideaTokens
    .map((token) => ({ token, weight: signals.keywordWeights.get(token) || 0 }))
    .filter((entry) => entry.weight < 0)
    .sort((a, b) => a.weight - b.weight);
  const keywordPenalty = rejectedTokens.length
    ? rejectedTokens.slice(0, 5).reduce((sum, entry) => sum + positiveScale(Math.abs(entry.weight), Math.max(0, ...negativeKeywords)), 0) / Math.min(5, rejectedTokens.length)
    : 0;
  const visualScore = normalizeScore(idea.visual_score);
  const researchScore = normalizeScore(idea.research_score);
  const noveltyScore = normalizeScore(idea.novelty_score);
  const hasHistory = signals.sampleCount > 0;
  const rawPersonalScore = categoryScore * 0.45 + keywordAverage * 0.55
    - categoryPenalty * 0.2 - keywordPenalty * 0.35;
  const personalScore = hasHistory ? Math.max(0, Math.min(100, rawPersonalScore)) : 50;
  const finalScore = personalScore * 0.55 + visualScore * 0.15 + researchScore * 0.15 + noveltyScore * 0.15;
  const matchedPreferences = [
    ...(categoryScore > 0 ? [`${cleanString(idea.category)} 카테고리 선호`] : []),
    ...matchedTokens.slice(0, 3).map((entry) => entry.token)
  ];
  return {
    ...idea,
    personal_score: Math.round(Math.max(0, Math.min(100, finalScore)) * 10) / 10,
    score_breakdown: {
      taste: Math.round(personalScore * 10) / 10,
      category: categoryScore,
      keyword: Math.round(keywordAverage * 10) / 10,
      rejectedPatternPenalty: Math.round((categoryPenalty * 0.2 + keywordPenalty * 0.35) * 10) / 10,
      visual: visualScore,
      research: researchScore,
      novelty: noveltyScore
    },
    matched_preferences: matchedPreferences
  };
}

function rankInboxIdeas(ideas, signals) {
  return ideas
    .map((idea) => scoreIdea(idea, signals))
    .sort((a, b) => b.personal_score - a.personal_score)
    .slice(0, 3)
    .map((idea, index) => ({ ...idea, rank: index + 1 }));
}

module.exports = {
  ACTION_WEIGHTS,
  eventMetadataFromItem,
  fetchBoardItem,
  loadTasteSignals,
  rankInboxIdeas,
  recordCurationAction,
  recordRecommendationEvent,
  scoreIdea,
  tokenize
};
