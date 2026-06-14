const { openaiModel, openaiWritingModel, perplexityModel } = require("../lib/config");
const { sendJson, sendError, readBody, log } = require("../lib/http");
const { validateResearchInput, validateResearchGenerated, validateDeckInput, validateDeckGenerated, deckNaturalnessIssues } = require("../lib/validate");
const { callPerplexity, callOpenAI, callOpenAICreateDeck, researchResponse } = require("../lib/ai");
const { supabaseRequest } = require("../lib/supabase-client");

async function handleResearch(req, res) {
  try {
    const body = await readBody(req);
    const input = validateResearchInput(body);

    log("info", "analyze request started", { route: "/api/research", name: input.name, category: input.category, referenceUrlCount: input.referenceUrls.length, perplexityModel });
    const research = await callPerplexity(input);
    const generated = validateResearchGenerated(await callOpenAI(input, research));
    sendJson(res, 200, researchResponse(input, research, generated));
    log("info", "analyze request completed", { route: "/api/research", name: input.name, cardCount: generated.cards.length });
  } catch (error) {
    sendError(res, error);
  }
}

async function handleCreateDeck(req, res) {
  try {
    const body = await readBody(req);
    const input = validateDeckInput(body);
    log("info", "deck request started", {
      route: "/api/create-deck",
      title: input.title,
      format: input.format,
      draftModel: openaiModel,
      writingModel: openaiWritingModel
    });
    const initialDraft = validateDeckGenerated(await callOpenAICreateDeck(input));
    const naturalnessIssues = deckNaturalnessIssues(initialDraft);
    log("info", "deck final copy edit started", {
      route: "/api/create-deck",
      title: input.title,
      issues: naturalnessIssues
    });
    let generated = validateDeckGenerated(await callOpenAICreateDeck(input, {
      draft: initialDraft,
      issues: naturalnessIssues.length ? naturalnessIssues : ["mandatory final human copy edit"]
    }));
    const remainingIssues = deckNaturalnessIssues(generated);
    if (remainingIssues.length) {
      log("info", "deck final repair started", {
        route: "/api/create-deck",
        title: input.title,
        issues: remainingIssues
      });
      generated = validateDeckGenerated(await callOpenAICreateDeck(input, {
        draft: generated,
        issues: remainingIssues
      }));
    }

    if (input.curationItemId && generated.kevinAngle) {
      await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(input.curationItemId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          kevin_angle: generated.kevinAngle,
          updated_at: new Date().toISOString()
        })
      });
    }

    sendJson(res, 200, {
      cards: generated.cards,
      kevinAngle: generated.kevinAngle || input.kevinAngle || "",
      caption: generated.caption || "",
      hashtags: generated.hashtags || [],
      creditNote: generated.creditNote || "",
      sourceNote: generated.sourceNote || ""
    });
    log("info", "deck request completed", {
      route: "/api/create-deck",
      title: input.title,
      cardCount: generated.cards.length,
      remainingNaturalnessIssues: deckNaturalnessIssues(generated)
    });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = { handleResearch, handleCreateDeck };
