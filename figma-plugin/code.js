figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

function hexToRgb(value) {
  const hex = String(value || "#000000").replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex.padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(normalized.slice(0, 2), 16) / 255,
    g: parseInt(normalized.slice(2, 4), 16) / 255,
    b: parseInt(normalized.slice(4, 6), 16) / 255
  };
}

function solidPaint(color, opacity) {
  return {
    type: "SOLID",
    color: hexToRgb(color),
    opacity: opacity == null ? 1 : opacity
  };
}

function overlayPaint(overlay) {
  if (overlay.type === "solid") return solidPaint(overlay.color, overlay.opacity);
  return {
    type: "GRADIENT_LINEAR",
    gradientTransform: [
      [0, 1, 0],
      [-1, 0, 1]
    ],
    gradientStops: overlay.stops.map((stop) => ({
      position: stop.position,
      color: {
        ...hexToRgb(stop.color),
        a: stop.opacity
      }
    }))
  };
}

function figmaAlignment(value) {
  if (value === "right") return "RIGHT";
  if (value === "center") return "CENTER";
  return "LEFT";
}

function primaryAxisAlignment(value) {
  if (value === "top") return "MIN";
  if (value === "bottom") return "MAX";
  return "CENTER";
}

async function loadTextFont(textSpec) {
  const style = Number(textSpec.fontWeight) >= 600 ? "Bold" : "Regular";
  const preferred = { family: textSpec.fontFamily || "Arial", style };
  try {
    await figma.loadFontAsync(preferred);
    return preferred;
  } catch {
    const fallback = { family: "Inter", style };
    await figma.loadFontAsync(fallback);
    return fallback;
  }
}

async function createTextNode(textSpec) {
  const text = figma.createText();
  text.name = textSpec.name || "Text";
  text.fontName = await loadTextFont(textSpec);
  text.fontSize = textSpec.fontSize;
  text.lineHeight = { unit: "PIXELS", value: textSpec.lineHeight };
  text.textAlignHorizontal = figmaAlignment(textSpec.align);
  text.fills = [solidPaint(textSpec.color, 1)];
  text.characters = String(textSpec.text || "").replace(/\r\n?/g, "\n");
  text.resize(textSpec.width, Math.max(textSpec.lineHeight, textSpec.fontSize));
  text.textAutoResize = "HEIGHT";
  return text;
}

function createRectangle(spec, name, fills) {
  const rectangle = figma.createRectangle();
  rectangle.name = name;
  rectangle.x = spec.x;
  rectangle.y = spec.y;
  rectangle.resize(spec.width, spec.height);
  rectangle.fills = fills;
  return rectangle;
}

async function createCard(card, x, y) {
  const frame = figma.createFrame();
  frame.name = `${String(card.index).padStart(2, "0")} · ${card.title || card.role}`;
  frame.x = x;
  frame.y = y;
  frame.resize(card.size.width, card.size.height);
  frame.clipsContent = true;
  frame.fills = [];

  const placeholder = createRectangle(
    card.placeholder,
    "IMAGE PLACEHOLDER · Drop photo or video here",
    [solidPaint(card.placeholder.color || "#d8d6cf", 1)]
  );
  frame.appendChild(placeholder);

  const overlay = createRectangle(card.overlay, "Overlay", [overlayPaint(card.overlay)]);
  frame.appendChild(overlay);

  const containerSpec = card.textContainer;
  const container = figma.createFrame();
  container.name = "Text";
  container.x = containerSpec.x;
  container.y = containerSpec.y;
  container.resize(containerSpec.width, containerSpec.height);
  container.fills = [];
  container.clipsContent = false;
  container.layoutMode = "VERTICAL";
  container.primaryAxisAlignItems = primaryAxisAlignment(containerSpec.verticalAlign);
  container.counterAxisAlignItems = "MIN";
  container.itemSpacing = containerSpec.itemSpacing || 0;
  container.paddingTop = containerSpec.paddingTop || 0;
  container.paddingBottom = containerSpec.paddingBottom || 0;
  container.paddingLeft = 0;
  container.paddingRight = 0;
  frame.appendChild(container);

  for (const textSpec of card.texts) {
    const text = await createTextNode(textSpec);
    container.appendChild(text);
    text.layoutAlign = "STRETCH";
  }
  return frame;
}

function validatePayload(payload) {
  if (!payload || payload.schema !== "dig.everyday.figma-deck") {
    throw new Error("dig.everyday Figma JSON 형식이 아닙니다.");
  }
  if (!Array.isArray(payload.cards) || payload.cards.length !== 7) {
    throw new Error("정확히 7장의 카드가 필요합니다.");
  }
}

async function importDeck(payload) {
  validatePayload(payload);
  const gap = Number(payload.canvas?.gap) || 120;
  const width = Number(payload.canvas?.width) || 1080;
  const viewportCenter = figma.viewport.center;
  const startX = viewportCenter.x - ((width + gap) * payload.cards.length - gap) / 2;
  const startY = viewportCenter.y - 675;
  const frames = [];

  for (let index = 0; index < payload.cards.length; index += 1) {
    frames.push(await createCard(payload.cards[index], startX + index * (width + gap), startY));
  }

  figma.currentPage.selection = frames;
  figma.viewport.scrollAndZoomIntoView(frames);
  figma.notify("7개 Figma 프레임을 만들었습니다.");
}

figma.ui.onmessage = async (message) => {
  if (message.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (message.type !== "import") return;
  try {
    await importDeck(message.payload);
    figma.ui.postMessage({ type: "success" });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
