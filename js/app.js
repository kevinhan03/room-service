import { createDeck, createResearch, createSource, deleteArchiveItem, deleteSource, fetchArchiveItem, importRssFeed, insertArchiveItem, insertKevinFind, insertPostDraft, loadArchive, loadSources, loadToday, runAllSources, runSource, updateBulkCurationDecision, updateCurationDecision, updateCurationStatus, updateSource } from "./api.js";
import { $, $$, makeDefaultHook, prependArchiveMessage, renderArchiveItems, renderArchiveMessage, renderBrief, renderCaption, renderDeck, renderDeckList, renderFactsAndSources, renderPreviewDeck, safeText, setBusy, showToast, slugFromUrl } from "./render.js";

let currentFormat = "Check-in";
let currentBrief = null;
let currentDeck = [];
let currentCurationItemId = null;
let currentSourceType = "daily_find";
let currentTodayItems = [];
const selectedRecommendationIds = new Set();

function buildBrief() {
  const name = $("#placeName").value.trim() || "Untitled Space";
  const sourceUrl = $("#sourceUrl").value.trim();
  const category = $("#category").value;
  const notes = $("#researchNotes").value.trim();
  const imageCredit = $("#imageCredit")?.value.trim() || "";
  return {
    id: Date.now(),
    name,
    sourceUrl,
    category,
    sourceName: sourceUrl ? slugFromUrl(sourceUrl) : "manual note",
    notes: notes || "공간의 배경, 디자인 언어, 방문 경험을 추가하면 더 정확한 카드 구성이 만들어집니다.",
    angle: `${name}은(는) ${category.toLowerCase()}를 통해 공간의 분위기와 브랜드 태도를 동시에 보여준다.`,
    verification: "운영 시간, 위치, 예약 방식, 가격, 창립자/디자이너 정보는 발행 전 원문 또는 공식 채널로 재확인",
    imageCredit,
    imageUsageStatus: imageCredit ? "credited_ok" : "unknown",
    createdAt: new Date().toLocaleString("ko-KR")
  };
}

function showBrief(brief) {
  currentBrief = brief;
  currentCurationItemId = brief.curationItemId || brief.id || currentCurationItemId;
  currentSourceType = brief.itemType || currentSourceType || "daily_find";
  renderBrief(brief);
}

