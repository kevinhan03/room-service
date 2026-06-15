const PptxGenJS = require("pptxgenjs");

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1350;
const SLIDE_WIDTH = 8;
const SLIDE_HEIGHT = 10;
const PX_TO_INCH = SLIDE_WIDTH / FRAME_WIDTH;
const PX_TO_POINT = PX_TO_INCH * 72;
const TEXT_X = 86;
const TEXT_WIDTH = 908;

function inch(value) {
  return value * PX_TO_INCH;
}

function point(value) {
  return value * PX_TO_POINT;
}

function normalizeColor(value, fallback = "FFFFFF") {
  const match = String(value || "").match(/^#?([0-9a-f]{6})$/i);
  return match ? match[1].toUpperCase() : fallback;
}

function normalizeMediaType(value) {
  return value === "video" ? "video" : "photo";
}

function defaultTextStyle(index, total) {
  return index === total - 1
    ? { position: "center", align: "center", fontScale: 1, color: "#ffffff" }
    : { position: "bottom", align: "left", fontScale: 1, color: "#ffffff" };
}

function getTextStyle(card, index, total) {
  return { ...defaultTextStyle(index, total), ...(card.textStyle || {}) };
}

function estimatedLines(text, maxCharacters, maxLines) {
  const count = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / maxCharacters)), 0);
  return Math.min(maxLines, count);
}

function addPlaceholder(slide, pptx, mediaType) {
  slide.background = { color: mediaType === "video" ? "C8CBC9" : "D8D6CF" };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: SLIDE_HEIGHT,
    line: { color: "B8B6AF", width: 1 },
    fill: { color: mediaType === "video" ? "C8CBC9" : "D8D6CF" }
  });
  if (mediaType === "video") {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 3.45,
      y: 4.1,
      w: 1.1,
      h: 1.1,
      line: { color: "FFFFFF", transparency: 20, width: 1.5 },
      fill: { color: "303331", transparency: 40 }
    });
    slide.addText("▶", {
      x: 3.71,
      y: 4.35,
      w: 0.65,
      h: 0.5,
      fontFace: "Arial",
      fontSize: 22,
      color: "FFFFFF",
      align: "center",
      margin: 0
    });
  }
  slide.addText(mediaType === "video" ? "VIDEO PLACEHOLDER" : "PHOTO PLACEHOLDER", {
    x: 0.5,
    y: mediaType === "video" ? 5.35 : 4.72,
    w: 7,
    h: 0.35,
    fontFace: "Arial",
    fontSize: 10,
    bold: true,
    charSpacing: 2,
    color: "6F706C",
    align: "center",
    margin: 0
  });
}

function addGradientApproximation(slide, pptx, y, height, endOpacity) {
  const bands = 8;
  for (let index = 0; index < bands; index += 1) {
    const progress = (index + 1) / bands;
    const opacity = endOpacity * progress * progress;
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: inch(y + (height / bands) * index),
      w: SLIDE_WIDTH,
      h: inch(height / bands + 2),
      line: { color: "000000", transparency: 100 },
      fill: { color: "000000", transparency: Math.round((1 - opacity) * 100) }
    });
  }
}

function addText(slide, text, options) {
  slide.addText(String(text || "").replace(/\r\n?/g, "\n"), {
    fontFace: "Arial",
    margin: 0,
    breakLine: false,
    fit: "shrink",
    valign: "top",
    ...options
  });
}

function addCover(slide, pptx, card, index, total, subject, category) {
  const style = getTextStyle(card, index, total);
  const scale = Number(style.fontScale) || 1;
  const lineHeight = 74 * scale;
  const lines = estimatedLines(card.copy, 19 / scale, 4);
  let metaY = 1010;
  if (style.position === "top") metaY = 460;
  if (style.position === "center") metaY = 420 + (FRAME_HEIGHT - 420 - (50 + lines * lineHeight)) / 2;
  const hookY = style.position === "bottom" ? 1064 : metaY + 50;
  addGradientApproximation(slide, pptx, 420, 930, 0.8);
  addText(slide, `${subject || "dig.everyday"}  ·  ${category || "Find"}`.toUpperCase(), {
    x: inch(TEXT_X),
    y: inch(metaY),
    w: inch(TEXT_WIDTH),
    h: inch(34),
    fontSize: point(23),
    bold: true,
    color: "FFFFFF",
    transparency: 18,
    align: style.align
  });
  addText(slide, card.copy, {
    x: inch(TEXT_X),
    y: inch(hookY),
    w: inch(TEXT_WIDTH),
    h: inch(Math.min(330, FRAME_HEIGHT - hookY - 40)),
    fontSize: point(64 * scale),
    bold: true,
    color: normalizeColor(style.color),
    align: style.align,
    breakLine: false
  });
}

