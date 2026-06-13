export async function readJsonResponse(response, fallback) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) {
    const error = new Error(data.userMessage || data.error || fallback || `Request failed: ${response.status}`);
    error.code = data.code || "REQUEST_FAILED";
    throw error;
  }
  return data;
}

async function appRequest(path, options = {}, fallback = "Request failed.") {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return readJsonResponse(response, fallback);
}

export function createResearch(payload) {
  return appRequest("/api/research", {
    method: "POST",
    body: JSON.stringify(payload)
  }, "Analyze API failed.");
}

export function createDeck(payload) {
  return appRequest("/api/create-deck", {
    method: "POST",
    body: JSON.stringify(payload)
  }, "Create deck API failed.");
}

export async function loadArchive() {
  const data = await appRequest("/api/curation-items", { method: "GET" }, "Board API failed.");
  return data.items || [];
}

export async function insertArchiveItem(brief) {
  const data = await appRequest("/api/curation-items/daily-find", {
    method: "POST",
    body: JSON.stringify({ brief })
  }, "Board save failed.");
  return data.item;
}

export async function fetchArchiveItem(id) {
  const data = await appRequest(`/api/curation-items/${encodeURIComponent(id)}`, { method: "GET" }, "Board item API failed.");
  return data.item;
}

export function deleteArchiveItem(id) {
  return appRequest(`/api/curation-items/${encodeURIComponent(id)}`, { method: "DELETE" }, "Board delete failed.");
}

export async function insertKevinFind(payload) {
  const data = await appRequest("/api/kevin-finds", {
    method: "POST",
    body: JSON.stringify(payload)
  }, "Kevin Found save failed.");
  return data.item;
}

export function insertPostDraft(payload) {
  return appRequest("/api/post-drafts", {
    method: "POST",
    body: JSON.stringify(payload)
  }, "Post draft save failed.");
}

export function importRssFeed(payload) {
  return appRequest("/api/sources/rss-import", {
    method: "POST",
    body: JSON.stringify(payload)
  }, "RSS import failed.");
}

export async function loadToday() {
  return appRequest("/api/recommendations/today", { method: "GET" }, "Today recommendations API failed.");
}

export function updateCurationDecision(id, decision) {
  return appRequest(`/api/curation-items/${encodeURIComponent(id)}/decision`, {
    method: "PATCH",
    body: JSON.stringify({ decision })
  }, "Curation decision update failed.");
}

export function updateBulkCurationDecision(ids, decision) {
  return appRequest("/api/curation-items/bulk-decision", {
    method: "PATCH",
    body: JSON.stringify({ ids, decision })
  }, "Bulk curation decision update failed.");
}

export async function loadSources() {
  return appRequest("/api/sources", { method: "GET" }, "Sources API failed.");
}

export function createSource(payload) {
  return appRequest("/api/sources", {
    method: "POST",
    body: JSON.stringify(payload)
  }, "Source save failed.");
}

export function runAllSources() {
  return appRequest("/api/sources/run-all", { method: "POST", body: "{}" }, "Source collection failed.");
}

export function runSource(id, runId = "") {
  return appRequest(`/api/sources/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: JSON.stringify({ runId })
  }, "Source collection failed.");
}

export function finalizeCollectionRun(runId) {
  return appRequest(`/api/collection-runs/${encodeURIComponent(runId)}/finalize`, {
    method: "POST",
    body: "{}"
  }, "Collection run finalization failed.");
}

export function updateSource(id, payload) {
  return appRequest(`/api/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }, "Source update failed.");
}

export function deleteSource(id) {
  return appRequest(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" }, "Source delete failed.");
}

export function updateCurationStatus(id, status) {
  return appRequest(`/api/curation-items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  }, "Curation status update failed.");
}

export async function loadCollectionRuns() {
  const data = await appRequest("/api/collection-runs", { method: "GET" }, "Collection runs API failed.");
  return data.runs || [];
}

export async function loadPostDrafts() {
  const data = await appRequest("/api/post-drafts", { method: "GET" }, "Post drafts API failed.");
  return data.drafts || [];
}

export async function fetchPostDraft(id) {
  const data = await appRequest(`/api/post-drafts/${encodeURIComponent(id)}`, { method: "GET" }, "Post draft API failed.");
  return data.draft;
}

export function updatePostDraft(id, payload) {
  return appRequest(`/api/post-drafts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }, "Post draft update failed.");
}

export function deletePostDraft(id) {
  return appRequest(`/api/post-drafts/${encodeURIComponent(id)}`, { method: "DELETE" }, "Post draft delete failed.");
}

export async function loadKevinFinds(search = "", category = "All") {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (category && category !== "All") params.set("category", category);
  const data = await appRequest(`/api/kevin-finds?${params.toString()}`, { method: "GET" }, "Kevin Archive API failed.");
  return data.finds || [];
}

export function updateKevinFind(id, payload) {
  return appRequest(`/api/kevin-finds/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }, "Kevin Find update failed.");
}

export function deleteKevinFind(id) {
  return appRequest(`/api/kevin-finds/${encodeURIComponent(id)}`, { method: "DELETE" }, "Kevin Find delete failed.");
}
