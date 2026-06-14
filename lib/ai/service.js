const {
  env,
  openaiResponsesUrl,
  perplexitySonarUrl,
  openaiModel,
  openaiWritingModel,
  perplexityModel,
  perplexityDeepResearchModel,
  AppError,
  tasteAnalysisBatchSize,
  categories
} = require("../config");
const { fetchWithTimeout, parseJsonResponse, parseModelJson, getOpenAIText } = require("../network");
const { cleanString, validateReferenceUrls, validateResearchGenerated, slugFromUrl } = require("../validate");
const { supabaseRequest, normalizeBoardRow, normalizeAnalysisForDb } = require("../supabase-client");
const { log } = require("../http");

async function callOpenAIRssAnalysis(feed, item, category, dislikeProfile = "") {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }
  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You are the first-pass editor for dig.everyday.",
            "Judge RSS items as lifestyle curation candidates, not news headlines.",
            "Prefer quiet, minimal, editorial, curated, timeless finds.",
            "Reject generic viral news, listicles, hype, and clickbait.",
            "All user-facing JSON string values must be Korean, except proper nouns.",
            "Return only valid JSON. No markdown.",
            ...(dislikeProfile ? [
              "",
              "Kevin has previously rejected items matching these patterns. Score similarly matching items lower:",
              dislikeProfile
            ] : [])
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Analyze this RSS item for curation.",
            "All score fields must be integers from 0 to 100.",
            "JSON shape:",
            "{",
            '  "generated_title": "...",',
            '  "one_line_summary": "...",',
            '  "three_line_summary": "...",',
            '  "category": "Fashion|Space|Food|Travel|Hotel|Object|Perfume|Architecture|Product|Brand|Book|Magazine|Artwork|Playlist",',
            '  "recommendation_reason": "...",',
            '  "why_this_feels_good": "...",',
            '  "editorial_angle": "...",',
            '  "visual_strength": "...",',
            '  "kevin_taste_fit": "...",',
            '  "suitability_score": 0,',
            '  "taste_fit_score": 0,',
            '  "visual_score": 0,',
            '  "story_score": 0,',
            '  "suggested_status": "Candidate|Approved|Hold|Rejected|Dig More Candidate",',
            '  "risk_notes": "...",',
            '  "verification_needed": "...",',
            '  "key_points": ["..."],',
            '  "source_facts": [{"section": "Context|Visual|Taste|Practical", "fact": "...", "confidence": "high|medium|low"}]',
            "}",
            "",
            JSON.stringify({ feed, item, preferredCategory: category }, null, 2)
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }
  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

async function getRejectedCount() {
  const rows = await supabaseRequest("curation_items?select=id&human_decision=eq.rejected", { method: "GET", headers: { Prefer: "" } }) || [];
  return rows.length;
}

async function getLatestTasteProfile() {
  try {
    const rows = await supabaseRequest("taste_profiles?select=*&order=created_at.desc&limit=1", { method: "GET", headers: { Prefer: "" } });
    return rows?.[0] || null;
  } catch (error) {
    log("error", "taste profile lookup failed", { details: error.message });
    return null;
  }
}

async function getRecentRejectedItems(limit) {
  const rows = await supabaseRequest(`curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&human_decision=eq.rejected&order=updated_at.desc&limit=${encodeURIComponent(limit)}`, { method: "GET", headers: { Prefer: "" } }) || [];
  return rows.map(normalizeBoardRow);
}

