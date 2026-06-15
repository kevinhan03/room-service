const { AppError, supabaseUrl, supabaseServiceRoleKey } = require("../lib/config");
const { sendJson, sendError, readBody, readLargeJsonBody } = require("../lib/http");
const { cleanString, validateCards, validateDraftCards } = require("../lib/validate");
const { supabaseRequest, requireSupabase } = require("../lib/supabase-client");
const { fetchWithTimeout } = require("../lib/network");
const { buildCanvaPptx, canvaExportFilename } = require("../lib/canva-pptx");

async function handleSavePostDraft(req, res) {
  try {
    const body = await readBody(req);
    const cards = validateCards(body.cards);
    if (cards.length !== 7) throw new AppError("Post draft must have exactly seven slides.", 400, "INVALID_INPUT");
    const draftRows = await supabaseRequest("post_drafts", {
      method: "POST",
      body: JSON.stringify({
        curation_item_id: cleanString(body.curationItemId) || null,
        title: cleanString(body.title, "Untitled Find"),
        category: cleanString(body.category),
        source_type: cleanString(body.sourceType, "daily_find"),
        status: "Draft",
        format: cleanString(body.format, "Check-in"),
        hook: cleanString(body.hook),
        image_credit: cleanString(body.imageCredit),
        image_usage_status: cleanString(body.imageUsageStatus, "unknown"),
        caption: cleanString(body.caption),
        hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
        credit_note: cleanString(body.creditNote),
        source_note: cleanString(body.sourceNote),
        editor_note: cleanString(body.editorNote)
      })
    });
    const draft = draftRows?.[0];
    if (!draft?.id) throw new AppError("post_drafts insert returned no id.", 502, "SUPABASE_API_ERROR");
    const slideRows = await supabaseRequest("post_slides", {
      method: "POST",
      body: JSON.stringify(cards.map((card, index) => ({
        post_draft_id: draft.id,
        slide_index: index + 1,
        slide_type: ["Cover", "Introduction", "Why It Matters", "Detail 1", "Detail 2", "Editor's Note", "CTA"][index],
        title: card.title,
        body: card.copy,
        image_url: card.imageUrl || null,
        text_style: card.textStyle || {},
        media_type: card.mediaType
      })))
    });
    sendJson(res, 200, { draft, slides: slideRows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleListPostDrafts(req, res) {
  try {
    const rows = await supabaseRequest("post_drafts?select=*,post_slides(*)&order=updated_at.desc&limit=50", { method: "GET", headers: { Prefer: "" } });
    sendJson(res, 200, { drafts: rows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleGetPostDraft(req, res, id) {
  try {
    const rows = await supabaseRequest(`post_drafts?select=*,post_slides(*)&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    const draft = rows?.[0];
    if (!draft) throw new AppError("Post draft not found.", 404, "INVALID_INPUT");
    await supabaseRequest(`post_drafts?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ last_opened_at: new Date().toISOString() }) });
    sendJson(res, 200, { draft });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdatePostDraft(req, res, id) {
  try {
    const body = await readBody(req);
    const cards = validateDraftCards(body.cards);
    if (cards.length !== 7) throw new AppError("Post draft must have exactly seven slides.", 400, "INVALID_INPUT");
    const allowedStatus = new Set(["Draft", "Editing", "Ready to Export", "Exported", "Published"]);
    const status = cleanString(body.status, "Editing");
    if (!allowedStatus.has(status)) throw new AppError("Draft status is not supported.", 400, "INVALID_INPUT");
    const draftRows = await supabaseRequest(`post_drafts?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: cleanString(body.title, "Untitled Find"),
        category: cleanString(body.category),
        status,
        format: cleanString(body.format, "Check-in"),
        hook: cleanString(body.hook),
        caption: cleanString(body.caption),
        editor_note: cleanString(body.editorNote),
        updated_at: new Date().toISOString()
      })
    });
    await supabaseRequest(`post_slides?post_draft_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    const slides = await supabaseRequest("post_slides", {
      method: "POST",
      body: JSON.stringify(cards.map((card, index) => ({
        post_draft_id: id,
        slide_index: index + 1,
        slide_type: ["Cover", "Introduction", "Why It Matters", "Detail 1", "Detail 2", "Editor's Note", "CTA"][index],
        title: card.title,
        body: card.copy,
        image_url: card.imageUrl || null,
        text_style: card.textStyle || {},
        media_type: card.mediaType
      })))
    });
    sendJson(res, 200, { draft: draftRows?.[0] || null, slides: slides || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUploadPostSlideImage(req, res, draftId, slideIndex) {
  try {
    requireSupabase();
    const body = await readLargeJsonBody(req);
    const dataUrl = cleanString(body.dataUrl);
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) throw new AppError("Only JPEG, PNG, and WebP images can be uploaded.", 400, "INVALID_INPUT");
    const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (!bytes.length || bytes.length > 6 * 1024 * 1024) {
      throw new AppError("Image must be smaller than 6MB.", 413, "REQUEST_TOO_LARGE");
    }
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[match[1]];
    const objectPath = `${encodeURIComponent(draftId)}/slide-${Number(slideIndex)}-${Date.now()}.${extension}`;
    const uploadImage = () => fetchWithTimeout(`${supabaseUrl}/storage/v1/object/post-images/${objectPath}`, {
      method: "POST",
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        "Content-Type": match[1]
      },
      body: bytes
    }, "Supabase Storage");
    let response = await uploadImage();
    let text = await response.text();
    if ([400, 404].includes(response.status) && /bucket not found/i.test(text)) {
      const bucketResponse = await fetchWithTimeout(`${supabaseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: {
          apikey: supabaseServiceRoleKey,
          Authorization: `Bearer ${supabaseServiceRoleKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: "post-images",
          name: "post-images",
          public: true,
          file_size_limit: 6291456,
          allowed_mime_types: ["image/jpeg", "image/png", "image/webp"]
        })
      }, "Supabase Storage bucket");
      const bucketText = await bucketResponse.text();
      if (!bucketResponse.ok && !/already exists|duplicate/i.test(bucketText)) {
        throw new AppError(`Supabase Storage bucket setup failed with status ${bucketResponse.status}.`, 502, "SUPABASE_API_ERROR", bucketText.slice(0, 500));
      }
      response = await uploadImage();
      text = await response.text();
    }
    if (!response.ok) {
      if ([400, 404].includes(response.status) && /bucket|post-images/i.test(text)) {
        throw new AppError("Post image migration has not been applied.", 503, "MIGRATION_REQUIRED", text.slice(0, 500));
      }
      throw new AppError(`Supabase Storage failed with status ${response.status}.`, 502, "SUPABASE_API_ERROR", text.slice(0, 500));
    }
    sendJson(res, 200, {
      imageUrl: `${supabaseUrl}/storage/v1/object/public/post-images/${objectPath}`
    });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleDeletePostDraft(req, res, id) {
  try {
    await supabaseRequest(`post_drafts?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleCanvaExport(req, res, id) {
  try {
    const rows = await supabaseRequest(`post_drafts?select=*,post_slides(*)&id=eq.${encodeURIComponent(id)}&limit=1`, {
      method: "GET",
      headers: { Prefer: "" }
    });
    const draft = rows?.[0];
    if (!draft) throw new AppError("Post draft not found.", 404, "INVALID_INPUT");
    const slides = draft.post_slides || [];
    if (slides.length !== 7) throw new AppError("Canva export requires exactly seven slides.", 400, "INVALID_INPUT");
    const buffer = await buildCanvaPptx({ draft, slides });
    const filename = canvaExportFilename(draft.title);
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": buffer.length,
      "Cache-Control": "no-store"
    });
    res.end(buffer);
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = {
  handleSavePostDraft,
  handleListPostDrafts,
  handleGetPostDraft,
  handleUpdatePostDraft,
  handleUploadPostSlideImage,
  handleCanvaExport,
  handleDeletePostDraft
};
