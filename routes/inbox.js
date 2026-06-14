const { AppError, categories, perplexityDeepResearchModel } = require("../lib/config");
const { sendJson, sendError, readBody } = require("../lib/http");
const { cleanString, assertMaxLength, validateReferenceUrls, validateResearchGenerated } = require("../lib/validate");
const { supabaseRequest } = require("../lib/supabase-client");
const { callPerplexity, callOpenAIInboxIdeas, callOpenAI, researchResponse } = require("../lib/ai");

async function handleListInbox(req, res) {
  try {
    const rows = await supabaseRequest("kevin_inbox_items?select=*,kevin_inbox_ideas(*)&order=updated_at.desc&limit=50", { method: "GET", headers: { Prefer: "" } });
    const items = (rows || []).map((item) => ({
      ...item,
      kevin_inbox_ideas: [...(item.kevin_inbox_ideas || [])].sort((a, b) => Number(a.rank) - Number(b.rank))
    }));
    sendJson(res, 200, { items });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleCreateInbox(req, res) {
  try {
    const body = await readBody(req);
    const seedText = cleanString(body.seedText);
    const referenceUrls = validateReferenceUrls(body.referenceUrls);
    if (!seedText && !referenceUrls.length) {
      throw new AppError("Inbox clue or URL is required.", 400, "INVALID_INPUT");
    }
    assertMaxLength(seedText, 6000, "seedText");
    const rows = await supabaseRequest("kevin_inbox_items", {
      method: "POST",
      body: JSON.stringify({
        seed_text: seedText || referenceUrls[0],
        reference_urls: referenceUrls
      })
    });
    sendJson(res, 200, { item: rows?.[0] || null });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleGenerateInboxIdeas(req, res, id) {
  try {
    const rows = await supabaseRequest(`kevin_inbox_items?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    const item = rows?.[0];
    if (!item) throw new AppError("Inbox item not found.", 404, "INVALID_INPUT");
    const input = {
      name: cleanString(item.seed_text, "Kevin Inbox").slice(0, 120),
      sourceUrl: item.reference_urls?.[0] || "",
      referenceUrls: validateReferenceUrls(item.reference_urls || []),
      category: "Space",
      notes: cleanString(item.seed_text),
      imageCredit: "",
      imageUsageStatus: "unknown"
    };
    const research = await callPerplexity(input);
    const ideas = await callOpenAIInboxIdeas(item, research);
    await supabaseRequest(`kevin_inbox_ideas?inbox_item_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "" } });
    const ideaRows = await supabaseRequest("kevin_inbox_ideas", {
      method: "POST",
      body: JSON.stringify(ideas.map((idea) => ({ ...idea, inbox_item_id: id })))
    });
    await supabaseRequest(`kevin_inbox_items?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "ideas_ready", updated_at: new Date().toISOString() })
    });
    sendJson(res, 200, { ideas: ideaRows || [] });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleUpdateInboxIdea(req, res, id) {
  try {
    const body = await readBody(req);
    const status = cleanString(body.status);
    if (!["suggested", "selected", "held", "researched"].includes(status)) {
      throw new AppError("Invalid idea status.", 400, "INVALID_INPUT");
    }
    const curationItemId = cleanString(body.curationItemId);
    const rows = await supabaseRequest(`kevin_inbox_ideas?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        curation_item_id: curationItemId || null,
        updated_at: new Date().toISOString()
      })
    });
    const idea = rows?.[0];
    if (idea?.inbox_item_id && status === "selected") {
      await supabaseRequest(`kevin_inbox_ideas?inbox_item_id=eq.${encodeURIComponent(idea.inbox_item_id)}&id=neq.${encodeURIComponent(id)}&status=eq.selected`, {
        method: "PATCH",
        body: JSON.stringify({ status: "suggested", updated_at: new Date().toISOString() })
      });
      await supabaseRequest(`kevin_inbox_items?id=eq.${encodeURIComponent(idea.inbox_item_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "selected", updated_at: new Date().toISOString() })
      });
    }
    sendJson(res, 200, { idea });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleResearchInboxIdea(req, res, id) {
  try {
    const rows = await supabaseRequest(`kevin_inbox_ideas?select=*,kevin_inbox_items(*)&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    const idea = rows?.[0];
    if (!idea) throw new AppError("Inbox idea not found.", 404, "INVALID_INPUT");
    const item = idea.kevin_inbox_items || {};
    const input = {
      name: cleanString(idea.title, "Untitled Find"),
      sourceUrl: item.reference_urls?.[0] || "",
      referenceUrls: validateReferenceUrls(item.reference_urls || []),
      category: categories.has(idea.category) ? idea.category : "Space",
      notes: [item.seed_text, idea.angle, idea.research_query].map(cleanString).filter(Boolean).join("\n"),
      imageCredit: "",
      imageUsageStatus: "unknown"
    };
    const research = await callPerplexity(input, perplexityDeepResearchModel);
    const generated = validateResearchGenerated(await callOpenAI(input, research));
    const result = researchResponse(input, research, generated);
    await supabaseRequest(`kevin_inbox_ideas?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "researched", research_brief: result, updated_at: new Date().toISOString() })
    });
    await supabaseRequest(`kevin_inbox_items?id=eq.${encodeURIComponent(idea.inbox_item_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "researched", updated_at: new Date().toISOString() })
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = {
  handleListInbox,
  handleCreateInbox,
  handleGenerateInboxIdeas,
  handleUpdateInboxIdea,
  handleResearchInboxIdea
};