async function callOpenAITasteAnalysis(previousProfile, rejectedItems) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }
  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You maintain a running 'dislike profile' for dig.everyday's curator Kevin.",
            "You are given the previous dislike profile (may be empty) and a new batch of items Kevin rejected.",
            "Rewrite the profile to capture recurring patterns in what Kevin rejects: topics, styles, sources, categories, tones, keywords.",
            "Keep prior patterns that still hold, drop ones that no longer seem supported, and add new ones from this batch.",
            "Be concise and specific so a future curation model can use this to filter out similar items.",
            "Write in Korean. Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Update the dislike profile using the newly rejected items below.",
            "JSON shape:",
            '{ "profile_text": "..." }',
            "",
            "Previous profile:",
            previousProfile || "(none yet)",
            "",
            "Newly rejected items:",
            JSON.stringify(rejectedItems.map((item) => ({
              title: item.title,
              category: item.category,
              source: item.sourceName,
              oneLineSummary: item.oneLineSummary,
              editorialAngle: item.angle,
              kevinTasteFit: item.kevinTasteFit,
              scores: {
                suitability: item.suitabilityScore,
                tasteFit: item.tasteFitScore,
                visual: item.visualScore,
                story: item.storyScore
              }
            })), null, 2)
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }
  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

async function maybeUpdateTasteProfile() {
  try {
    const [rejectedCount, latestProfile] = await Promise.all([getRejectedCount(), getLatestTasteProfile()]);
    const analyzedThrough = latestProfile?.analyzed_through_count || 0;
    const newCount = rejectedCount - analyzedThrough;
    if (newCount < tasteAnalysisBatchSize) return;
    const rejectedItems = await getRecentRejectedItems(newCount);
    const analysis = await callOpenAITasteAnalysis(latestProfile?.profile_text || "", rejectedItems);
    await supabaseRequest("taste_profiles", {
      method: "POST",
      body: JSON.stringify({
        profile_text: cleanString(analysis.profile_text),
        analyzed_through_count: rejectedCount,
        sample_count: rejectedItems.length,
        model: openaiModel
      })
    });
  } catch (error) {
    log("error", "taste profile analysis failed", { details: error.message });
  }
}

async function callPerplexity(input, model = perplexityModel) {
  if (!env.PERPLEXITY_API_KEY) {
    throw new AppError("PERPLEXITY_API_KEY is missing.", 500, "MISSING_PERPLEXITY_KEY");
  }

  const prompt = [
    `URL: ${input.sourceUrl || "none"}`,
    `Reference URLs:\n${input.referenceUrls.length ? input.referenceUrls.map((url) => `- ${url}`).join("\n") : "- none"}`,
    `Name: ${input.name || "Untitled Space"}`,
    `Category: ${input.category || "Space"}`,
    `Notes: ${input.notes || "none"}`,
    "",
    model === perplexityDeepResearchModel
      ? "Do deep editorial research for dig.everyday, a Korean Instagram curation system about lifestyle finds."
      : "Do focused editorial research for dig.everyday, a Korean Instagram curation system about lifestyle finds.",
    "The output will be used for editorial curation first, so do not stop at a short summary.",
    "",
    "Research requirements:",
    "1. Identify official website, official social accounts, press/editorial articles, map/listing pages, and credible third-party mentions when available.",
    "2. Extract origin: founder/operator, opening year, neighborhood/city, original concept, prior context.",
    "3. Extract growth: expansion, collaborations, menu/product changes, design changes, media attention, visitor behavior.",
    "4. Extract signature: spatial details, facade, material, lighting, furniture, menu/object/product, service ritual, photo-worthy element.",
    "5. Explain why it matters: cultural context, trend signal, local meaning, brand strategy, why people save/share it.",
    "6. List uncertain claims separately. Do not present uncertain information as fact.",
    "7. Include practical facts only if found: address, opening hours, reservation method, price range, official links.",
    "",
    "Output language rule:",
    "- Write the entire research report in Korean.",
    "- If sources are English, translate the meaning into Korean.",
    "- Do not leave English paragraphs in the result unless it is a proper noun, brand name, menu name, address, or cited title.",
    "",
    "Output in Korean with compact but detailed bullets.",
    "Avoid marketing language, excessive adjectives, and exclamation marks.",
    "Prefer citations and source-aware details over generic claims."
  ].join("\n");

  const response = await fetchWithTimeout(perplexitySonarUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a precise web researcher for dig.everyday, a Korean editorial Instagram curation system about lifestyle finds."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 6000
    })
  }, "Perplexity API");

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`Perplexity API failed with status ${response.status}.`, 502, "PERPLEXITY_API_ERROR", text.slice(0, 500));
  }

  const data = parseJsonResponse(text, "Perplexity API");
  return {
    content: data.choices?.[0]?.message?.content || "",
    citations: data.citations || [],
    searchResults: data.search_results || []
  };
}

