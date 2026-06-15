const { supabaseUrl, supabaseServiceRoleKey, openaiModel, AppError } = require("./config");
const { fetchWithTimeout, parseJsonResponse } = require("./network");
const { cleanString, slugFromUrl, decodeXml, normalizeExternalUrl, normalizeScore } = require("./validate");

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
    const migrationMissing = [400, 404].includes(response.status)
      && ["human_decision", "human_saved", "last_recommended_at", "recommendation_count", "image_url", "kevin_inbox_items", "kevin_inbox_ideas", "why_i_like_this", "kevin_angle", "personal_relevance_score", "why_note_updated_at", "recommendation_events", "personal_score", "score_breakdown", "matched_preferences", "media_type"].some((name) => text.includes(name));
    if (migrationMissing) {
      throw new AppError("A required Supabase migration has not been applied.", 503, "MIGRATION_REQUIRED", text.slice(0, 500));
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
  const sourceUrl = /^https?:\/\//i.test(source.url || "") ? source.url : "";
  const normalizedImageUrl = normalizeExternalUrl(source.image_url || "", sourceUrl);
  const imageUrl = /^https?:\/\//i.test(normalizedImageUrl) ? normalizedImageUrl : "";
  const displayTitle = decodeXml(source.title || source.name || analysis?.generated_title || "Untitled Find");
  const whyILikeThis = cleanString(row.why_i_like_this);
  const inferredPersonalRelevance = whyILikeThis ? (whyILikeThis.length >= 50 ? 90 : 80) : 0;
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
    whyILikeThis,
    kevinAngle: cleanString(row.kevin_angle),
    personalRelevanceScore: Number.isFinite(Number(row.personal_relevance_score))
      ? Number(row.personal_relevance_score)
      : inferredPersonalRelevance,
    whyNoteUpdatedAt: row.why_note_updated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentItemId: row.content_item_id,
    kevinFindId: row.kevin_find_id,
    aiAnalysisId: row.ai_analysis_id,
    name: displayTitle,
    title: displayTitle,
    sourceUrl,
    referenceUrls: Array.isArray(source.reference_urls)
      ? source.reference_urls.filter((url) => /^https?:\/\//i.test(url || ""))
      : [],
    sourceName: decodeXml(source.publisher || source.location || (source.url ? slugFromUrl(source.url) : row.item_type)),
    sourceKind: row.item_type === "kevin_found" ? "Kevin" : cleanString(source.source_type, "Magazine"),
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
    imageUrl,
    imageCredit: source.image_credit || "",
    imageUsageStatus: source.image_usage_status || "unknown",
    createdAtLabel: row.created_at ? new Date(row.created_at).toLocaleString("ko-KR") : ""
  };
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

module.exports = {
  requireSupabase,
  supabaseRequest,
  toDbAnalysis,
  normalizeBoardRow,
  decisionPatch,
  normalizeAnalysisForDb
};
