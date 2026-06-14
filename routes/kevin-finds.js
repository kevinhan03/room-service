const { AppError } = require("../lib/config");
const { sendJson, sendError, readBody } = require("../lib/http");
const { cleanString } = require("../lib/validate");
const { supabaseRequest, normalizeBoardRow } = require("../lib/supabase-client");

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
  handleSaveKevinFind,
  handleListKevinFinds,
  handleUpdateKevinFind,
  handleDeleteKevinFind
};