async function callOpenAIInboxIdeas(item, research) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }
  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You develop editorial ideas for dig.everyday, a Korean lifestyle curation Instagram account.",
            "The goal is not to summarize news. Turn Kevin's clue into three specific subjects he could genuinely want to post.",
            "Prefer durable places, brands, objects, design decisions, rituals, or cultural shifts over launches and trend news.",
            "Each idea must be visually strong enough for a seven-slide photo carousel and have concrete facts worth researching.",
            "The three ideas must be meaningfully different, not alternate headlines for the same subject.",
            "Write natural Korean except for proper nouns. Avoid marketing language and abstract editorial jargon.",
            "Return only valid JSON."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Create exactly three post ideas from the saved clue and web research.",
            "JSON shape:",
            '{"ideas":[{"title":"specific subject","category":"Fashion|Space|Food|Travel|Hotel|Object|Perfume|Architecture|Product|Brand|Book|Magazine|Artwork|Playlist","angle":"what the post would specifically explain","why_publish":"why Kevin may genuinely want to make this post","research_query":"focused follow-up research instruction"}]}',
            "",
            JSON.stringify({
              clue: item.seed_text,
              referenceUrls: item.reference_urls || [],
              webResearch: research.content,
              citations: research.citations,
              searchResults: research.searchResults
            }, null, 2)
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }
  const data = parseModelJson(getOpenAIText(parseJsonResponse(text, "OpenAI API")), "OpenAI");
  const ideas = Array.isArray(data.ideas) ? data.ideas.slice(0, 3) : [];
  if (ideas.length !== 3) {
    throw new AppError("Model returned fewer than three ideas.", 502, "MODEL_OUTPUT_INVALID");
  }
  return ideas.map((idea, index) => ({
    rank: index + 1,
    title: cleanString(idea.title, `Idea ${index + 1}`),
    category: categories.has(idea.category) ? idea.category : "Space",
    angle: cleanString(idea.angle),
    why_publish: cleanString(idea.why_publish),
    research_query: cleanString(idea.research_query)
  }));
}

function researchNotesText(value, fallback = "") {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean).join("\n");
  return cleanString(value, fallback);
}

