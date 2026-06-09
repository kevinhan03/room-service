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
  return appRequest("/api/today", { method: "GET" }, "Today API failed.");
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

export function runSource(id) {
  return appRequest(`/api/sources/${encodeURIComponent(id)}/run`, { method: "POST", body: "{}" }, "Source collection failed.");
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
