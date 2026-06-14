import { getTextStyle, isWebUrl } from "./render.js";

export function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    image.src = objectUrl;
  });
}

function wrapCanvasText(context, text, maxWidth) {
  const paragraphs = String(text || "").split(/\n+/);
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
    if (paragraphIndex < paragraphs.length - 1) lines.push("");
  });
  return lines;
}

function loadCanvasImage(url) {
  return new Promise((resolve) => {
    if (!isWebUrl(url)) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function drawCoverImage(context, image, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function anchorForAlign(align, canvasWidth, margin) {
  if (align === "center") return { textAlign: "center", x: canvasWidth / 2 };
  if (align === "right") return { textAlign: "right", x: canvasWidth - margin };
  return { textAlign: "left", x: margin };
}

async function drawSlidePng(card, index, subject, category) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  const total = 7;
  const textStyle = getTextStyle(card, index, total);
  const fontScale = textStyle.fontScale;

  if (index === 0) {
    const coverImage = await loadCanvasImage(card[2]);
    context.fillStyle = "#d8d6cf";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (coverImage) drawCoverImage(context, coverImage, canvas.width, canvas.height);
    const gradient = context.createLinearGradient(0, 480, 0, canvas.height);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(.55, "rgba(0,0,0,.15)");
    gradient.addColorStop(1, "rgba(0,0,0,.8)");
    context.fillStyle = gradient;
    context.fillRect(0, 420, canvas.width, 930);
    context.textBaseline = "top";

    const { textAlign, x } = anchorForAlign(textStyle.align, canvas.width, 86);
    context.textAlign = textAlign;
    const lineHeight = 74 * fontScale;
    context.font = `700 ${64 * fontScale}px Arial, sans-serif`;
    const hookLines = wrapCanvasText(context, card[1], 900).slice(0, 4);

    let metaY;
    let hookY;
    if (textStyle.position === "top") {
      metaY = 460;
      hookY = metaY + 50;
    } else if (textStyle.position === "center") {
      const blockHeight = 50 + hookLines.length * lineHeight;
      metaY = 420 + (canvas.height - 420 - blockHeight) / 2;
      hookY = metaY + 50;
    } else {
      metaY = 1010;
      hookY = 1064;
    }

    context.fillStyle = "rgba(255,255,255,.82)";
    context.font = "600 23px Arial, sans-serif";
    context.fillText(`${subject}  ·  ${category}`.toUpperCase(), x, metaY);

    context.fillStyle = textStyle.color;
    context.font = `700 ${64 * fontScale}px Arial, sans-serif`;
    hookLines.forEach((line) => {
      context.fillText(line, x, hookY);
      hookY += lineHeight;
    });
    return canvas;
  }

  const slideImage = await loadCanvasImage(card[2]);
  context.fillStyle = "#d8d6cf";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (slideImage) drawCoverImage(context, slideImage, canvas.width, canvas.height);
  context.textBaseline = "top";

  if (index === total - 1) {
    context.fillStyle = "rgba(0,0,0,.42)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = textStyle.color;
    context.font = `700 ${50 * fontScale}px Arial, sans-serif`;
    const { textAlign, x } = anchorForAlign(textStyle.align, canvas.width, 86);
    context.textAlign = textAlign;
    const ctaLines = wrapCanvasText(context, card[1], 920).slice(0, 4);
    const lineHeight = 62 * fontScale;
    const blockHeight = ctaLines.length * lineHeight;
    let ctaY;
    if (textStyle.position === "top") ctaY = 80;
    else if (textStyle.position === "bottom") ctaY = canvas.height - blockHeight - 80;
    else ctaY = (canvas.height - blockHeight) / 2;
    ctaLines.forEach((line) => {
      context.fillText(line, x, ctaY);
      ctaY += lineHeight;
    });
    return canvas;
  }

  const gradient = context.createLinearGradient(0, 520, 0, canvas.height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(.55, "rgba(0,0,0,.18)");
  gradient.addColorStop(1, "rgba(0,0,0,.82)");
  context.fillStyle = gradient;
  context.fillRect(0, 480, canvas.width, 870);
  context.fillStyle = textStyle.color;
  context.font = `400 ${30 * fontScale}px Arial, sans-serif`;
  const { textAlign, x } = anchorForAlign(textStyle.align, canvas.width, 86);
  context.textAlign = textAlign;
  const copyLines = wrapCanvasText(context, card[1], 900).slice(0, 8);
  const lineHeight = 48 * fontScale;
  let copyY;
  if (textStyle.position === "top") copyY = 520;
  else if (textStyle.position === "center") copyY = 480 + (canvas.height - 480 - copyLines.length * lineHeight) / 2;
  else copyY = 1240 - copyLines.length * lineHeight;
  copyLines.forEach((line) => {
    context.fillText(line, x, copyY);
    copyY += lineHeight;
  });
  return canvas;
}

export async function downloadDeckPngPack(deck, subject, category) {
  const slug = (subject || "dig-everyday")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
  for (let index = 0; index < deck.length; index += 1) {
    const canvas = await drawSlidePng(deck[index], index, subject, category);
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${slug || "dig-everyday"}-${String(index + 1).padStart(2, "0")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
}
