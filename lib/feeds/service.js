const { URL } = require("node:url");
const { AppError, autoCollectLimit, autoCollectTimezone } = require("../config");
const { fetchWithTimeout, parseJsonResponse } = require("../network");
const { cleanString, decodeXml, normalizeExternalUrl, stripHtml, firstTag, firstAttr, absolutizeUrl } = require("../validate");
const { supabaseRequest, normalizeBoardRow, normalizeAnalysisForDb } = require("../supabase-client");
const { callOpenAIRssAnalysis } = require("../ai/analysis");
const { getLatestTasteProfile } = require("../ai/taste");
const { log } = require("../http");

function parseFeedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

async function saveSource({ name, url, category, sourceType = "Magazine", isActive = true }) {
  const definition = await resolveSourceDefinition(url);
  await validateSourceCompatibility(definition);
  const existing = await findSourceByUrl(definition.url);
  if (existing) {
    const rows = await supabaseRequest(`sources?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name, category, source_type: sourceType, is_active: isActive })
    });
    return rows?.[0] || existing;
  }
  const rows = await supabaseRequest("sources", {
    method: "POST",
    body: JSON.stringify({ type: definition.type, source_type: sourceType, name, url: definition.url, category, is_active: isActive })
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
  const tasteProfile = await getLatestTasteProfile();
  const dislikeProfile = tasteProfile?.profile_text || "";

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
            source_type: cleanString(source.source_type, "Magazine"),
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

      const analysis = normalizeAnalysisForDb(await callOpenAIRssAnalysis({
        name: source.name,
        url: source.url,
        sourceType: cleanString(source.source_type, "Magazine")
      }, item, source.category, dislikeProfile), source.category);
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

module.exports = {
  parseFeedDate,
  absolutizeUrl,
  parseFeedItems,
  fetchRssItems,
  isEyesMagUrl,
  fetchEyesMagItems,
  metaContent,
  fetchArticleMetadata,
  fetchWebItems,
  fetchSourceItems,
  resolveSourceDefinition,
  findSourceByUrl,
  validateSourceCompatibility,
  saveSource,
  getExistingContent,
  getExistingCuration,
  collectSource,
  listActiveSources,
  beginCollectionRun,
  recordSourceCollection,
  finalizeCollectionRun,
  getZonedParts
};
