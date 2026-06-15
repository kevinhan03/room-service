import { getTextStyle } from "./render.js";

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1350;
const TEXT_MARGIN = 90;

function slugify(value) {
  return String(value || "dig-everyday")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeLineBreaks(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
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
  y = 0
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
    color
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

function verticalAlignment(position) {
  if (position === "top") return "top";
  if (position === "bottom") return "bottom";
  return "center";
}

function coverCard(card, index, total, subject, category) {
  const style = getTextStyle(card, index, total);
  const textWidth = 900;
  const fontScale = style.fontScale;
  return {
    index: index + 1,
    role: "cover",
    title: normalizeLineBreaks(card[0]),
    size: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    placeholder: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT, color: "#d8d6cf" },
    overlay: gradientOverlay(420, 930, 0.15, 0.8),
    textContainer: {
      x: TEXT_MARGIN,
      y: 420,
      width: textWidth,
      height: 930,
      verticalAlign: verticalAlignment(style.position),
      paddingTop: 40,
      paddingBottom: 46,
      itemSpacing: 22
    },
    texts: [
      textNode({
        name: "Meta",
        text: `${subject || "dig.everyday"}  ·  ${category || "Find"}`.toUpperCase(),
        fontSize: 23,
        fontWeight: 600,
        lineHeight: 28,
        color: "#ffffff",
        align: style.align,
        width: textWidth,
        x: 0,
        y: 0
      }),
      textNode({
        name: "Hook",
        text: card[1],
        fontSize: 64 * fontScale,
        fontWeight: 700,
        lineHeight: 74 * fontScale,
        color: style.color,
        align: style.align,
        width: textWidth,
        x: 0,
        y: 50
      })
    ]
  };
}

function contentCard(card, index, total) {
  const style = getTextStyle(card, index, total);
  const textWidth = 900;
  const fontScale = style.fontScale;
  return {
    index: index + 1,
    role: "content",
    title: normalizeLineBreaks(card[0]),
    size: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
    placeholder: { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT, color: "#d8d6cf" },
    overlay: gradientOverlay(480, 870, 0.18, 0.82),
    textContainer: {
      x: TEXT_MARGIN,
      y: 480,
      width: textWidth,
      height: 870,
      verticalAlign: verticalAlignment(style.position),
      paddingTop: 40,
      paddingBottom: 110,
      itemSpacing: 0
    },
    texts: [
      textNode({
        name: "Copy",
        text: card[1],
        fontSize: 30 * fontScale,
        fontWeight: 400,
        lineHeight: 48 * fontScale,
        color: style.color,
        align: style.align,
        width: textWidth
      })
    ]
  };
}

function ctaCard(card, index, total) {
  const style = getTextStyle(card, index, total);
  const textWidth = 920;
  const fontScale = style.fontScale;
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
    textContainer: {
      x: 80,
      y: 0,
      width: textWidth,
      height: FRAME_HEIGHT,
      verticalAlign: verticalAlignment(style.position),
      paddingTop: 80,
      paddingBottom: 80,
      itemSpacing: 0
    },
    texts: [
      textNode({
        name: "CTA",
        text: card[1],
        fontSize: 50 * fontScale,
        fontWeight: 700,
        lineHeight: 62 * fontScale,
        color: style.color,
        align: style.align,
        width: textWidth
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
    version: 1,
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
