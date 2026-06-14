const { AppError, apiTimeoutMs } = require("./config");

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

async function fetchWithTimeout(url, options, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), apiTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError(`${label} request timed out.`, 504, "API_TIMEOUT");
    }
    throw new AppError(`${label} request failed.`, 502, "API_NETWORK_ERROR", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonResponse(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(`${label} returned invalid JSON.`, 502, "API_INVALID_JSON", text.slice(0, 500));
  }
}

function parseModelJson(text, label) {
  try {
    return parseJsonText(text);
  } catch {
    throw new AppError(`${label} returned a response that could not be parsed as JSON.`, 502, "MODEL_JSON_PARSE_FAILED", text.slice(0, 500));
  }
}

module.exports = {
  getOpenAIText,
  parseJsonText,
  fetchWithTimeout,
  parseJsonResponse,
  parseModelJson
};