function addContent(slide, pptx, card, index, total) {
  const style = getTextStyle(card, index, total);
  const scale = Number(style.fontScale) || 1;
  const lineHeight = 48 * scale;
  const lines = estimatedLines(card.copy, 35 / scale, 8);
  const blockHeight = lines * lineHeight;
  let copyY = 1240 - blockHeight;
  if (style.position === "top") copyY = 520;
  if (style.position === "center") copyY = 480 + (FRAME_HEIGHT - 480 - blockHeight) / 2;
  addGradientApproximation(slide, pptx, 480, 870, 0.82);
  addText(slide, card.copy, {
    x: inch(TEXT_X),
    y: inch(copyY),
    w: inch(TEXT_WIDTH),
    h: inch(Math.max(blockHeight + 24, 120)),
    fontSize: point(30 * scale),
    color: normalizeColor(style.color),
    align: style.align,
    breakLine: false
  });
}

function addCta(slide, pptx, card, index, total) {
  const style = getTextStyle(card, index, total);
  const scale = Number(style.fontScale) || 1;
  const lineHeight = 62 * scale;
  const lines = estimatedLines(card.copy, 24 / scale, 4);
  const blockHeight = lines * lineHeight;
  let ctaY = (FRAME_HEIGHT - blockHeight) / 2;
  if (style.position === "top") ctaY = 80;
  if (style.position === "bottom") ctaY = FRAME_HEIGHT - blockHeight - 80;
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: SLIDE_HEIGHT,
    line: { color: "000000", transparency: 100 },
    fill: { color: "000000", transparency: 58 }
  });
  addText(slide, card.copy, {
    x: inch(80),
    y: inch(ctaY),
    w: inch(920),
    h: inch(Math.max(blockHeight + 24, 150)),
    fontSize: point(50 * scale),
    bold: true,
    color: normalizeColor(style.color),
    align: style.align,
    breakLine: false
  });
}

async function buildCanvaPptx({ draft, slides }) {
  if (!Array.isArray(slides) || slides.length !== 7) {
    throw new Error("Canva export requires exactly seven slides.");
  }
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "DIG_4_5", width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pptx.layout = "DIG_4_5";
  pptx.author = "dig.everyday";
  pptx.subject = draft?.category || "Instagram carousel";
  pptx.title = draft?.title || "dig.everyday deck";
  pptx.company = "dig.everyday";
  pptx.lang = "ko-KR";
  pptx.theme = {
    headFontFace: "Arial",
    bodyFontFace: "Arial",
    lang: "ko-KR"
  };

  [...slides]
    .sort((a, b) => Number(a.slide_index) - Number(b.slide_index))
    .forEach((row, index, ordered) => {
      const card = {
        title: row.title || row.slide_type || "",
        copy: row.body || "",
        textStyle: row.text_style || {},
        mediaType: normalizeMediaType(row.media_type)
      };
      const slide = pptx.addSlide();
      addPlaceholder(slide, pptx, card.mediaType);
      if (index === 0) addCover(slide, pptx, card, index, ordered.length, draft?.title, draft?.category);
      else if (index === ordered.length - 1) addCta(slide, pptx, card, index, ordered.length);
      else addContent(slide, pptx, card, index, ordered.length);
      slide.addNotes(`Slide ${index + 1}: ${card.title}\nMedia: ${card.mediaType}`);
    });

  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function canvaExportFilename(title) {
  const slug = String(title || "dig-everyday")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "dig-everyday"}-canva-4x5.pptx`;
}

module.exports = { buildCanvaPptx, canvaExportFilename };