function researchUrls(research) {
  const citationUrls = (Array.isArray(research.citations) ? research.citations : [])
    .map((item) => typeof item === "string" ? item : item?.url);
  const searchUrls = (Array.isArray(research.searchResults) ? research.searchResults : [])
    .map((item) => item?.url);
  return [...citationUrls, ...searchUrls]
    .map(cleanString)
    .filter((url) => /^https?:\/\//i.test(url));
}

async function runDeepResearchForCuration(id) {
  const rows = await supabaseRequest(`curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  const row = rows?.[0];
  if (!row) throw new AppError("Board item not found.", 404, "INVALID_INPUT", id);

  const content = row.content_items || null;
  const kevinFind = row.kevin_finds || null;
  const previousAnalysis = row.ai_analyses || null;
  const sourceUrl = content?.url?.startsWith("http") ? content.url : "";
  const input = {
    name: cleanString(content?.title || kevinFind?.name || previousAnalysis?.generated_title, "Untitled Find"),
    sourceUrl,
    referenceUrls: validateReferenceUrls(content?.reference_urls || [], sourceUrl),
    category: cleanString(previousAnalysis?.category || kevinFind?.category, "Space"),
    notes: cleanString(content?.raw_content || kevinFind?.notes || kevinFind?.why_saved),
    imageCredit: cleanString(content?.image_credit || kevinFind?.image_credit),
    imageUsageStatus: cleanString(content?.image_usage_status || kevinFind?.image_usage_status, "unknown")
  };
  const research = await callPerplexity(input, perplexityDeepResearchModel);
  const generated = validateResearchGenerated(await callOpenAI(input, research));
  const analysisData = normalizeAnalysisForDb(generated.analysis, input.category);
  let analysis = previousAnalysis;

  if (previousAnalysis?.id) {
    const analysisRows = await supabaseRequest(`ai_analyses?id=eq.${encodeURIComponent(previousAnalysis.id)}`, {
      method: "PATCH",
      body: JSON.stringify(analysisData)
    });
    analysis = analysisRows?.[0] || previousAnalysis;
  } else {
    const analysisRows = await supabaseRequest("ai_analyses", {
      method: "POST",
      body: JSON.stringify({
        item_type: row.item_type,
        content_item_id: content?.id || null,
        kevin_find_id: kevinFind?.id || null,
        ...analysisData
      })
    });
    analysis = analysisRows?.[0] || null;
  }

  if (content?.id) {
    const mergedCandidates = [...new Set([
      sourceUrl,
      ...(content.reference_urls || []),
      ...researchUrls(research)
    ].filter(Boolean))].slice(0, 10);
    const mergedUrls = validateReferenceUrls(mergedCandidates);
    await supabaseRequest(`content_items?id=eq.${encodeURIComponent(content.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        raw_excerpt: cleanString(generated.analysis?.one_line_summary || content.raw_excerpt),
        raw_content: researchNotesText(generated.brief?.notes, research.content || content.raw_content),
        reference_urls: mergedUrls
      })
    });
  }

  await supabaseRequest(`curation_items?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ai_analysis_id: analysis?.id || row.ai_analysis_id,
      editor_note: cleanString(generated.analysis?.editorial_angle || generated.brief?.angle || row.editor_note),
      updated_at: new Date().toISOString()
    })
  });
  return {
    model: perplexityDeepResearchModel,
    citations: research.citations || [],
    sources: generated.sourceSummary || research.searchResults || []
  };
}

function researchResponse(input, research, generated) {
  const now = new Date();
  const primarySourceUrl = input.sourceUrl || input.referenceUrls[0] || "";
  return {
    brief: {
      id: Date.now(),
      name: input.name,
      sourceUrl: primarySourceUrl,
      referenceUrls: [...new Set([...input.referenceUrls, ...researchUrls(research)])].slice(0, 10),
      category: input.category,
      sourceName: primarySourceUrl ? slugFromUrl(primarySourceUrl) : "manual note",
      notes: generated.brief?.notes || research.content,
      angle: generated.brief?.angle || generated.analysis?.editorial_angle || "",
      generatedTitle: generated.analysis?.generated_title || "",
      oneLineSummary: generated.analysis?.one_line_summary || "",
      threeLineSummary: generated.analysis?.three_line_summary || "",
      recommendationReason: generated.analysis?.recommendation_reason || "",
      whyThisFeelsGood: generated.analysis?.why_this_feels_good || "",
      editorialAngle: generated.analysis?.editorial_angle || "",
      visualStrength: generated.analysis?.visual_strength || "",
      kevinTasteFit: generated.analysis?.kevin_taste_fit || "",
      suitabilityScore: generated.analysis?.suitability_score ?? null,
      tasteFitScore: generated.analysis?.taste_fit_score ?? null,
      visualScore: generated.analysis?.visual_score ?? null,
      storyScore: generated.analysis?.story_score ?? null,
      suggestedStatus: generated.analysis?.suggested_status || "Candidate",
      riskNotes: generated.analysis?.risk_notes || "",
      verificationNeeded: generated.analysis?.verification_needed || generated.brief?.verification || "위치, 운영 시간, 예약 방식, 가격, 공식 표기 확인 필요",
      verification: generated.brief?.verification || generated.analysis?.verification_needed || "위치, 운영 시간, 예약 방식, 가격, 공식 표기 확인 필요",
      imageCredit: input.imageCredit,
      imageUsageStatus: input.imageUsageStatus,
      createdAt: now.toLocaleString("ko-KR")
    },
    cards: Array.isArray(generated.cards) ? generated.cards : [],
    caption: generated.caption || "",
    sources: generated.sourceSummary || research.searchResults || [],
    researchFacts: generated.researchFacts || [],
    citations: research.citations || []
  };
}

async function callOpenAI(input, research) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }

  const sourceText = JSON.stringify({
    input,
    perplexityResearch: research.content,
    citations: research.citations,
    searchResults: research.searchResults
  }, null, 2);

  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You write for dig.everyday, a Korean editorial Instagram curation system.",
            "All user-facing JSON string values must be written in Korean.",
            "Translate English research material into natural Korean before writing.",
            "Keep proper nouns, brand names, place names, menu names, and URLs in their original form when needed.",
            "Tone: short, dry, dense with information.",
            "Analyze first. Separate summary, classification, and taste evaluation from post copy.",
            "Do not generate carousel slides in Analyze. Only generate analysis fields for curation.",
            "Forbidden: marketing copy, excessive adjectives, exclamation marks.",
            "Do not invent facts. Separate facts, interpretation, and verification needs.",
            "The brief must contain enough material for a later seven-slide post.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Create a production-ready Analyze result from this research.",
            "JSON shape:",
            "{",
            '  "brief": {"angle": "...", "notes": "8-12 dense Korean bullets grouped by Origin/Growth/Signature/Context", "verification": "specific unchecked claims and what source should confirm them"},',
            '  "analysis": {"generated_title": "...", "one_line_summary": "...", "three_line_summary": "...", "category": "Fashion|Space|Food|Travel|Hotel|Object|Perfume|Architecture|Product|Brand|Book|Magazine|Artwork|Playlist", "recommendation_reason": "...", "why_this_feels_good": "...", "editorial_angle": "...", "visual_strength": "...", "kevin_taste_fit": "...", "suitability_score": 0, "taste_fit_score": 0, "visual_score": 0, "story_score": 0, "suggested_status": "Candidate|Approved|Hold|Rejected|Dig More Candidate", "risk_notes": "...", "verification_needed": "..."},',
            '  "researchFacts": [{"section": "Origin|Context|Visual|Taste|Practical", "fact": "...", "sourceHint": "...", "confidence": "high|medium|low"}],',
            '  "sourceSummary": [{"title": "...", "url": "..."}]',
            "}",
            "",
            "Taste filter rules:",
            "- This is not a trend detector. Judge whether the find feels quiet, minimal, editorial, curated, and timeless.",
            "- why_this_feels_good must explain mood, material, context, restraint, or rhythm.",
            "- visual_strength must judge whether images can carry an Instagram carousel.",
            "- kevin_taste_fit must be honest. Reject generic viral content.",
            "- Avoid words like must-visit, hidden gem, perfect, special, amazing.",
            "",
            sourceText
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }

  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

async function callOpenAICreateDeck(input, revision = null) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError("OPENAI_API_KEY is missing.", 500, "MISSING_OPENAI_KEY");
  }

  const assignment = revision
    ? [
        "Rewrite the draft below because it failed the natural Korean editorial voice check.",
        `Detected expressions: ${revision.issues.join(", ")}`,
        "This is the mandatory final human copy-edit pass. Do not preserve wording just because it passed the first draft.",
        "Preserve only facts supported by the original input and the exact seven-slide structure.",
        "Delete any detail that cannot be traced directly to the original input, even if it sounds plausible.",
        "Do not merely swap synonyms. Replace abstractions with concrete scenes, actions, materials, prices, locations, history, or useful observations.",
        "Read every sentence aloud in your head. Rewrite anything that sounds like a brochure, press release, translated English, AI summary, or generic travel account.",
        "Remove evaluative filler. If a sentence only says something is good, interesting, comfortable, different, or memorable, replace it with the observable reason or delete it.",
        "",
        "Draft to rewrite:",
        JSON.stringify(revision.draft, null, 2)
      ]
    : [
        "Create an exact seven-slide Instagram carousel draft and caption.",
        "Use this fixed slide structure in order: Cover, Introduction, Why It Matters, Detail 1, Detail 2, Editor's Note, CTA."
      ];

  const response = await fetchWithTimeout(openaiResponsesUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: revision ? openaiWritingModel : openaiModel,
      input: [
        {
          role: "developer",
          content: [
            "You write for dig.everyday, a Korean editorial Instagram curation system.",
            "All user-facing text must be Korean, except proper nouns.",
            "Write like a Korean human editor who actually visited, used, or carefully researched the subject.",
            "Tone: conversational but restrained, specific, and easy to read aloud.",
            "Prefer ordinary Korean verbs and concrete nouns over editorial abstractions.",
            "Each sentence should contain a fact, scene, useful detail, or clear personal observation.",
            "Vary sentence length. Natural short fragments are allowed, but do not make every line a slogan.",
            "Research notes are evidence, not a writing style. Never copy their abstract wording.",
            "The editorial priority is strict: (1) whyILikeThis, (2) kevinAngle, (3) angle and analysis, (4) factual notes.",
            "whyILikeThis is Kevin's own editorial judgment. Preserve its plain vocabulary and use it to decide what the post is really about.",
            "When whyILikeThis is present, Why It Matters and Editor's Note must clearly express that thought without turning it into an unsupported fact.",
            "Generate kevin_angle as one restrained Korean sentence that clarifies Kevin's point of view. Do not use editorial jargon.",
            "Avoid stacked nouns and translated English phrasing.",
            "Do not use metaphors, personification, poetic travel writing, or scene-setting details that are not in the input.",
            "Do not explain that something provides an experience. Describe what a person actually sees, does, hears, orders, or remembers.",
            "Do not call something meaningful, attractive, sensory, special, or noteworthy without immediately saying why.",
            "Never use these expressions or close variations: 체류형, 경험형, 라이프스타일 공간, 공간 경험, 브랜드 태도, 조명한다, 선사한다, 어우러진다, 돋보인다, 주목한다, 단순한 것을 넘어, 새로운 기준, 특별한 경험, 감각적인, 매력적, 좋은 곳, 전혀 다른 모습, 지루할 틈이 없다, 한층 더, 기분 전환, ~하기 좋다.",
            "Avoid generic openings such as '~을 소개합니다', '~에 주목했습니다', and generic conclusions such as '~해볼 만합니다'.",
            "Do not use rhetorical contrast templates like 'A가 아니라 B' unless the contrast is a verifiable fact.",
            "Forbidden: marketing copy, excessive adjectives, exclamation marks.",
            "Do not add unsupported praise or adjectives such as 인기 있는, 깨끗한, 넓은, 편리한, 유명한, 따뜻한 unless that exact fact appears in the input.",
            "Do not introduce a concrete noun, facility, seat type, sound, view, schedule, price rule, or action unless it is explicitly present in the input. Plausible is not the same as verified.",
            "Forbidden examples unless explicitly supplied: 파도 소리, 라이브 공연, 무대, 카바나, 선베드, 선탠, 자리별 전망, 바닷바람, 음악이 커진다.",
            "Use the word '분위기' no more than once in the entire output. Name the light, sound, material, crowd, view, or action instead.",
            "Bad: '낮과 밤이 다른 체류형 공간으로 특별한 경험을 선사한다.'",
            "Good: '낮에는 수영장과 해변을 오간다. 해가 지면 DJ가 음악을 튼다.'",
            "Bad: '라탄과 목재가 어우러져 따뜻한 분위기를 만든다.'",
            "Good: '천장에는 라탄 조명이 달렸고, 바와 테이블에는 재활용 목재를 썼다.'",
            "Bad: '밤이 되면 바다가 다른 얼굴을 보여준다.'",
            "Good: '해가 지면 DJ 음악과 공연이 시작된다.'",
            "Do not invent first-person visits or feelings. Use first person only when the supplied notes explicitly contain Kevin's own observation.",
            "Cover: write only one compact hook that fits in one or two short lines over a full-bleed photo.",
            "The subject name and category are rendered separately above the Cover hook. Do not repeat the name or category in the Cover copy unless the sentence becomes unclear without the proper noun.",
            "Introduction: identify the subject plainly and include location or context when known.",
            "Why It Matters: explain one concrete reason without saying '왜 중요한가'.",
            "Detail 1 (slide 4): write the most vivid observable scene supported by the notes. Include what is physically there and what changes while someone is there.",
            "Detail 2 (slide 5): give useful specifics a friend would mention after visiting, such as layout, material, menu, reservation, price, timing, route, or one easily missed detail.",
            "Editor's Note (slide 6): write a warm, specific reason Kevin would save or recommend this find. It should sound like a real message to a friend, not an evaluation report.",
            "Slides 4-6 must each add different information. Never repeat the Introduction or the angle.",
            "Slides 2-6 are placed as small body text at the bottom of a full-bleed photo. Their structural titles are not displayed, so each copy must make sense without a visible subtitle. Keep each copy to 2-3 compact sentences.",
            "Create a sense of firsthand attention, not a false firsthand claim. Never say '가봤다', '직접 보니', '먹어보니', or invent feelings unless the input explicitly says Kevin visited or used it.",
            "When direct personal notes are present, preserve their plain vocabulary and small details instead of replacing them with editorial language.",
            "CTA: write one short, answerable, topic-specific question that can sit alone in the exact center of a full-bleed photo. Never write '저장해두세요' or '여러분은 어떻게 생각하시나요?'.",
            "Caption: 3-5 short paragraphs that add context instead of repeating all seven cards.",
            "Before returning JSON, silently audit every sentence: (1) supported by input, (2) concrete, (3) natural when read aloud, (4) not repeated elsewhere. Rewrite or delete any sentence that fails.",
            "Do not create a Source Note card.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            ...assignment,
            "JSON shape:",
            "{",
            '  "kevin_angle": "one restrained Korean sentence distilled from whyILikeThis",',
            "  \"cards\": [{\"title\": \"Cover\", \"copy\": \"1-3 short Korean lines\"}, {\"title\": \"Introduction\", \"copy\": \"...\"}, {\"title\": \"Why It Matters\", \"copy\": \"...\"}, {\"title\": \"Detail 1\", \"copy\": \"...\"}, {\"title\": \"Detail 2\", \"copy\": \"...\"}, {\"title\": \"Editor's Note\", \"copy\": \"...\"}, {\"title\": \"CTA\", \"copy\": \"...\"}],",
            '  "caption": "short Korean caption",',
            '  "hashtags": ["#..."],',
            '  "credit_note": "image/source credit note",',
            '  "source_note": "source verification note"',
            "}",
            "",
            JSON.stringify(input, null, 2)
          ].join("\n")
        }
      ]
    })
  }, "OpenAI API");

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenAI API failed with status ${response.status}.`, 502, "OPENAI_API_ERROR", text.slice(0, 500));
  }

  const data = parseJsonResponse(text, "OpenAI API");
  return parseModelJson(getOpenAIText(data), "OpenAI");
}

module.exports = {
  callOpenAIRssAnalysis,
  getRejectedCount,
  getLatestTasteProfile,
  getRecentRejectedItems,
  callOpenAITasteAnalysis,
  maybeUpdateTasteProfile,
  callPerplexity,
  callOpenAIInboxIdeas,
  researchNotesText,
  researchUrls,
  runDeepResearchForCuration,
  researchResponse,
  callOpenAI,
  callOpenAICreateDeck
};
