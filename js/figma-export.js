import { getTextStyle } from "./render.js";

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1350;
const TEXT_X = 86;
const TEXT_WIDTH = 908;

function slugify(value) {
  return String(value || "dig-everyday")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeLineBreaks(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

function wrapText(text, fontWeight, fontSize, maxWidth, maxLines) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  const paragraphs = normalizeLineBreaks(text).split(/\n/);
  const lines = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    if (!words.length && paragraphIndex < paragraphs.length - 1) lines.push("");
  });
  return lines.slice(0, maxLines);
}

function textNode({
  name,
  text,
  fontSize,
  fontWeight,
  lineHeight,
  color,
  align,
  width,
  x = 0,
  y = 0,
  opacity = 1
}) {
  return {
    type: "text",
    name,
    text: normalizeLineBreaks(text),
    x,
    y,
    width,
    align,
    fontFamily: "Arial",
    fontSize,
    fontWeight,
    lineHeight,
    color,
    opacity
  };
}

function gradientOverlay(y, height, middleOpacity, endOpacity) {
  return {
    type: "gradient",
    x: 0,
    y,
    width: FRAME_WIDTH,
    height,
    direction: "vertical",
    stops: [
      { position: 0, color: "#000000", opacity: 0 },
      { position: 0.55, color: "#000000", opacity: middleOpacity },
      { position: 1, color: "#000000", opacity: endOpacity }
    ]
  };
}

function coverCard(card, index, total, subject, category) {
  const style = getTextStyle(card, index, total);
  const fontScale = style.fontScale;
  const hookFontSize = 64 * fontScale;
  const hookLineHeight = 74 * fontScale;
  const hookLines = wrapText(card[1], 700, hookFontSize, 900, 4);
  let metaY;
  if (style.position === "top") metaY = 460;
  else if (style.position === "center") {
    const blockHeight = 50 + hookLines.length * hookLineHeight;
    metaY = 420 + (FRAME_HEIGHT - 420 - blockHeight) / 2;
  } else metaY = 1010;
  const hookY = style.position === "bottom" ? 1064 : metaY + 50;
  return {
    index: index + 1,
    role: "cover",
    title: normalizeLineBreaks(card[0]),
    size: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    placeholder: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT, color: "#d8d6cf" },
    overlay: gradientOverlay(420, 930, 0.15, 0.8),
    texts: [
      textNode({
        name: "Meta",
        text: `${subject || "dig.everyday"}  ·  ${category || "Find"}`.toUpperCase(),
        fontSize: 23,
        fontWeight: 600,
        lineHeight: 28,
        color: "#ffffff",
        align: style.align,
        width: TEXT_WIDTH,
        x: TEXT_X,
        y: metaY,
        opacity: 0.82
      }),
      textNode({
        name: "Hook",
        text: hookLines.join("\n"),
        fontSize: hookFontSize,
        fontWeight: 700,
        lineHeight: hookLineHeight,
        color: style.color,
        align: style.align,
        width: TEXT_WIDTH,
        x: TEXT_X,
        y: hookY
      })
    ]
  };
}

function contentCard(card, index, total) {
  const style = getTextStyle(card, index, total);
  const fontScale = style.fontScale;
  const fontSize = 30 * fontScale;
  const lineHeight = 48 * fontScale;
  const copyLines = wrapText(card[1], 400, fontSize, 900, 8);
  const blockHeight = copyLines.length * lineHeight;
  let copyY;
  if (style.position === "top") copyY = 520;
  else if (style.position === "center") copyY = 480 + (FRAME_HEIGHT - 480 - blockHeight) / 2;
  else copyY = 1240 - blockHeight;
  return {
    index: index + 1,
    role: "content",
    title: normalizeLineBreaks(card[0]),
    size: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    placeholder: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT, color: "#d8d6cf" },
    overlay: gradientOverlay(480, 870, 0.18, 0.82),
    texts: [
      textNode({
        name: "Copy",
        text: copyLines.join("\n"),
        fontSize,
        fontWeight: 400,
        lineHeight,
        color: style.color,
        align: style.align,
        width: TEXT_WIDTH,
        x: TEXT_X,
        y: copyY
      })
    ]
  };
}

function ctaCard(card, index, total) {
  const style = getTextStyle(card, index, total);
  const fontScale = style.fontScale;
  const fontSize = 50 * fontScale;
  const lineHeight = 62 * fontScale;
  const ctaLines = wrapText(card[1], 700, fontSize, 920, 4);
  const blockHeight = ctaLines.length * lineHeight;
  let ctaY;
  if (style.position === "top") ctaY = 80;
  else if (style.position === "bottom") ctaY = FRAME_HEIGHT - blockHeight - 80;
  else ctaY = (FRAME_HEIGHT - blockHeight) / 2;
  return {
    index: index + 1,
    role: "cta",
    title: normalizeLineBreaks(card[0]),
    size: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    placeholder: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT, color: "#d8d6cf" },
    overlay: {
      type: "solid",
      x: 0,
      y: 0,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      color: "#000000",
      opacity: 0.42
    },
    texts: [
      textNode({
        name: "CTA",
        text: ctaLines.join("\n"),
        fontSize,
        fontWeight: 700,
        lineHeight,
        color: style.color,
        align: style.align,
        width: TEXT_WIDTH,
        x: TEXT_X,
        y: ctaY
      })
    ]
  };
}

export function buildFigmaExportPayload(deck, subject, category) {
  if (!Array.isArray(deck) || deck.length !== 7) {
    throw new Error("Figma export에는 7장 덱이 필요합니다.");
  }
  return {
    schema: "dig.everyday.figma-deck",
    version: 2,
    exportedAt: new Date().toISOString(),
    subject: normalizeLineBreaks(subject || "dig.everyday"),
    category: normalizeLineBreaks(category || "Find"),
    canvas: { width: FRAME_WIDTH, height: FRAME_HEIGHT, gap: 120 },
    cards: deck.map((card, index) => {
      if (index === 0) return coverCard(card, index, deck.length, subject, category);
      if (index === deck.length - 1) return ctaCard(card, index, deck.length);
      return contentCard(card, index, deck.length);
    })
  };
}

export function downloadFigmaExport(deck, subject, category) {
  const payload = buildFigmaExportPayload(deck, subject, category);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(subject) || "dig-everyday"}-figma.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return payload;
}