function showSourceWarning(error) {
  const dialog = $("#sourceWarningDialog");
  const message = $("#sourceWarningMessage");
  if (!dialog || !message) return;
  message.textContent = error?.message || "이 사이트의 자동 수집 호환성을 확인하지 못했습니다.";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function isSourceCompatibilityError(error) {
  return ["SOURCE_UNSUPPORTED", "RSS_FETCH_ERROR", "API_NETWORK_ERROR"].includes(error?.code);
}

function scoreTotal(item) {
  return [item.suitabilityScore, item.tasteFitScore, item.visualScore, item.storyScore].reduce((sum, value) => {
    const score = Number(value || 0);
    return sum + (score > 0 && score <= 10 ? score * 10 : score);
  }, 0);
}

function actionErrorMessage(error) {
  if (error?.code === "MISSING_SUPABASE_KEY") {
    return "Vercel에 SUPABASE_SERVICE_ROLE_KEY가 없습니다. 환경변수를 설정한 뒤 다시 배포해 주세요.";
  }
  return error?.message || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function humanBadge(item) {
  if (item.humanDecision === "post_today") return ["Approved", "approved"];
  if (item.humanDecision === "dig_more" || item.status === "Dig More Candidate") return ["Dig More", "dig-more"];
  if (item.humanDecision === "saved_candidate" || item.humanSaved) return ["Kevin Saved", "saved"];
  if (item.humanDecision === "rejected" || item.status === "Rejected") return ["Rejected", "rejected"];
  return ["AI Recommended", "ai"];
}

function renderBulkBar() {
  const count = selectedRecommendationIds.size;
  if ($("#selectedCount")) $("#selectedCount").textContent = `${count}개 선택`;
  $$("[data-bulk-decision]").forEach((button) => {
    button.disabled = count === 0;
  });
}

function renderTodayItems(items) {
  const target = $("#todayCandidates");
  if (!target) return;
  currentTodayItems = items || [];
  const visibleIds = new Set(currentTodayItems.map((item) => item.id));
  [...selectedRecommendationIds].forEach((id) => {
    if (!visibleIds.has(id)) selectedRecommendationIds.delete(id);
  });
  renderBulkBar();
  if (!currentTodayItems.length) {
    target.innerHTML = `<div class="empty">추천 가능한 후보가 없습니다. Sources에서 새 콘텐츠를 수집하거나 Candidate를 저장하세요.</div>`;
    return;
  }
  target.innerHTML = currentTodayItems.map((item) => {
    const [badgeLabel, badgeTone] = humanBadge(item);
    const checked = selectedRecommendationIds.has(item.id);
    const image = item.imageUrl
      ? `<img src="${safeText(item.imageUrl)}" alt="" loading="lazy">`
      : `<div class="recommendation-image-placeholder"><span>${safeText(item.category || "Find")}</span></div>`;
    return `<article class="recommendation-card" data-item-id="${safeText(item.id)}">
      <label class="recommendation-select"><input type="checkbox" data-select-recommendation="${safeText(item.id)}"${checked ? " checked" : ""}><span class="sr-only">후보 선택</span></label>
      <div class="recommendation-image">${image}</div>
      <div class="recommendation-body">
        <div class="recommendation-top"><div class="badge-row"><span class="status-badge ${badgeTone}">${badgeLabel}</span><span class="status-badge muted">${safeText(item.suggestedStatus || "Candidate")}</span></div><span class="final-score">${Number(item.finalScore || 0).toFixed(1)}</span></div>
        <p class="candidate-source">${safeText(item.category || "")} / ${safeText(item.sourceName || "")}</p>
        <h3>${safeText(item.name || item.title)}</h3>
        <p class="candidate-summary">${safeText(item.oneLineSummary || item.angle || "")}</p>
        <div class="score-strip"><span>Suitability <strong>${Number(item.suitabilityScore || 0)}</strong></span><span>Taste <strong>${Number(item.tasteFitScore || 0)}</strong></span><span>Visual <strong>${Number(item.visualScore || 0)}</strong></span></div>
        <div class="editorial-angle"><span>Editorial angle</span><p>${safeText(item.angle || item.recommendationReason || "아직 편집 앵글이 없습니다.")}</p></div>
        <div class="recommendation-actions">
          <button class="mini-btn primary-action" data-decision="post_today" data-id="${safeText(item.id)}" type="button">Post Today</button>
          <button class="mini-btn" data-decision="saved_candidate" data-id="${safeText(item.id)}" type="button">Save Candidate</button>
          <button class="mini-btn" data-decision="dig_more" data-id="${safeText(item.id)}" type="button">Dig More</button>
          <button class="mini-btn danger" data-decision="rejected" data-id="${safeText(item.id)}" type="button">Reject</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

async function renderToday() {
  const target = $("#todayCandidates");
  if (target) target.innerHTML = `<div class="empty">오늘의 후보를 불러오는 중...</div>`;
  try {
    const result = await loadToday();
    renderTodayItems(result.items || []);
    if ($("#todaySchedule")) $("#todaySchedule").textContent = `매일 ${result.schedule?.time || "07:00"} (${result.schedule?.timezone || "Asia/Seoul"}) 자동 수집`;
  } catch (error) {
    console.error(error);
    if (target) target.innerHTML = `<div class="empty">Today 후보를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  }
}

function renderSourceItems(sources, schedule) {
  const target = $("#sourceList");
  if (!target) return;
  if (!sources?.length) {
    target.innerHTML = `<div class="empty">저장된 자동 수집 소스가 없습니다.</div>`;
    return;
  }
  target.innerHTML = sources.map((source) => `<article class="archive-item"><div class="archive-top"><div><p class="archive-title">${safeText(source.name)}</p><p class="archive-meta">${safeText(source.category || "")} / ${source.is_active ? "Auto on" : "Paused"} / 마지막 수집 ${safeText(source.last_fetched_at ? new Date(source.last_fetched_at).toLocaleString("ko-KR") : "없음")}</p></div><div class="archive-actions"><button class="mini-btn" data-run-source="${safeText(source.id)}" type="button">지금 수집</button><button class="mini-btn" data-toggle-source="${safeText(source.id)}" data-active="${source.is_active}" type="button">${source.is_active ? "중지" : "재개"}</button><button class="mini-btn" data-delete-source="${safeText(source.id)}" type="button">삭제</button></div></div><p class="small">${safeText(source.url)}</p></article>`).join("");
  if ($("#rssStatus") && schedule) $("#rssStatus").textContent = `자동 수집 ${schedule.time} / ${schedule.timezone} / 소스당 최대 ${schedule.limit}개`;
}

async function renderSources() {
  try {
    const result = await loadSources();
    renderSourceItems(result.sources || [], result.schedule);
  } catch (error) {
    console.error(error);
    if ($("#sourceList")) $("#sourceList").innerHTML = `<div class="empty">Sources를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  }
}

async function applyCurationDecision(id, decision, button) {
  const labels = {
    post_today: "Post Today",
    saved_candidate: "Save Candidate",
    dig_more: "Dig More",
    rejected: "Reject"
  };
  setBusy(button, true, "저장 중...");
  try {
    await updateCurationDecision(id, decision);
    selectedRecommendationIds.delete(id);
    showToast(`${labels[decision]} 처리를 완료했습니다.`);
    if (decision === "post_today") {
      await renderArchive();
      await useArchive(id);
      return;
    }
    await Promise.all([renderToday(), renderArchive()]);
  } catch (error) {
    console.error(error);
    showToast(actionErrorMessage(error), "error");
    setBusy(button, false);
  }
}

async function applyBulkDecision(decision, button) {
  const ids = [...selectedRecommendationIds];
  if (!ids.length) return;
  setBusy(button, true, "처리 중...");
  try {
    const result = await updateBulkCurationDecision(ids, decision);
    setBusy(button, false);
    selectedRecommendationIds.clear();
    showToast(`${result.updated ?? ids.length}개 후보를 업데이트했습니다.`);
    await Promise.all([renderToday(), renderArchive()]);
  } catch (error) {
    console.error(error);
    showToast(actionErrorMessage(error), "error");
    setBusy(button, false);
  }
}

async function setCurationStatus(id, status, button) {
  setBusy(button, true, "저장 중...");
  try {
    await updateCurationStatus(id, status);
    showToast(`${status}로 변경했습니다.`);
    await Promise.all([renderToday(), renderArchive()]);
  } catch (error) {
    console.error(error);
    showToast(actionErrorMessage(error), "error");
    setBusy(button, false);
  }
}

async function renderArchive() {
  renderArchiveMessage("Board를 불러오는 중...");
  try {
    const items = await loadArchive();
    renderArchiveItems(items || []);
  } catch (error) {
    console.error(error);
    renderArchiveMessage("Board를 불러오지 못했습니다. Supabase 테이블과 RLS 정책을 확인하세요.");
  }
}

async function useArchive(id) {
  try {
    const data = await fetchArchiveItem(id);
    if (!data) throw new Error("Board item not found.");
    const brief = {
      id: data.id,
      curationItemId: data.id,
      itemType: data.itemType || "daily_find",
      name: data.name || data.title,
      sourceUrl: data.sourceUrl || "",
      category: data.category || "Space",
      sourceName: data.sourceName || "",
      notes: data.notes || "",
      angle: data.angle || data.oneLineSummary || "",
      oneLineSummary: data.oneLineSummary || "",
      whyThisFeelsGood: data.whyThisFeelsGood || "",
      visualStrength: data.visualStrength || "",
      kevinTasteFit: data.kevinTasteFit || "",
      recommendationReason: data.recommendationReason || "",
      verification: data.verification || "",
      imageCredit: data.imageCredit || "",
      imageUsageStatus: data.imageUsageStatus || "unknown",
      createdAt: data.createdAtLabel || data.createdAt
    };
    $("#placeName").value = brief.name || "";
    $("#sourceUrl").value = brief.sourceUrl || "";
    $("#category").value = brief.category || "Space";
    $("#researchNotes").value = brief.notes || "";
    if ($("#imageCredit")) $("#imageCredit").value = brief.imageCredit || "";
    showBrief(brief);
    switchTab("builder");
  } catch (error) {
    console.error(error);
    prependArchiveMessage("Board 항목을 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

async function deleteArchive(id) {
  try {
    await deleteArchiveItem(id);
    renderArchive();
  } catch (error) {
    console.error(error);
    prependArchiveMessage("Board 항목을 삭제하지 못했습니다. Supabase 권한을 확인하세요.");
  }
}

function topic() {
  return $("#createTitle").value.trim() || currentBrief?.name || "dig.everyday";
}

function syncDeck() {
  renderDeck(currentDeck, currentFormat, topic());
}

function buildFallbackDeck() {
  const title = $("#createTitle").value.trim() || "Untitled Space";
  const angle = $("#editorialAngle").value.trim() || "이 공간은 방문보다 태도를 먼저 보여준다.";
  const hook = $("#hookLine").value.trim() || makeDefaultHook(title);
  currentDeck = [
    ["Cover", hook],
    ["Introduction", "무엇인지 설명한다. 이름, 위치, 맥락, 발견한 경로를 짧게 정리한다."],
    ["Why It Matters", angle],
    ["Detail 1", "좋게 느껴지는 첫 번째 이유를 쓴다. 재료, 형태, 운영 방식, 태도 중 하나를 고른다."],
    ["Detail 2", "시각적으로 저장할 만한 지점을 쓴다. 이미지 힘과 기억되는 장면을 중심으로 본다."],
    ["Editor's Note", "Kevin의 취향과 연결되는 지점을 건조하게 남긴다."],
    ["CTA", "오늘의 좋은 발견으로 저장할 이유를 한 문장으로 남긴다."]
  ];
  $("#previewFormat").textContent = currentFormat;
  $("#previewTitle").textContent = title;
  $("#previewHook").textContent = hook;
  syncDeck();
  renderCaption(title, angle, hook);
}

async function buildDeck() {
  const button = $("#generateDeck");
  const title = $("#createTitle").value.trim() || "Untitled Space";
  const angle = $("#editorialAngle").value.trim() || "";
  const hook = $("#hookLine").value.trim() || makeDefaultHook(title);
  $("#previewTitle").textContent = title;
  $("#previewHook").textContent = hook;
  $("#captionText").textContent = "카드 초안을 생성하는 중입니다...";
  setBusy(button, true, "생성 중...");
  try {
    const result = await createDeck({ title, angle, hook, format: currentFormat, notes: currentBrief?.notes || $("#researchNotes").value.trim() || "" });
    if (Array.isArray(result.cards) && result.cards.length) {
      currentDeck = result.cards.map((card) => [card.title, card.copy]);
      syncDeck();
    }
    if (result.caption) $("#captionText").textContent = result.caption;
    try {
      await insertPostDraft({
        curationItemId: currentCurationItemId,
        title,
        category: currentBrief?.category || "",
        sourceType: currentSourceType || "daily_find",
        cards: result.cards,
        caption: result.caption || "",
        hashtags: result.hashtags || [],
        creditNote: result.creditNote || "",
        sourceNote: result.sourceNote || "",
        imageCredit: currentBrief?.imageCredit || "",
        imageUsageStatus: currentBrief?.imageUsageStatus || "unknown",
        editorNote: angle
      });
      $("#exportStatus").textContent = "Post draft를 저장했습니다.";
    } catch (saveError) {
      console.error(saveError);
      $("#exportStatus").textContent = `Post draft 저장 실패: ${saveError.message}`;
    }
  } catch (error) {
    console.error(error);
    buildFallbackDeck();
    $("#captionText").textContent += `\n\n${error.message}\n기본 초안을 표시했습니다.`;
  } finally {
    setBusy(button, false);
  }
}

function switchTab(tab) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $$(".section").forEach((section) => section.classList.remove("active"));
  $(`#section-${tab}`).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (tab === "today") renderToday();
  if (tab === "sources") renderSources();
  if (tab === "board") renderArchive();
}

async function generateResearch() {
  const button = $("#generateResearch");
  const seed = buildBrief();
  $("#researchStatus").textContent = "dig.everyday 취향 필터로 분석 중...";
  setBusy(button, true, "분석 중...");
  try {
    const result = await createResearch({ name: seed.name, sourceUrl: seed.sourceUrl, category: seed.category, notes: seed.notes, imageCredit: seed.imageCredit, imageUsageStatus: seed.imageUsageStatus });
    showBrief(result.brief);
    renderFactsAndSources(result);
    if (Array.isArray(result.cards) && result.cards.length) {
      currentDeck = result.cards.map((card) => [card.title, card.copy]);
      syncDeck();
    }
    if (result.caption) $("#captionText").textContent = result.caption;
    $("#researchStatus").textContent = "Analyze 결과를 반영했습니다.";
  } catch (error) {
    console.error(error);
    showBrief(seed);
    $("#researchStatus").textContent = `API 호출에 실패했습니다. ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function renderRssResult(items) {
  const target = $("#rssResult");
  if (!target) return;
  if (!items?.length) {
    target.innerHTML = `<div class="empty">새 후보가 없습니다. 이미 수집한 URL은 자동으로 건너뜁니다.</div>`;
    return;
  }
  target.innerHTML = items.map((item) => `<article class="archive-item"><div class="archive-top"><div><p class="archive-title">${safeText(item.name || item.title)}</p><p class="archive-meta">${safeText(item.status || "Candidate")} / ${safeText(item.category || "")} / ${safeText(item.sourceName || "RSS")}</p></div><div class="archive-actions"><button class="mini-btn" data-use="${safeText(item.id)}" type="button">사용</button></div></div><p class="small">${safeText(item.angle || item.oneLineSummary || item.whyThisFeelsGood || "")}</p></article>`).join("");
}

async function importRss() {
  const button = $("#importRss");
  const name = $("#rssName").value.trim();
  const url = $("#rssUrl").value.trim();
  const category = $("#rssCategory").value;
  if (!url) {
    $("#rssStatus").textContent = "RSS URL을 입력해 주세요.";
    return;
  }
  $("#rssStatus").textContent = "RSS 수집과 AI 선별 중...";
  setBusy(button, true, "가져오는 중...");
  try {
    const result = await importRssFeed({ name, url, category, limit: 5 });
    renderRssResult(result.items || []);
    $("#rssStatus").textContent = `신규 ${result.imported || 0}개 / 중복 ${result.skipped || 0}개 / 실패 ${result.failed || 0}개`;
    await Promise.all([renderSources(), renderToday(), renderArchive()]);
  } catch (error) {
    console.error(error);
    $("#rssStatus").textContent = `RSS import 실패: ${error.message}`;
    if (isSourceCompatibilityError(error)) showSourceWarning(error);
  } finally {
    setBusy(button, false);
  }
}

async function saveAutomaticSource() {
  const button = $("#saveSource");
  const name = $("#rssName").value.trim();
  const url = $("#rssUrl").value.trim();
  const category = $("#rssCategory").value;
  if (!url) {
    $("#rssStatus").textContent = "사이트 또는 RSS URL을 입력해 주세요.";
    return;
  }
  setBusy(button, true, "저장 중...");
  try {
    await createSource({ name, url, category, isActive: true });
    $("#rssStatus").textContent = "자동 수집 소스로 저장했습니다.";
    await renderSources();
  } catch (error) {
    console.error(error);
    $("#rssStatus").textContent = `소스 저장 실패: ${error.message}`;
    if (isSourceCompatibilityError(error)) showSourceWarning(error);
  } finally {
    setBusy(button, false);
  }
}

async function collectAllSourcesNow() {
  const button = $("#runAllSources");
  setBusy(button, true, "전체 수집 중...");
  $("#rssStatus").textContent = "등록된 활성 소스를 수집하고 AI 선별 중...";
  try {
    const result = await runAllSources();
    $("#rssStatus").textContent = `소스 ${result.sources || 0}개 / 신규 ${result.imported || 0}개 / 중복 ${result.skipped || 0}개 / 실패 ${result.failed || 0}개`;
    await Promise.all([renderSources(), renderToday(), renderArchive()]);
  } catch (error) {
    console.error(error);
    $("#rssStatus").textContent = `전체 수집 실패: ${error.message}`;
    if (isSourceCompatibilityError(error)) showSourceWarning(error);
  } finally {
    setBusy(button, false);
  }
}

async function saveResearch() {
  const button = $("#saveResearch");
  const brief = currentBrief || buildBrief();
  $("#researchStatus").textContent = "저장 중...";
  setBusy(button, true, "저장 중...");
  try {
    const saved = await insertArchiveItem(brief);
    currentCurationItemId = saved?.id || currentCurationItemId;
    currentSourceType = "daily_find";
    $("#researchStatus").textContent = "Board에 저장했습니다.";
    renderArchive();
  } catch (error) {
    console.error(error);
    $("#researchStatus").textContent = `저장에 실패했습니다. ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

async function saveKevinFind() {
  const button = $("#saveKevinFind");
  const name = $("#kevinName").value.trim();
  const category = $("#kevinCategory").value;
  const location = $("#kevinLocation").value.trim();
  const whySaved = $("#kevinWhySaved").value.trim();
  if (!name) {
    $("#kevinStatus").textContent = "이름을 입력해 주세요.";
    return;
  }
  $("#kevinStatus").textContent = "저장 중...";
  setBusy(button, true, "저장 중...");
  try {
    const saved = await insertKevinFind({ name, category, location, whySaved, notes: whySaved, imageUsageStatus: "owned" });
    currentCurationItemId = saved?.id || null;
    currentSourceType = "kevin_found";
    showBrief({
      id: saved?.id || Date.now(),
      curationItemId: saved?.id,
      itemType: "kevin_found",
      name,
      category,
      sourceName: location || "Kevin Found",
      notes: whySaved,
      angle: whySaved,
      imageUsageStatus: "owned",
      createdAt: new Date().toLocaleString("ko-KR")
    });
    $("#createTitle").value = name;
    $("#editorialAngle").value = whySaved;
    $("#kevinStatus").textContent = "Board에 저장했습니다.";
    renderArchive();
  } catch (error) {
    console.error(error);
    $("#kevinStatus").textContent = `저장에 실패했습니다. ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  $$(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $$('[data-jump]').forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.jump)));
  $("#generateResearch").addEventListener("click", generateResearch);
  $("#saveResearch").addEventListener("click", saveResearch);
  $("#saveKevinFind")?.addEventListener("click", saveKevinFind);
  $("#importRss")?.addEventListener("click", importRss);
  $("#saveSource")?.addEventListener("click", saveAutomaticSource);
  $("#runAllSources")?.addEventListener("click", collectAllSourcesNow);
  $("#closeSourceWarning")?.addEventListener("click", () => $("#sourceWarningDialog")?.close());
  $("#sourceWarningDialog")?.addEventListener("click", (event) => {
    if (event.target === $("#sourceWarningDialog")) $("#sourceWarningDialog").close();
  });
  $("#todayCandidates")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-recommendation]");
    if (!checkbox) return;
    if (checkbox.checked) selectedRecommendationIds.add(checkbox.dataset.selectRecommendation);
    else selectedRecommendationIds.delete(checkbox.dataset.selectRecommendation);
    renderBulkBar();
  });
  $("#todayCandidates")?.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-decision]");
    if (action) await applyCurationDecision(action.dataset.id, action.dataset.decision, action);
  });
  $("#bulkActionBar")?.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-bulk-decision]");
    if (action) await applyBulkDecision(action.dataset.bulkDecision, action);
  });
  $("#sourceList")?.addEventListener("click", async (event) => {
    const run = event.target.closest("[data-run-source]");
    const toggle = event.target.closest("[data-toggle-source]");
    const del = event.target.closest("[data-delete-source]");
    try {
      if (run) {
        $("#rssStatus").textContent = "선택한 소스를 수집 중...";
        const result = await runSource(run.dataset.runSource);
        $("#rssStatus").textContent = `신규 ${result.imported || 0}개 / 중복 ${result.skipped || 0}개 / 실패 ${result.failed || 0}개`;
      }
      if (toggle) await updateSource(toggle.dataset.toggleSource, { isActive: toggle.dataset.active !== "true" });
      if (del) await deleteSource(del.dataset.deleteSource);
      await Promise.all([renderSources(), renderToday(), renderArchive()]);
    } catch (error) {
      console.error(error);
      $("#rssStatus").textContent = error.message;
      if (isSourceCompatibilityError(error)) showSourceWarning(error);
    }
  });
  $("#archiveList").addEventListener("click", async (event) => {
    const use = event.target.closest("[data-use]");
    const del = event.target.closest("[data-delete]");
    const status = event.target.closest("[data-status]");
    if (use) await useArchive(use.dataset.use);
    if (del) await deleteArchive(del.dataset.delete);
    if (status) await setCurationStatus(status.dataset.status, status.dataset.value, status);
  });
  $("#deckEditor").addEventListener("input", (event) => {
    const titleField = event.target.closest("[data-card-title]");
    const copyField = event.target.closest("[data-card-copy]");
    const field = titleField || copyField;
    if (!field) return;
    const index = Number(field.dataset.cardTitle ?? field.dataset.cardCopy);
    if (!currentDeck[index]) return;
    if (titleField) currentDeck[index][0] = field.value;
    if (copyField) currentDeck[index][1] = field.value;
    renderDeckList(currentDeck);
    renderPreviewDeck(currentDeck, currentFormat, topic());
  });
  $("#previewDeck").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-card]");
    if (!button) return;
    const card = currentDeck[Number(button.dataset.copyCard)];
    if (!card) return;
    try {
      await navigator.clipboard.writeText(`${card[0]}\n\n${card[1]}`);
      button.textContent = "복사됨";
      setTimeout(() => { button.textContent = "복사"; }, 1200);
    } catch {
      button.textContent = "실패";
      setTimeout(() => { button.textContent = "복사"; }, 1200);
    }
  });
  $("#formatPills").addEventListener("click", (event) => {
    const pill = event.target.closest(".pill");
    if (!pill) return;
    currentFormat = pill.dataset.format;
    $$("#formatPills .pill").forEach((item) => item.classList.remove("active"));
    pill.classList.add("active");
    $("#previewFormat").textContent = currentFormat;
    renderPreviewDeck(currentDeck, currentFormat, topic());
  });
  $("#generateDeck").addEventListener("click", buildDeck);
  $("#copyCaption").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#captionText").textContent);
      $("#exportStatus").textContent = "캡션을 클립보드에 복사했습니다.";
    } catch {
      $("#exportStatus").textContent = "브라우저 권한 때문에 복사하지 못했습니다.";
    }
  });
}

bindEvents();
renderToday();
renderSources();
renderArchive();
buildFallbackDeck();
