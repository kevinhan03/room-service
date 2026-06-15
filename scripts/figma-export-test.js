const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "../js/figma-export.js");
const source = fs.readFileSync(sourcePath, "utf8")
  .replace('import { getTextStyle } from "./render.js";', `
    function getTextStyle(card, index, total) {
      const defaults = index === total - 1
        ? { position: "center", align: "center", fontScale: 1, color: "#ffffff" }
        : { position: "bottom", align: "left", fontScale: 1, color: "#ffffff" };
      return { ...defaults, ...(card[3] || {}) };
    }
  `)
  .replace(/export function /g, "function ");

const context = {
  Blob,
  Date,
  URL: {
    createObjectURL() {
      return "blob:figma-export";
    },
    revokeObjectURL(url) {
      context.revokedUrl = url;
    }
  },
  document: {
    body: {
      appendChild(link) {
        context.appendedLink = link;
      }
    },
    createElement(tag) {
      assert.equal(tag, "a");
      return {
        click() {
          context.clicked = true;
        },
        remove() {
          context.removed = true;
        }
      };
    }
  }
};

vm.createContext(context);
vm.runInContext(`${source}
this.buildFigmaExportPayload = buildFigmaExportPayload;
this.downloadFigmaExport = downloadFigmaExport;`, context);

const deck = [
  ["Cover", "첫 줄\n둘째 줄", "https://example.com/cover.jpg", { position: "top", align: "right", fontScale: 0.9, color: "#fefefe" }],
  ["Introduction", "소개 문장", "https://example.com/2.jpg"],
  ["Why It Matters", "왜 중요한지"],
  ["Detail 1", "첫 번째 디테일"],
  ["Detail 2", "두 번째 디테일"],
  ["Editor's Note", "에디터 노트", "", { position: "center", align: "center", fontScale: 1.2, color: "#ffeecc" }],
  ["CTA", "저장해두고\n다시 보기", "https://example.com/7.jpg", { position: "bottom", align: "center", fontScale: 1.1, color: "#ffffff" }]
];

const payload = context.buildFigmaExportPayload(deck, "테스트 호텔", "Hotel");
assert.equal(payload.schema, "dig.everyday.figma-deck");
assert.equal(payload.cards.length, 7);
assert.equal(payload.cards[0].role, "cover");
assert.equal(payload.cards[0].texts[1].text, "첫 줄\n둘째 줄");
assert.equal(payload.cards[0].texts[1].align, "right");
assert.equal(payload.cards[0].texts[1].fontSize, 57.6);
assert.equal(payload.cards[5].textContainer.verticalAlign, "center");
assert.equal(payload.cards[5].texts[0].color, "#ffeecc");
assert.equal(payload.cards[6].role, "cta");
assert.equal(payload.cards[6].overlay.type, "solid");
assert.equal(payload.cards[6].textContainer.verticalAlign, "bottom");
assert.ok(!JSON.stringify(payload).includes("example.com"), "image URLs must not be exported");

context.downloadFigmaExport(deck, "테스트 호텔", "Hotel");
assert.equal(context.appendedLink.download, "테스트-호텔-figma.json");
assert.equal(context.appendedLink.href, "blob:figma-export");
assert.equal(context.clicked, true);
assert.equal(context.removed, true);
assert.equal(context.revokedUrl, "blob:figma-export");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../figma-plugin/manifest.json"), "utf8"));
assert.equal(manifest.main, "code.js");
assert.equal(manifest.ui, "ui.html");
assert.deepEqual(manifest.networkAccess.allowedDomains, ["none"]);

const pluginSource = fs.readFileSync(path.join(__dirname, "../figma-plugin/code.js"), "utf8");
assert.ok(pluginSource.includes('figma.createFrame()'));
assert.ok(pluginSource.includes('type: "GRADIENT_LINEAR"'));
assert.ok(pluginSource.includes('figma.loadFontAsync'));
assert.ok(pluginSource.includes('family: "Inter"'));

console.log("Figma export payload and plugin contract tests passed.");
