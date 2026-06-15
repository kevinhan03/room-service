const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { buildCanvaPptx, canvaExportFilename } = require("../lib/canva-pptx");
const { validateDraftCards } = require("../lib/validate");

async function main() {
  const slides = [
    ["Cover", "첫 줄\n둘째 줄", "photo", { position: "top", align: "right", fontScale: 0.9, color: "#fefefe" }],
    ["Introduction", "직접 가본 듯한 소개 문장", "video"],
    ["Why It Matters", "왜 중요한지 알려주는 문장", "photo"],
    ["Detail 1", "첫 번째 디테일", "photo"],
    ["Detail 2", "두 번째 디테일", "video"],
    ["Editor's Note", "에디터 노트", "photo", { position: "center", align: "center", fontScale: 1.2, color: "#ffeecc" }],
    ["CTA", "저장해두고\n다시 보기", "video", { position: "bottom", align: "center", fontScale: 1.1, color: "#ffffff" }]
  ].map(([title, body, mediaType, textStyle = {}], index) => ({
    slide_index: index + 1,
    slide_type: title,
    title,
    body,
    media_type: mediaType,
    text_style: textStyle
  }));

  const buffer = await buildCanvaPptx({
    draft: { title: "테스트 호텔", category: "Hotel" },
    slides
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString(), "PK");

  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideFiles.length, 7);
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  assert.match(presentation, /cx="7315200"\s+cy="9144000"/);
  const combinedSlides = (await Promise.all(slideFiles.map((name) => zip.file(name).async("string")))).join("\n");
  assert.match(combinedSlides, /PHOTO PLACEHOLDER/);
  assert.match(combinedSlides, /VIDEO PLACEHOLDER/);
  assert.match(combinedSlides, /첫 줄/);
  assert.match(combinedSlides, /둘째 줄/);

  const normalized = validateDraftCards([
    { title: "Photo", copy: "copy" },
    { title: "Video", copy: "copy", mediaType: "video" },
    { title: "Bad", copy: "copy", mediaType: "other" }
  ]);
  assert.deepEqual(normalized.map((card) => card.mediaType), ["photo", "video", "photo"]);
  assert.equal(canvaExportFilename("테스트 / 호텔"), "테스트-호텔-canva-4x5.pptx");
}

main().then(() => {
  console.log("Canva PPTX export tests passed.");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
