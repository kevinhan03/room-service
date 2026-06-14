import { isWebUrl } from "./render.js";

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

async function drawSlidePng(card, index, subject, category) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");

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
    context.fillStyle = "rgba(255,255,255,.82)";
    context.font = "600 23px Arial, sans-serif";
    context.fillText(`${subject}  ·  ${category}`.toUpperCase(), 86, 1010);
    context.fillStyle = "#fff";
    context.font = "700 64px Arial, sans-serif";
    const hookLines = wrapCanvasText(context, card[1], 900).slice(0, 4);
    let hookY = 1064;
    hookLines.forEach((line) => {
      context.fillText(line, 86, hookY);
      hookY += 74;
    });
    return canvas;
  }

  const slideImage = await loadCanvasImage(card[2]);
  context.fillStyle = "#d8d6cf";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (slideImage) drawCoverImage(context, slideImage, canvas.width, canvas.height);
  context.textBaseline = "top";

  if (index === 6) {
    context.fillStyle = "rgba(0,0,0,.42)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.font = "700 50px Arial, sans-serif";
    context.textAlign = "center";
    const ctaLines = wrapCanvasText(context, card[1], 920).slice(0, 4);
    const lineHeight = 62;
    let ctaY = (canvas.height - ctaLines.length * lineHeight) / 2;
    ctaLines.forEach((line) => {
      context.fillText(line, canvas.width / 2, ctaY);
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
  context.fillStyle = "rgba(255,255,255,.94)";
  context.font = "400 30px Arial, sans-serif";
  context.textAlign = "left";
  const copyLines = wrapCanvasText(context, card[1], 900).slice(0, 8);
  const lineHeight = 48;
  let copyY = 1240 - copyLines.length * lineHeight;
  copyLines.forEach((line) => {
    context.fillText(line, 86, copyY);
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
