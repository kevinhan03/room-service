import { createResearch, insertArchiveItem } from "./api.js";
import { buildBriefFromForm } from "./common.js";
import { createBoardFeature } from "./features/board.js";
import { createInboxFeature } from "./features/inbox.js";
import { createKevinArchiveFeature } from "./features/kevin-archive.js";
import { createPostBuilderFeature } from "./features/post-builder.js";
import { createSourcesFeature } from "./features/sources.js";
import { createTodayFeature } from "./features/today.js";
import { $, $$, renderFactsAndSources, setBusy } from "./render.js";

const postBuilderFeature = createPostBuilderFeature();
const {
  applyResearchResult,
  buildDeck,
  buildFallbackDeck,
  clearDeck,
  getBrief,
  markResearchSaved,
  renderDrafts,
  showBrief,
  updateBriefWhy
} = postBuilderFeature;

const boardFeature = createBoardFeature({
  renderToday: () => todayFeature.render(),
  scheduleWhyNoteSave: (field) => todayFeature.scheduleWhyNoteSave(field),
  showBrief,
  switchTab
});
const renderArchive = boardFeature.render;

const kevinArchiveFeature = createKevinArchiveFeature({
  renderArchive,
  showBrief
});
const renderKevinArchive = kevinArchiveFeature.render;

const todayFeature = createTodayFeature({
  getCurrentBrief: getBrief,
  updateCurrentBriefWhy: updateBriefWhy,
  renderArchive,
  useArchive: boardFeature.use
});
const renderToday = todayFeature.render;

const sourcesFeature = createSourcesFeature({
  renderArchive,
  renderToday
});
const renderSources = sourcesFeature.render;
const renderCollectionRuns = sourcesFeature.renderRuns;

const inboxFeature = createInboxFeature({
  buildDeck,
  clearDeck,
  renderArchive,
  renderDrafts,
  renderFactsAndSources,
  showBrief,
  switchTab
});
const renderInbox = inboxFeature.render;

function switchTab(tab) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $$(".section").forEach((section) => section.classList.remove("active"));
  $(`#section-${tab}`).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (tab === "today") renderToday();
  if (tab === "sources") {
    renderSources();
    renderCollectionRuns();
  }
  if (tab === "inbox") renderInbox();
  if (tab === "kevin") renderKevinArchive();
  if (tab === "board") renderArchive();
  if (tab === "builder") renderDrafts();
}

async function generateResearch() {
  const button = $("#generateResearch");
  const seed = buildBriefFromForm();
  $("#researchStatus").textContent = "dig.everyday 취향 필터로 분석 중...";
  setBusy(button, true, "분석 중...");
  try {
    const result = await createResearch({
      name: seed.name,
      sourceUrl: seed.sourceUrl,
      referenceUrls: seed.referenceUrls,
      category: seed.category,
      notes: seed.notes,
      imageCredit: seed.imageCredit,
      imageUsageStatus: seed.imageUsageStatus
    });
    showBrief(result.brief);
    renderFactsAndSources(result);
    applyResearchResult(result);
    $("#researchStatus").textContent = "Analyze 결과를 반영했습니다.";
  } catch (error) {
    console.error(error);
    showBrief(seed);
    $("#researchStatus").textContent = `API 호출에 실패했습니다. ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

async function saveResearch() {
  const button = $("#saveResearch");
  const brief = getBrief() || buildBriefFromForm();
  $("#researchStatus").textContent = "저장 중...";
  setBusy(button, true, "저장 중...");
  try {
    const saved = await insertArchiveItem(brief);
    markResearchSaved(saved?.id);
    $("#researchStatus").textContent = "Board에 저장했습니다.";
    await renderArchive();
  } catch (error) {
    console.error(error);
    $("#researchStatus").textContent = `저장에 실패했습니다. ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  boardFeature.bindEvents();
  todayFeature.bindEvents();
  sourcesFeature.bindEvents();
  inboxFeature.bindEvents();
  kevinArchiveFeature.bindEvents();
  postBuilderFeature.bindEvents();
  $$(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $$("[data-jump]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.jump)));
  $("#generateResearch")?.addEventListener("click", generateResearch);
  $("#saveResearch")?.addEventListener("click", saveResearch);
}

function bootstrap() {
  bindEvents();
  renderToday();
  renderSources();
  renderCollectionRuns();
  renderInbox();
  renderKevinArchive();
  renderArchive();
  renderDrafts();
  buildFallbackDeck();
}

bootstrap();
