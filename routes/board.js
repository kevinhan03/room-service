const { AppError } = require("../lib/config");
const { sendJson, sendError, readBody, log } = require("../lib/http");
const { cleanString, assertMaxLength, validateReferenceUrls } = require("../lib/validate");
const { supabaseRequest, normalizeBoardRow, decisionPatch, toDbAnalysis } = require("../lib/supabase-client");
const { getZonedParts } = require("../lib/feeds/runs");
const { maybeUpdateTasteProfile } = require("../lib/ai/taste");
const { runDeepResearchForCuration } = require("../lib/ai/research");
const { recordCurationAction } = require("../lib/personalization");

async function handleListBoard(req, res) {
  try {
    const rows = await supabaseRequest("curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&order=updated_at.desc&limit=80", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { items: (rows || []).map(normalizeBoardRow) });
  } catch (error) {
    sendError(res, error);
  }
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
    await recordCurationAction(
      decision === "saved_candidate" ? "save_candidate" : decision,
      id
    );
    if (decision === "rejected") await maybeUpdateTasteProfile();
    let deepResearch = null;
    let deepResearchWarning = "";
    if (decision === "dig_more" || decision === "post_today") {
      try {
        deepResearch = await runDeepResearchForCuration(id);
      } catch (error) {
        deepResearchWarning = error.message;
        log("error", "deep research after decision failed", { id, decision, details: error.message });
      }
    }
    sendJson(res, 200, { item: rows[0], decision, deepResearch, deepResearchWarning });
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
    await Promise.all(ids.map((id) => recordCurationAction(
      decision === "saved_candidate" ? "save_candidate" : decision,
      id
    )));
    if (decision === "rejected") await maybeUpdateTasteProfile();
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
    if (status === "Rejected") {
      await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
      sendJson(res, 200, { ok: true, deleted: true });
      return;
    }
    const rows = await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    if (rows?.[0] && ["Approved", "Hold"].includes(status)) {
      await recordCurationAction(status === "Approved" ? "board_approved" : "board_held", id);
    }
    sendJson(res, 200, { item: rows?.[0] || null });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdateWhyNote(req, res, id) {
  try {
    const body = await readBody(req);
    const whyILikeThis = cleanString(body.whyILikeThis);
    const kevinAngle = cleanString(body.kevinAngle);
    assertMaxLength(whyILikeThis, 4000, "whyILikeThis");
    assertMaxLength(kevinAngle, 1000, "kevinAngle");
    const personalRelevanceScore = whyILikeThis ? (whyILikeThis.length >= 50 ? 90 : 80) : 0;
    const now = new Date().toISOString();
    const patch = {
      why_i_like_this: whyILikeThis || null,
      personal_relevance_score: personalRelevanceScore,
      why_note_updated_at: now,
      updated_at: now
    };
    if (kevinAngle) patch.kevin_angle = kevinAngle;
    const rows = await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    if (!rows?.[0]) throw new AppError("Board item not found.", 404, "INVALID_INPUT", id);
    await supabaseRequest(`recommendation_events?curation_item_id=eq.${encodeURIComponent(id)}&action=eq.why_note`, { method: "DELETE", headers: { Prefer: "" } });
    if (whyILikeThis) await recordCurationAction("why_note", id, { whyILikeThis });
    const recommendationDate = getZonedParts().date;
    await supabaseRequest(`recommendation_snapshots?recommendation_date=eq.${recommendationDate}`, {
      method: "DELETE",
      headers: { Prefer: "" }
    });
    sendJson(res, 200, { item: normalizeBoardRow(rows[0]) });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleSaveDailyFind(req, res) {
  try {
    const body = await readBody(req);
    const brief = body.brief && typeof body.brief === "object" ? body.brief : body;
    const title = cleanString(brief.name || brief.generatedTitle, "Untitled Find");
    const referenceUrls = validateReferenceUrls(brief.referenceUrls, brief.sourceUrl);
    const sourceUrl = cleanString(brief.sourceUrl || referenceUrls[0], `manual://daily-find/${Date.now()}`);
    const imageUrl = /^https?:\/\//i.test(brief.imageUrl || "") ? cleanString(brief.imageUrl) : "";
    const imageSourceUrl = /^https?:\/\//i.test(brief.imageSourceUrl || brief.sourceUrl || "")
      ? cleanString(brief.imageSourceUrl || brief.sourceUrl)
      : "";
    const contentRows = await supabaseRequest("content_items?on_conflict=url", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        title,
        url: sourceUrl,
        source_type: "Kevin",
        image_url: imageUrl,
        image_credit: cleanString(brief.imageCredit),
        image_source_url: imageSourceUrl,
        image_usage_status: cleanString(brief.imageUsageStatus, "unknown"),
        publisher: cleanString(brief.sourceName),
        raw_excerpt: cleanString(brief.oneLineSummary || brief.angle),
        raw_content: cleanString(brief.notes),
        reference_urls: referenceUrls,
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
    if (boardRows?.[0]?.id) await recordCurationAction("save_candidate", boardRows[0].id);
    sendJson(res, 200, { item: normalizeBoardRow({ ...boardRows[0], content_items: contentItem, ai_analyses: analysis }) });
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

module.exports = {
  handleListBoard,
  handleDecision,
  handleBulkDecision,
  handleUpdateBoardItem,
  handleUpdateWhyNote,
  handleSaveDailyFind,
  handleDeleteBoardItem,
  handleGetBoardItem
};
