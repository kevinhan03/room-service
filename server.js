const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const env = loadEnv(path.join(root, ".env.local"));

function loadEnv(filePath) {
  const values = { ...process.env };
  if (!fs.existsSync(filePath)) return values;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    values[key] = value;
  }
  return values;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function slugFromUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "manual note";
  }
}

function getOpenAIText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonText(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callPerplexity(input) {
  if (!env.PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY is missing.");
  }

  const prompt = [
    `URL: ${input.sourceUrl || "none"}`,
    `Name: ${input.name || "Untitled Space"}`,
    `Category: ${input.category || "Space"}`,
    `Notes: ${input.notes || "none"}`,
    "",
    "Do deep editorial research for room.service, a Korean Instagram magazine about spaces and brands.",
    "The output will be used to make a six-card post, so do not stop at a short summary.",
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

  const response = await fetch("https://api.perplexity.ai/v1/sonar", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.PERPLEXITY_MODEL || "sonar-deep-research",
      messages: [
        {
          role: "system",
          content: "You are a precise web researcher for a Korean editorial Instagram magazine about spaces and brands."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 6000
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Perplexity API failed: ${response.status} ${text}`);
  }

  const data = JSON.parse(text);
  return {
    content: data.choices?.[0]?.message?.content || "",
    citations: data.citations || [],
    searchResults: data.search_results || []
  };
}

async function callOpenAI(input, research) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const sourceText = JSON.stringify({
    input,
    perplexityResearch: research.content,
    citations: research.citations,
    searchResults: research.searchResults
  }, null, 2);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "developer",
          content: [
            "You write for room.service, a Korean editorial Instagram magazine.",
            "All user-facing JSON string values must be written in Korean.",
            "Translate English research material into natural Korean before writing.",
            "Keep proper nouns, brand names, place names, menu names, and URLs in their original form when needed.",
            "Tone: short, dry, dense with information.",
            "First card must create interest.",
            "Core structure: Hook, Origin, Growth, Signature, Why it matters, Conclusion.",
            "Create 5 to 10 cards depending on available research depth. If enough material exists, add Evidence, Practical Info, or Editor Note.",
            "Forbidden: marketing copy, excessive adjectives, exclamation marks.",
            "Do not invent facts. Separate facts, interpretation, and verification needs.",
            "Cards can be concise, but the brief must contain enough material for production.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Create a production-ready research brief and card news draft from this research.",
            "JSON shape:",
            "{",
            '  "brief": {"angle": "...", "notes": "8-12 dense Korean bullets grouped by Origin/Growth/Signature/Context", "verification": "specific unchecked claims and what source should confirm them"},',
            '  "researchFacts": [{"section": "Origin|Growth|Signature|Why it matters|Practical", "fact": "...", "sourceHint": "...", "confidence": "high|medium|low"}],',
            '  "cards": [{"title": "Hook|Origin|Growth|Signature|Why it matters|Conclusion|Evidence|Practical Info|Editor Note", "copy": "1-3 short Korean lines"}, ... 5 to 10 cards total],',
            '  "caption": "...",',
            '  "sourceSummary": [{"title": "...", "url": "..."}]',
            "}",
            "",
            "Card copy rules:",
            "- Every card copy must be Korean.",
            "- Do not create a Source Note card. Keep sources only in sourceSummary.",
            "- Hook: must trigger curiosity, not explain everything.",
            "- Origin/Growth/Signature: use concrete facts.",
            "- Why it matters: editorial interpretation based on facts.",
            "- Conclusion: dry, memorable, no sales language.",
            "- Avoid words like must-visit, hidden gem, perfect, special, amazing.",
            "",
            sourceText
          ].join("\n")
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status} ${text}`);
  }

  const data = JSON.parse(text);
  return parseJsonText(getOpenAIText(data));
}

async function callOpenAICreateDeck(input) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "developer",
          content: [
            "You write for room.service, a Korean editorial Instagram magazine.",
            "All user-facing text must be Korean, except proper nouns.",
            "Tone: short, dry, dense with information.",
            "Forbidden: marketing copy, excessive adjectives, exclamation marks.",
            "Do not create a Source Note card.",
            "Return only valid JSON. No markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "Create a 5-10 card Instagram carousel draft.",
            "Use this structure first: Hook, Origin, Growth, Signature, Why it matters, Conclusion.",
            "If useful, add Evidence, Practical Info, or Editor Note.",
            "JSON shape:",
            "{",
            '  "cards": [{"title": "...", "copy": "1-3 short Korean lines"}],',
            '  "caption": "short Korean caption"',
            "}",
            "",
            JSON.stringify(input, null, 2)
          ].join("\n")
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status} ${text}`);
  }

  const data = JSON.parse(text);
  return parseJsonText(getOpenAIText(data));
}

async function handleResearch(req, res) {
  try {
    const body = await readBody(req);
    const input = {
      name: String(body.name || "").trim() || "Untitled Space",
      sourceUrl: String(body.sourceUrl || "").trim(),
      category: String(body.category || "Space").trim(),
      notes: String(body.notes || "").trim()
    };

    const research = await callPerplexity(input);
    const generated = await callOpenAI(input, research);
    const now = new Date();

    sendJson(res, 200, {
      brief: {
        id: Date.now(),
        name: input.name,
        sourceUrl: input.sourceUrl,
        category: input.category,
        sourceName: input.sourceUrl ? slugFromUrl(input.sourceUrl) : "manual note",
        notes: generated.brief?.notes || research.content,
        angle: generated.brief?.angle || "",
        verification: generated.brief?.verification || "위치, 운영 시간, 예약 방식, 가격, 공식 표기 확인 필요",
        createdAt: now.toLocaleString("ko-KR")
      },
      cards: Array.isArray(generated.cards) ? generated.cards : [],
      caption: generated.caption || "",
      sources: generated.sourceSummary || research.searchResults || [],
      citations: research.citations || []
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleCreateDeck(req, res) {
  try {
    const body = await readBody(req);
    const generated = await callOpenAICreateDeck({
      title: String(body.title || "Untitled Space").trim(),
      format: String(body.format || "Check-in").trim(),
      angle: String(body.angle || "").trim(),
      hook: String(body.hook || "").trim(),
      notes: String(body.notes || "").trim()
    });

    sendJson(res, 200, {
      cards: Array.isArray(generated.cards) ? generated.cards : [],
      caption: generated.caption || ""
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const requested = path.normalize(path.join(root, pathname));
  if (!requested.startsWith(root)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(requested, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(requested).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/research") {
    handleResearch(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/create-deck") {
    handleCreateDeck(req, res);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  sendText(res, 405, "Method not allowed");
});

server.listen(port, () => {
  console.log(`room.service server running at http://localhost:${port}`);
});
