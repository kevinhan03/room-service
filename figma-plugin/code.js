figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

function hexToRgb(value) {
  var hex = String(value || "#000000").replace("#", "");
  var normalized = hex.length === 3
    ? hex.split("").map(function (character) { return character + character; }).join("")
    : (hex + "000000").slice(0, 6);
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
    gradientStops: overlay.stops.map(function (stop) {
      var rgb = hexToRgb(stop.color);
      return {
        position: stop.position,
        color: {
          r: rgb.r,
          g: rgb.g,
          b: rgb.b,
          a: stop.opacity
        }
      };
    })
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
  var style = Number(textSpec.fontWeight) >= 600 ? "Bold" : "Regular";
  var preferred = { family: textSpec.fontFamily || "Arial", style: style };
  try {
    await figma.loadFontAsync(preferred);
    return preferred;
  } catch (error) {
    var fallback = { family: "Inter", style: style };
    await figma.loadFontAsync(fallback);
    return fallback;
  }
}

async function createTextNode(textSpec) {
  var text = figma.createText();
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
  var rectangle = figma.createRectangle();
  rectangle.name = name;
  rectangle.x = spec.x;
  rectangle.y = spec.y;
  rectangle.resize(spec.width, spec.height);
  rectangle.fills = fills;
  return rectangle;
}

async function createCard(card, x, y) {
  var frame = figma.createFrame();
  frame.name = String(card.index).padStart(2, "0") + " · " + (card.title || card.role);
  frame.x = x;
  frame.y = y;
  frame.resize(card.size.width, card.size.height);
  frame.clipsContent = true;
  frame.fills = [];

  var placeholder = createRectangle(
    card.placeholder,
    "IMAGE PLACEHOLDER · Drop photo or video here",
    [solidPaint(card.placeholder.color || "#d8d6cf", 1)]
  );
  frame.appendChild(placeholder);

  var overlay = createRectangle(card.overlay, "Overlay", [overlayPaint(card.overlay)]);
  frame.appendChild(overlay);

  var containerSpec = card.textContainer;
  var container = figma.createFrame();
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

  for (var textIndex = 0; textIndex < card.texts.length; textIndex += 1) {
    var text = await createTextNode(card.texts[textIndex]);
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
  var canvas = payload.canvas || {};
  var gap = Number(canvas.gap) || 120;
  var width = Number(canvas.width) || 1080;
  var viewportCenter = figma.viewport.center;
  var startX = viewportCenter.x - ((width + gap) * payload.cards.length - gap) / 2;
  var startY = viewportCenter.y - 675;
  var frames = [];

  for (var index = 0; index < payload.cards.length; index += 1) {
    frames.push(await createCard(payload.cards[index], startX + index * (width + gap), startY));
  }

  figma.currentPage.selection = frames;
  figma.viewport.scrollAndZoomIntoView(frames);
  figma.notify("7개 Figma 프레임을 만들었습니다.");
}

figma.ui.onmessage = async function (message) {
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
