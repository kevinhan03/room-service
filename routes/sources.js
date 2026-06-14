const { categories, sourceTypes, autoCollectLimit, AppError } = require("../lib/config");
const { sendJson, sendError, readBody } = require("../lib/http");
const { cleanString, validateUrl, slugFromUrl } = require("../lib/validate");
const { supabaseRequest } = require("../lib/supabase-client");
const { saveSource, collectSource, beginCollectionRun, recordSourceCollection, finalizeCollectionRun } = require("../lib/feeds");

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
    const sourceType = cleanString(body.sourceType, "Magazine");
    if (!categories.has(category)) throw new AppError("category is not supported.", 400, "INVALID_INPUT", category);
    if (!sourceTypes.has(sourceType) || sourceType === "Kevin") throw new AppError("sourceType is not supported for collected sources.", 400, "INVALID_INPUT", sourceType);
    const source = await saveSource({ name, url, category, sourceType, isActive: body.isActive !== false });
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
    const sourceType = cleanString(body.sourceType, "Magazine");
    const limit = Math.max(1, Math.min(Number(body.limit) || autoCollectLimit, 8));
    if (!categories.has(category)) throw new AppError("category is not supported.", 400, "INVALID_INPUT", category);
    if (!sourceTypes.has(sourceType) || sourceType === "Kevin") throw new AppError("sourceType is not supported for collected sources.", 400, "INVALID_INPUT", sourceType);
    const source = await saveSource({ name, url, category, sourceType, isActive: true });
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
    if (body.sourceType !== undefined) {
      const sourceType = cleanString(body.sourceType);
      if (!sourceTypes.has(sourceType) || sourceType === "Kevin") throw new AppError("sourceType is not supported for collected sources.", 400, "INVALID_INPUT", sourceType);
      patch.source_type = sourceType;
    }
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

async function handleCollectionRuns(req, res) {
  try {
    const rows = await supabaseRequest("collection_runs?select=*,source_collection_runs(*)&order=started_at.desc&limit=20", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { runs: rows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = {
  handleListSources,
  handleCreateSource,
  handleImportRss,
  handleRunAllSources,
  handleRunSource,
  handleFinalizeCollectionRun,
  handleUpdateSource,
  handleDeleteSource,
  handleCollectionRuns
};
