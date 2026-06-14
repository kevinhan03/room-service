const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rankInboxIdeas, scoreIdea, tokenize } = require("../lib/personalization");

const signals = {
  categoryWeights: new Map([
    ["Hotel", 24],
    ["Fashion", -16]
  ]),
  sourceWeights: new Map([["Kevin", 18]]),
  keywordWeights: new Map([
    ["독립", 20],
    ["호텔", 18],
    ["재료", 12],
    ["바이럴", -18],
    ["발매", -12]
  ]),
  sampleCount: 9
};

const hotel = scoreIdea({
  title: "독립 호텔이 오래된 재료를 남기는 방식",
  category: "Hotel",
  angle: "기존 건물의 재료를 어떻게 보존했는지 본다.",
  why_publish: "Kevin이 저장한 소형 호텔과 연결된다.",
  visual_score: 86,
  research_score: 82,
  novelty_score: 78
}, signals);

const fashion = scoreIdea({
  title: "이번 주 바이럴 패션 발매",
  category: "Fashion",
  angle: "화제가 된 신제품을 정리한다.",
  why_publish: "빠른 트렌드 뉴스다.",
  visual_score: 86,
  research_score: 82,
  novelty_score: 78
}, signals);

assert.ok(hotel.personal_score > fashion.personal_score, "positive taste signals should outrank rejected patterns");
assert.ok(hotel.matched_preferences.includes("Hotel 카테고리 선호"));
assert.ok(fashion.score_breakdown.rejectedPatternPenalty > 0);
assert.deepEqual(tokenize("독립 호텔, 독립 호텔 그리고 공간"), ["독립", "호텔", "독립", "호텔"]);

const ranked = rankInboxIdeas([
  { ...hotel, title: "Hotel A" },
  { ...fashion, title: "Fashion A" },
  { title: "Object A", category: "Object", angle: "작은 오브제", why_publish: "관찰", visual_score: 70, research_score: 70, novelty_score: 70 },
  { title: "Book A", category: "Book", angle: "책", why_publish: "관찰", visual_score: 60, research_score: 60, novelty_score: 60 }
], signals);

assert.equal(ranked.length, 3);
assert.deepEqual(ranked.map((idea) => idea.rank), [1, 2, 3]);
assert.equal(ranked[0].title, "Hotel A");

const renderSource = fs.readFileSync(path.join(__dirname, "../js/render.js"), "utf8");
const archiveRenderer = renderSource.slice(
  renderSource.indexOf("export function renderArchiveItems"),
  renderSource.indexOf("export function renderArchiveMessage")
);
assert.ok(!archiveRenderer.includes("data-delete="), "Board renderer should not expose a separate delete button");
assert.ok(archiveRenderer.includes('data-value="Rejected"'), "Board renderer should keep the Reject action");

console.log("Personalization ranking and Board action tests passed.");
