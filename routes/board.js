const { AppError } = require("../lib/config");
const { sendJson, sendError, readBody, log } = require("../lib/http");
const { cleanString, assertMaxLength, validateReferenceUrls } = require("../lib/validate");
const { supabaseRequest, normalizeBoardRow, decisionPatch, toDbAnalysis } = require("../lib/supabase-client");
const { getZonedParts } = require("../lib/feeds");
const { maybeUpdateTasteProfile, runDeepResearchForCuration } = require("../lib/ai");
const { calculateRecommendationScore, recommendationTier } = require("../lib/recommendations");

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

async function handleDecision(req, res, id) {
  try {
    const body = await readBody(req);
    const decision = cleanString(body.decision);
    const rows = await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(decisionPatch(decision))
    });
    if (!rows?.[0]) throw new AppError("Board item not found.", 404, "INVALID_INPUT", id);
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
    const rows = await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
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

module.exports = {
  handleListBoard,
  handleTodayRecommendations,
  handleDecision,
  handleBulkDecision,
  handleUpdateBoardItem,
  handleUpdateWhyNote,
  handleSaveDailyFind,
  handleSaveKevinFind,
  handleDeleteBoardItem,
  handleGetBoardItem,
  handleListKevinFinds,
  handleUpdateKevinFind,
  handleDeleteKevinFind
};
