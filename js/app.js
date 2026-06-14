import { createDeck, createInboxItem, createResearch, createSource, deleteArchiveItem, deleteKevinFind, deletePostDraft, deleteSource, fetchArchiveItem, fetchPostDraft, finalizeCollectionRun, generateInboxIdeas, importRssFeed, insertArchiveItem, insertKevinFind, insertPostDraft, loadArchive, loadCollectionRuns, loadInboxItems, loadKevinFinds, loadPostDrafts, loadSources, loadToday, researchInboxIdea, runAllSources, runSource, updateBulkCurationDecision, updateCurationDecision, updateCurationStatus, updateInboxIdea, updateKevinFind, updatePostDraft, updateSource, updateWhyNote, uploadPostSlideImage } from "./api.js";
import { $, $$, isWebUrl, makeDefaultHook, prependArchiveMessage, renderArchiveItems, renderArchiveMessage, renderBrief, renderCaption, renderDeck, renderDeckList, renderFactsAndSources, renderPreviewDeck, safeText, setBusy, showToast, slugFromUrl } from "./render.js";

let currentFormat = "Check-in";
let currentBrief = null;
let currentPostCategory = "";
let currentDeck = [];
let currentCurationItemId = null;
let currentSourceType = "daily_find";
let currentTodayItems = [];
const selectedRecommendationIds = new Set();
let currentDraftId = null;
let draftAutoSaveTimer = null;
let currentKevinFinds = [];
let currentInboxItems = [];
const whyNoteTimers = new Map();

function parseReferenceUrls(value) {
  return [...new Set(String(value || "")
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean))];
}

function buildBrief() {
  const name = $("#placeName").value.trim() || "Untitled Space";
  const sourceUrl = $("#sourceUrl").value.trim();
  const referenceUrls = parseReferenceUrls($("#referenceUrls")?.value);
  const primarySourceUrl = sourceUrl || referenceUrls[0] || "";
  const category = $("#category").value;
  const notes = $("#researchNotes").value.trim();
  const imageCredit = $("#imageCredit")?.value.trim() || "";
  return {
    id: Date.now(),
    name,
    sourceUrl: primarySourceUrl,
    referenceUrls,
    category,
    sourceName: primarySourceUrl ? slugFromUrl(primarySourceUrl) : "manual note",
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
  currentPostCategory = brief.category || "";
  currentCurationItemId = brief.curationItemId || null;
  currentSourceType = brief.itemType || currentSourceType || "daily_find";
  renderBrief(brief);
}

function showSourceWarning(error) {
  const dialog = $("#sourceWarningDialog");
  const message = $("#sourceWarningMessage");
  if (!dialog || !message) return;
  message.textContent = error?.message || "이 사이트의 기사 수집 호환성을 확인하지 못했습니다.";
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

function displayableImageUrl(value) {
  if (!isWebUrl(value)) return "";
  try {
    const url = new URL(value);
    const imagePath = /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url.pathname + url.search);
    const imageHost = /(^|[.-])(cdn|image|images|img|media|static)([.-]|$)/i.test(url.hostname);
    return imagePath || imageHost ? url.toString() : "";
  } catch {
    return "";
  }
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
    const imageUrl = displayableImageUrl(item.imageUrl);
    const image = imageUrl
      ? `<img src="${safeText(imageUrl)}" alt="" loading="lazy">`
      : `<div class="recommendation-image-placeholder"><span>${safeText(item.category || "Find")}</span></div>`;
    return `<article class="recommendation-card" data-item-id="${safeText(item.id)}">
      <label class="recommendation-select"><input type="checkbox" data-select-recommendation="${safeText(item.id)}"${checked ? " checked" : ""}><span class="sr-only">후보 선택</span></label>
      <div class="recommendation-image">${image}</div>
      <div class="recommendation-body">
        <div class="recommendation-top"><div class="badge-row"><span class="status-badge ${badgeTone}">${badgeLabel}</span><span class="status-badge muted">${safeText(item.suggestedStatus || "Candidate")}</span></div><span class="final-score">${Number(item.finalScore || 0).toFixed(1)}</span></div>
        <p class="candidate-source">${safeText(item.sourceKind || "Magazine")} / ${safeText(item.category || "")} / ${safeText(item.sourceName || "")}</p>
        <h3>${safeText(item.name || item.title)}</h3>
        <p class="candidate-summary">${safeText(item.oneLineSummary || item.angle || "")}</p>
        <div class="score-strip"><span>Suitability <strong>${Number(item.suitabilityScore || 0)}</strong></span><span>Taste <strong>${Number(item.tasteFitScore || 0)}</strong></span><span>Visual <strong>${Number(item.visualScore || 0)}</strong></span></div>
        <div class="editorial-angle"><span>Editorial angle</span><p>${safeText(item.angle || item.recommendationReason || "아직 편집 앵글이 없습니다.")}</p></div>
        <div class="why-note-box">
          <div class="why-note-head"><strong>Why I Like This</strong><span class="why-note-status" data-why-note-status="${safeText(item.id)}">${item.whyNoteUpdatedAt ? "저장됨" : "입력 대기"}</span></div>
          <textarea class="why-note-input" data-why-note="${safeText(item.id)}" placeholder="왜 이게 좋았는지 한두 줄로 적어보세요. 최종 게시물은 이 메모를 중심으로 작성됩니다.">${safeText(item.whyILikeThis || "")}</textarea>
        </div>
        <div class="recommendation-actions">
          <button class="mini-btn primary-action" data-decision="post_today" data-id="${safeText(item.id)}" type="button">Post Today</button>
          <button class="mini-btn" data-decision="saved_candidate" data-id="${safeText(item.id)}" type="button">Save Candidate</button>
          <button class="mini-btn" data-decision="dig_more" data-id="${safeText(item.id)}" type="button">Dig More</button>
          <button class="mini-btn danger" data-decision="rejected" data-id="${safeText(item.id)}" type="button">Reject</button>
          ${isWebUrl(item.sourceUrl) ? `<a class="mini-btn" href="${safeText(item.sourceUrl)}" target="_blank" rel="noreferrer">원문</a>` : ""}
        </div>
      </div>
    </article>`;
  }).join("");
}

function scheduleWhyNoteSave(field) {
  const id = field?.dataset.whyNote;
  if (!id) return;
  const status = field.closest("[data-item-id]")?.querySelector("[data-why-note-status]");
  if (status) status.textContent = "입력 중...";
  clearTimeout(whyNoteTimers.get(id));
  whyNoteTimers.set(id, setTimeout(async () => {
    if (status) status.textContent = "저장 중...";
    try {
      const result = await updateWhyNote(id, field.value.trim());
      const saved = result.item || {};
      const todayItem = currentTodayItems.find((item) => item.id === id);
      if (todayItem) {
        todayItem.whyILikeThis = saved.whyILikeThis ?? field.value.trim();
        todayItem.personalRelevanceScore = saved.personalRelevanceScore ?? todayItem.personalRelevanceScore;
        todayItem.whyNoteUpdatedAt = saved.whyNoteUpdatedAt || new Date().toISOString();
      }
      if (currentBrief?.curationItemId === id) {
        currentBrief.whyILikeThis = field.value.trim();
        if ($("#whyILikeThis")) $("#whyILikeThis").value = field.value.trim();
      }
      if (status) status.textContent = "저장됨";
    } catch (error) {
      console.error(error);
      if (status) status.textContent = "저장 실패";
      showToast(actionErrorMessage(error), "error");
    } finally {
      whyNoteTimers.delete(id);
    }
  }, 700));
}

async function renderToday() {
  const target = $("#todayCandidates");
  const scrollY = window.scrollY;
  if (target && !currentTodayItems.length) target.innerHTML = `<div class="empty">오늘의 후보를 불러오는 중...</div>`;
  try {
    const result = await loadToday();
    renderTodayItems(result.items || []);
    if ($("#todaySchedule")) $("#todaySchedule").textContent = "Sources에서 수집 버튼을 누르면 후보가 업데이트됩니다.";
  } catch (error) {
    console.error(error);
    if (target) target.innerHTML = `<div class="empty">Today 후보를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  } finally {
    window.scrollTo(0, scrollY);
  }
}

function renderSourceItems(sources, collection) {
  const target = $("#sourceList");
  if (!target) return;
  if (!sources?.length) {
    target.innerHTML = `<div class="empty">저장된 수집 소스가 없습니다.</div>`;
    return;
  }
  target.innerHTML = sources.map((source) => `<article class="archive-item"><div class="archive-top"><div><div class="badge-row"><span class="status-badge muted">${safeText(source.source_type || "Magazine")}</span><span class="status-badge ${source.is_active ? "saved" : "rejected"}">${source.is_active ? "수집 대상" : "제외됨"}</span></div><p class="archive-title">${safeText(source.name)}</p><p class="archive-meta">${safeText(source.type || "url").toUpperCase()} / 마지막 수집 ${safeText(source.last_fetched_at ? new Date(source.last_fetched_at).toLocaleString("ko-KR") : "없음")}</p></div><div class="archive-actions"><button class="mini-btn" data-run-source="${safeText(source.id)}" type="button">지금 수집</button><button class="mini-btn" data-toggle-source="${safeText(source.id)}" data-active="${source.is_active}" type="button">${source.is_active ? "전체 수집에서 제외" : "전체 수집에 포함"}</button><button class="mini-btn" data-delete-source="${safeText(source.id)}" type="button">삭제</button></div></div><p class="small">${safeText(source.url)}</p></article>`).join("");
  if ($("#rssStatus") && collection) $("#rssStatus").textContent = `버튼 실행 시 소스당 최대 ${collection.limit}개를 수집합니다.`;
}

async function renderSources() {
  try {
    const result = await loadSources();
    renderSourceItems(result.sources || [], result.collection);
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
  const researchDecision = decision === "dig_more" || decision === "post_today";
  setBusy(button, true, researchDecision ? "심층 조사 중..." : "저장 중...");
  try {
    const result = await updateCurationDecision(id, decision);
    selectedRecommendationIds.delete(id);
    showToast(result.deepResearchWarning
      ? `${labels[decision]}은 저장했지만 심층 조사에 실패했습니다.`
      : `${labels[decision]} 처리를 완료했습니다.`);
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
  const list = $("#archiveList");
  const scrollY = window.scrollY;
  if (list && !list.children.length) renderArchiveMessage("Board를 불러오는 중...");
  try {
    const items = await loadArchive();
    renderArchiveItems(items || []);
  } catch (error) {
    console.error(error);
    renderArchiveMessage("Board를 불러오지 못했습니다. Supabase 테이블과 RLS 정책을 확인하세요.");
  } finally {
    window.scrollTo(0, scrollY);
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
      referenceUrls: data.referenceUrls || [],
      category: data.category || "Space",
      sourceName: data.sourceName || "",
      notes: data.notes || "",
      angle: data.angle || data.oneLineSummary || "",
      oneLineSummary: data.oneLineSummary || "",
      whyThisFeelsGood: data.whyThisFeelsGood || "",
      visualStrength: data.visualStrength || "",
      kevinTasteFit: data.kevinTasteFit || "",
      recommendationReason: data.recommendationReason || "",
      whyILikeThis: data.whyILikeThis || "",
      kevinAngle: data.kevinAngle || "",
      personalRelevanceScore: data.personalRelevanceScore || 0,
      verification: data.verification || "",
      imageCredit: data.imageCredit || "",
      imageUsageStatus: data.imageUsageStatus || "unknown",
      createdAt: data.createdAtLabel || data.createdAt
    };
    $("#placeName").value = brief.name || "";
    $("#sourceUrl").value = brief.sourceUrl || "";
    if ($("#referenceUrls")) $("#referenceUrls").value = (brief.referenceUrls || []).filter((url) => url !== brief.sourceUrl).join("\n");
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

function postCategory() {
  return currentPostCategory || currentBrief?.category || $("#category")?.value || currentFormat;
}

function syncDeck() {
  renderDeck(currentDeck, currentFormat, topic(), postCategory());
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
  const whyILikeThis = $("#whyILikeThis")?.value.trim() || currentBrief?.whyILikeThis || "";
  const hook = $("#hookLine").value.trim() || makeDefaultHook(title);
  if (!whyILikeThis && !window.confirm("Why I Like This 메모가 없습니다. 원문 요약 중심의 초안이 될 수 있습니다. 그래도 생성할까요?")) return;
  $("#previewTitle").textContent = title;
  $("#previewHook").textContent = hook;
  $("#captionText").textContent = "카드 초안을 생성하는 중입니다...";
  setBusy(button, true, "생성 중...");
  try {
    if (currentCurationItemId && whyILikeThis) {
      await updateWhyNote(currentCurationItemId, whyILikeThis, currentBrief?.kevinAngle || "");
    }
    const result = await createDeck({
      curationItemId: currentCurationItemId,
      title,
      angle,
      whyILikeThis,
      kevinAngle: currentBrief?.kevinAngle || "",
      hook,
      format: currentFormat,
      notes: currentBrief?.notes || $("#researchNotes").value.trim() || ""
    });
    if (currentBrief && result.kevinAngle) currentBrief.kevinAngle = result.kevinAngle;
    if (Array.isArray(result.cards) && result.cards.length) {
      currentDeck = result.cards.map((card) => [card.title, card.copy]);
      syncDeck();
    }
    if (result.caption) $("#captionText").textContent = result.caption;
    try {
      const savedDraft = await insertPostDraft({
        curationItemId: currentCurationItemId,
        title,
        category: postCategory(),
        sourceType: currentSourceType || "daily_find",
        cards: result.cards,
        caption: result.caption || "",
        hashtags: result.hashtags || [],
        creditNote: result.creditNote || "",
        sourceNote: result.sourceNote || "",
        imageCredit: currentBrief?.imageCredit || "",
        imageUsageStatus: currentBrief?.imageUsageStatus || "unknown",
        editorNote: angle,
        format: currentFormat,
        hook
      });
      currentDraftId = savedDraft?.draft?.id || null;
      $("#draftStatus").value = savedDraft?.draft?.status || "Draft";
      $("#draftSaveStatus").textContent = currentDraftId ? "저장됨" : "새 Draft";
      $("#exportStatus").textContent = "Post draft를 저장했습니다.";
      await renderDrafts();
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
  if (tab === "sources") {
    renderSources();
    renderCollectionRuns();
  }
  if (tab === "inbox") renderInbox();
  if (tab === "kevin") renderKevinArchive();
  if (tab === "board") renderArchive();
  if (tab === "builder") renderDrafts();
}

function renderInboxRows(items) {
  const target = $("#inboxList");
  if (!items.length) {
    target.innerHTML = '<div class="empty">아직 저장한 단서가 없습니다. 링크나 떠오른 생각부터 짧게 적어보세요.</div>';
    return;
  }
  target.innerHTML = items.map((item) => {
    const ideas = item.kevin_inbox_ideas || [];
    const ideaRows = ideas.length
      ? `<div class="inbox-ideas">${ideas.map((idea) => `<article class="inbox-idea ${safeText(idea.status || "suggested")}">
          <div class="inbox-idea-top"><div><span class="inbox-rank">0${Number(idea.rank || 0)}</span><h3>${safeText(idea.title)}</h3></div><span class="status-badge muted">${safeText(idea.category)}</span></div>
          <p>${safeText(idea.angle || "")}</p>
          <p><strong>만들 이유</strong> ${safeText(idea.why_publish || "")}</p>
          <div class="inline">
            <button class="mini-btn" data-inbox-idea-status="${safeText(idea.id)}" data-status="selected" type="button"${idea.status === "selected" ? " disabled" : ""}>선택</button>
            <button class="mini-btn" data-inbox-idea-status="${safeText(idea.id)}" data-status="held" type="button"${idea.status === "held" ? " disabled" : ""}>보류</button>
            <button class="mini-btn primary-action" data-research-inbox-idea="${safeText(idea.id)}" type="button">상세 조사 + Draft</button>
          </div>
        </article>`).join("")}</div>`
      : `<button class="btn secondary" data-generate-inbox-ideas="${safeText(item.id)}" type="button">게시 아이디어 3개 만들기</button>`;
    const links = (item.reference_urls || []).map((url, index) => `<a class="mini-btn" href="${safeText(url)}" target="_blank" rel="noreferrer">참고 ${index + 1}</a>`).join("");
    return `<article class="inbox-item">
      <div class="inbox-item-head"><div><p class="archive-meta">${safeText(item.status || "new")} · ${formatDateTime(item.created_at)}</p><p class="inbox-seed">${safeText(item.seed_text)}</p></div><div class="inline">${links}</div></div>
      ${ideaRows}
    </article>`;
  }).join("");
}

async function renderInbox() {
  const target = $("#inboxList");
  if (!target) return;
  target.innerHTML = '<div class="empty">Inbox를 불러오는 중...</div>';
  try {
    currentInboxItems = await loadInboxItems();
    renderInboxRows(currentInboxItems);
  } catch (error) {
    target.innerHTML = `<div class="empty">Inbox를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  }
}

async function saveInboxClue() {
  const button = $("#saveInboxItem");
  const seedText = $("#inboxSeed").value.trim();
  const referenceUrls = parseReferenceUrls($("#inboxUrls").value);
  if (!seedText && !referenceUrls.length) {
    $("#inboxStatus").textContent = "링크나 아이디어를 하나 이상 입력해 주세요.";
    return;
  }
  setBusy(button, true, "저장 중...");
  try {
    await createInboxItem({ seedText, referenceUrls });
    $("#inboxSeed").value = "";
    $("#inboxUrls").value = "";
    $("#inboxStatus").textContent = "Inbox에 저장했습니다.";
    await renderInbox();
  } catch (error) {
    $("#inboxStatus").textContent = actionErrorMessage(error);
  } finally {
    setBusy(button, false);
  }
}

async function makeInboxIdeas(id, button) {
  setBusy(button, true, "찾는 중...");
  $("#inboxStatus").textContent = "Perplexity가 관련 자료를 찾고 게시 아이디어 3개를 만드는 중...";
  try {
    await generateInboxIdeas(id);
    $("#inboxStatus").textContent = "게시 가능한 아이디어 3개를 만들었습니다.";
    await renderInbox();
  } catch (error) {
    $("#inboxStatus").textContent = actionErrorMessage(error);
  } finally {
    setBusy(button, false);
  }
}

async function setInboxIdeaStatus(id, status, button) {
  setBusy(button, true, "저장 중...");
  try {
    await updateInboxIdea(id, status);
    await renderInbox();
  } catch (error) {
    showToast(actionErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function developInboxIdea(id, button) {
  setBusy(button, true, "심층 조사 중...");
  $("#inboxStatus").textContent = "공식 출처와 참고 자료를 심층 조사하고 있습니다...";
  try {
    const result = await researchInboxIdea(id);
    const saved = await insertArchiveItem(result.brief);
    await updateInboxIdea(id, "researched", saved.id);
    showBrief({ ...result.brief, curationItemId: saved.id, itemType: "daily_find" });
    renderFactsAndSources(result);
    currentDeck = [];
    switchTab("builder");
    await buildDeck();
    showToast("상세 조사 결과로 새 Draft를 만들었습니다.");
    await Promise.all([renderInbox(), renderArchive(), renderDrafts()]);
  } catch (error) {
    console.error(error);
    $("#inboxStatus").textContent = actionErrorMessage(error);
    showToast(actionErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
}

async function generateResearch() {
  const button = $("#generateResearch");
  const seed = buildBrief();
  $("#researchStatus").textContent = "dig.everyday 취향 필터로 분석 중...";
  setBusy(button, true, "분석 중...");
  try {
    const result = await createResearch({ name: seed.name, sourceUrl: seed.sourceUrl, referenceUrls: seed.referenceUrls, category: seed.category, notes: seed.notes, imageCredit: seed.imageCredit, imageUsageStatus: seed.imageUsageStatus });
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
  target.innerHTML = items.map((item) => `<article class="archive-item"><div class="archive-top"><div><p class="archive-title">${safeText(item.name || item.title)}</p><p class="archive-meta">${safeText(item.status || "Candidate")} / ${safeText(item.sourceKind || "Magazine")} / ${safeText(item.category || "")} / ${safeText(item.sourceName || "Source")}</p></div><div class="archive-actions"><button class="mini-btn" data-use="${safeText(item.id)}" type="button">사용</button></div></div><p class="small">${safeText(item.angle || item.oneLineSummary || item.whyThisFeelsGood || "")}</p></article>`).join("");
}

async function importRss() {
  const button = $("#importRss");
  const name = $("#rssName").value.trim();
  const url = $("#rssUrl").value.trim();
  const sourceType = $("#rssSourceType")?.value || "Magazine";
  if (!url) {
    $("#rssStatus").textContent = "RSS URL을 입력해 주세요.";
    return;
  }
  $("#rssStatus").textContent = "RSS 수집과 AI 선별 중...";
  setBusy(button, true, "가져오는 중...");
  try {
    const result = await importRssFeed({ name, url, sourceType, limit: 5 });
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
  const sourceType = $("#rssSourceType")?.value || "Magazine";
  if (!url) {
    $("#rssStatus").textContent = "사이트 또는 RSS URL을 입력해 주세요.";
    return;
  }
  setBusy(button, true, "저장 중...");
  try {
    await createSource({ name, url, sourceType, isActive: true });
    $("#rssStatus").textContent = "수집 소스로 저장했습니다. 수집은 버튼을 눌렀을 때만 시작됩니다.";
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
  $("#rssStatus").textContent = "수집 대상을 준비하는 중...";
  try {
    const batch = await runAllSources();
    const sources = batch.sources || [];
    const totals = { imported: 0, skipped: 0, failed: 0 };

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      $("#rssStatus").textContent = `${index + 1}/${sources.length} ${source.name} 수집 및 AI 선별 중...`;
      try {
        const result = await runSource(source.id, batch.runId);
        totals.imported += result.imported || 0;
        totals.skipped += result.skipped || 0;
        totals.failed += result.failed || 0;
      } catch (error) {
        console.error(error);
        totals.failed += 1;
      }
    }

    const result = await finalizeCollectionRun(batch.runId);
    $("#rssStatus").textContent = `소스 ${result.sources || sources.length}개 / 신규 ${result.imported ?? totals.imported}개 / 중복 ${result.skipped ?? totals.skipped}개 / 실패 ${result.failed ?? totals.failed}개`;
    await Promise.all([renderSources(), renderToday(), renderArchive()]);
    await renderCollectionRuns();
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

function resetKevinForm() {
  $("#kevinEditingId").value = "";
  $("#kevinName").value = "";
  $("#kevinLocation").value = "";
  $("#kevinVisitedAt").value = "";
  $("#kevinRating").value = "";
  $("#kevinWhySaved").value = "";
  $("#saveKevinFind").textContent = "새 항목 저장";
  $("#cancelKevinEdit").hidden = true;
}

async function saveKevinFind() {
  const button = $("#saveKevinFind");
  const id = $("#kevinEditingId").value;
  const name = $("#kevinName").value.trim();
  const category = $("#kevinCategory").value;
  const location = $("#kevinLocation").value.trim();
  const visitedAt = $("#kevinVisitedAt").value;
  const rating = $("#kevinRating").value;
  const whySaved = $("#kevinWhySaved").value.trim();
  if (!name) {
    $("#kevinStatus").textContent = "이름을 입력해 주세요.";
    return;
  }
  $("#kevinStatus").textContent = "저장 중...";
  setBusy(button, true, "저장 중...");
  try {
    const payload = { name, category, location, visitedAt, rating, whySaved, notes: whySaved, imageUsageStatus: "owned" };
    if (id) {
      await updateKevinFind(id, payload);
      $("#kevinStatus").textContent = "Kevin Archive 항목을 수정했습니다.";
    } else {
      const saved = await insertKevinFind(payload);
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
      $("#kevinStatus").textContent = "Board와 Kevin Archive에 저장했습니다.";
    }
    resetKevinForm();
    await Promise.all([renderKevinArchive(), renderArchive()]);
  } catch (error) {
    console.error(error);
    $("#kevinStatus").textContent = `저장에 실패했습니다. ${error.message}`;
  } finally {
    setBusy(button, false);
  }
}

function formatDateTime(value) {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

async function renderCollectionRuns() {
  const target = $("#collectionRuns");
  if (!target) return;
  target.innerHTML = '<div class="empty">수집 기록을 불러오는 중...</div>';
  try {
    const runs = await loadCollectionRuns();
    if (!runs.length) {
      target.innerHTML = '<div class="empty">아직 수동 수집 기록이 없습니다.</div>';
      return;
    }
    target.innerHTML = runs.map((run) => {
      const sourceRuns = [...(run.source_collection_runs || [])]
        .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))
        .map((item) => `<div class="operation-source"><span>${safeText(item.source_name || "Source")}</span><span>${safeText(item.status || "unknown")} · 신규 ${Number(item.imported_count || 0)} · 실패 ${Number(item.failed_count || 0)}</span></div>`)
        .join("");
      return `<article class="operation-run">
        <div class="operation-head"><div><strong>Manual collection</strong><p>${formatDateTime(run.started_at)}</p></div><span class="status-badge ${run.status === "completed" ? "saved" : run.status === "failed" ? "rejected" : "dig-more"}">${safeText(run.status || "running")}</span></div>
        <div class="operation-summary"><span>Sources <strong>${Number(run.source_count || 0)}</strong></span><span>Imported <strong>${Number(run.imported_count || 0)}</strong></span><span>Skipped <strong>${Number(run.skipped_count || 0)}</strong></span><span>Failed <strong>${Number(run.failed_count || 0)}</strong></span></div>
        ${sourceRuns ? `<details><summary>소스별 결과</summary><div class="operation-sources">${sourceRuns}</div></details>` : ""}
      </article>`;
    }).join("");
  } catch (error) {
    target.innerHTML = `<div class="empty">수집 기록을 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  }
}

function draftCards() {
  return currentDeck.map(([title, copy, imageUrl]) => ({ title, copy, imageUrl: imageUrl || "" }));
}

function resizeImage(file) {
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

async function addSlideImage(index, file, button) {
  if (!currentDraftId) {
    showToast("먼저 Create Post로 Draft를 만들어 주세요.", "error");
    return;
  }
  setBusy(button, true, "업로드 중...");
  try {
    const dataUrl = await resizeImage(file);
    const result = await uploadPostSlideImage(currentDraftId, index + 1, dataUrl);
    currentDeck[index][2] = result.imageUrl;
    syncDeck();
    await saveCurrentDraft(true);
    showToast(`${index + 1}번 슬라이드에 사진을 추가했습니다.`);
  } catch (error) {
    console.error(error);
    showToast(actionErrorMessage(error), "error");
  } finally {
    setBusy(button, false);
  }
}

function draftPayload() {
  return {
    title: $("#createTitle").value.trim() || "Untitled Find",
    category: postCategory(),
    status: $("#draftStatus").value,
    format: currentFormat,
    hook: $("#hookLine").value.trim(),
    caption: $("#captionText").textContent,
    editorNote: $("#editorialAngle").value.trim(),
    cards: draftCards()
  };
}

function scheduleDraftSave() {
  if (!currentDraftId || currentDeck.length !== 7) return;
  clearTimeout(draftAutoSaveTimer);
  $("#draftSaveStatus").textContent = "변경됨";
  draftAutoSaveTimer = setTimeout(() => saveCurrentDraft(true), 900);
}

async function saveCurrentDraft(silent = false) {
  const button = $("#saveDraft");
  if (!currentDraftId) {
    if (!silent) showToast("먼저 Create Post로 새 Draft를 만들어 주세요.", "error");
    return;
  }
  if (!silent) setBusy(button, true, "저장 중...");
  $("#draftSaveStatus").textContent = "저장 중...";
  try {
    await updatePostDraft(currentDraftId, draftPayload());
    $("#draftSaveStatus").textContent = `저장됨 · ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
    if (!silent) {
      showToast("Draft를 저장했습니다.");
      await renderDrafts();
    }
  } catch (error) {
    console.error(error);
    $("#draftSaveStatus").textContent = "저장 실패";
    if (!silent) showToast(actionErrorMessage(error), "error");
  } finally {
    if (!silent) setBusy(button, false);
  }
}

function renderDraftRows(drafts) {
  const target = $("#draftList");
  if (!drafts.length) {
    target.innerHTML = '<div class="empty">저장된 Draft가 없습니다. Create Post로 첫 초안을 만드세요.</div>';
    return;
  }
  target.innerHTML = drafts.map((draft) => `<article class="draft-row ${draft.id === currentDraftId ? "active" : ""}">
    <div><p class="draft-title">${safeText(draft.title || "Untitled Find")}</p><p class="archive-meta">${safeText(draft.format || "Check-in")} · ${safeText(draft.status || "Draft")} · ${formatDateTime(draft.updated_at)}</p></div>
    <div class="archive-actions"><button class="mini-btn" data-open-draft="${safeText(draft.id)}" type="button">열기</button><button class="mini-btn danger" data-delete-draft="${safeText(draft.id)}" type="button">삭제</button></div>
  </article>`).join("");
}

async function renderDrafts() {
  const target = $("#draftList");
  if (!target) return;
  try {
    renderDraftRows(await loadPostDrafts());
  } catch (error) {
    target.innerHTML = `<div class="empty">Draft를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  }
}

async function openDraft(id) {
  try {
    const draft = await fetchPostDraft(id);
    currentDraftId = draft.id;
    currentPostCategory = draft.category || "";
    currentDeck = [...(draft.post_slides || [])]
      .sort((a, b) => Number(a.slide_index) - Number(b.slide_index))
      .map((slide) => [slide.title || slide.slide_type, slide.body || "", slide.image_url || ""]);
    $("#createTitle").value = draft.title || "";
    $("#editorialAngle").value = draft.editor_note || "";
    $("#hookLine").value = draft.hook || currentDeck[0]?.[1] || "";
    $("#draftStatus").value = draft.status || "Draft";
    $("#captionText").textContent = draft.caption || "";
    currentFormat = draft.format || "Check-in";
    $$("#formatPills .pill").forEach((pill) => pill.classList.toggle("active", pill.dataset.format === currentFormat));
    $("#previewFormat").textContent = currentFormat;
    $("#previewTitle").textContent = draft.title || "dig.everyday";
    $("#previewHook").textContent = draft.hook || currentDeck[0]?.[1] || "";
    $("#draftSaveStatus").textContent = "저장된 Draft";
    syncDeck();
    renderDrafts();
  } catch (error) {
    showToast(actionErrorMessage(error), "error");
  }
}

async function removeDraft(id) {
  if (!window.confirm("이 Draft를 삭제할까요?")) return;
  try {
    await deletePostDraft(id);
    if (currentDraftId === id) {
      currentDraftId = null;
      $("#draftSaveStatus").textContent = "새 Draft";
    }
    showToast("Draft를 삭제했습니다.");
    await renderDrafts();
  } catch (error) {
    showToast(actionErrorMessage(error), "error");
  }
}

async function renderKevinArchive() {
  const target = $("#kevinArchiveList");
  if (!target) return;
  target.innerHTML = '<div class="empty">Kevin Archive를 불러오는 중...</div>';
  try {
    currentKevinFinds = await loadKevinFinds($("#kevinSearch").value.trim(), $("#kevinFilter").value);
    if (!currentKevinFinds.length) {
      target.innerHTML = '<div class="empty">조건에 맞는 Kevin Found가 없습니다.</div>';
      return;
    }
    target.innerHTML = currentKevinFinds.map((item) => `<article class="kevin-find-row">
      <div><div class="badge-row"><span class="status-badge saved">${safeText(item.category || "Find")}</span>${item.rating ? `<span class="status-badge muted">★ ${Number(item.rating)}</span>` : ""}</div><p class="draft-title">${safeText(item.name)}</p><p class="archive-meta">${safeText(item.location || "위치 없음")} · ${safeText(item.visited_at || "날짜 없음")}</p><p class="kevin-note">${safeText(item.why_saved || item.notes || "")}</p></div>
      <div class="archive-actions"><button class="mini-btn" data-edit-kevin="${safeText(item.id)}" type="button">수정</button><button class="mini-btn danger" data-delete-kevin="${safeText(item.id)}" type="button">삭제</button></div>
    </article>`).join("");
  } catch (error) {
    target.innerHTML = `<div class="empty">Kevin Archive를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
  }
}

function editKevinFind(id) {
  const item = currentKevinFinds.find((find) => find.id === id);
  if (!item) return;
  $("#kevinEditingId").value = item.id;
  $("#kevinName").value = item.name || "";
  $("#kevinCategory").value = item.category || "Object";
  $("#kevinLocation").value = item.location || "";
  $("#kevinVisitedAt").value = item.visited_at || "";
  $("#kevinRating").value = item.rating || "";
  $("#kevinWhySaved").value = item.why_saved || item.notes || "";
  $("#saveKevinFind").textContent = "수정 저장";
  $("#cancelKevinEdit").hidden = false;
  $("#kevinName").focus();
}

async function removeKevinFind(id) {
  if (!window.confirm("이 Kevin Found를 삭제할까요?")) return;
  try {
    await deleteKevinFind(id);
    showToast("Kevin Archive에서 삭제했습니다.");
    await renderKevinArchive();
  } catch (error) {
    showToast(actionErrorMessage(error), "error");
  }
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

async function drawSlidePng(card, index) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  const isCover = index === 0;

  if (isCover) {
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
    context.fillText(`${topic()}  ·  ${postCategory()}`.toUpperCase(), 86, 1010);
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

async function downloadPngPack() {
  if (currentDeck.length !== 7) {
    showToast("먼저 7장 Draft를 생성해 주세요.", "error");
    return;
  }
  const button = $("#downloadPngPack");
  setBusy(button, true, "렌더링 중...");
  try {
    const slug = (topic() || "dig-everyday").toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "");
    for (let index = 0; index < currentDeck.length; index += 1) {
      const canvas = await drawSlidePng(currentDeck[index], index);
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug || "dig-everyday"}-${String(index + 1).padStart(2, "0")}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    $("#exportStatus").textContent = "1080×1350 PNG 7장을 다운로드했습니다.";
    showToast("PNG 7장을 준비했습니다.");
  } catch (error) {
    $("#exportStatus").textContent = `PNG 생성 실패: ${error.message}`;
    showToast("PNG 생성에 실패했습니다.", "error");
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  $$(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $$('[data-jump]').forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.jump)));
  $("#generateResearch").addEventListener("click", generateResearch);
  $("#saveInboxItem")?.addEventListener("click", saveInboxClue);
  $("#refreshInbox")?.addEventListener("click", renderInbox);
  $("#inboxList")?.addEventListener("click", async (event) => {
    const generate = event.target.closest("[data-generate-inbox-ideas]");
    const status = event.target.closest("[data-inbox-idea-status]");
    const research = event.target.closest("[data-research-inbox-idea]");
    if (generate) await makeInboxIdeas(generate.dataset.generateInboxIdeas, generate);
    if (status) await setInboxIdeaStatus(status.dataset.inboxIdeaStatus, status.dataset.status, status);
    if (research) await developInboxIdea(research.dataset.researchInboxIdea, research);
  });
  $("#saveResearch").addEventListener("click", saveResearch);
  $("#saveKevinFind")?.addEventListener("click", saveKevinFind);
  $("#cancelKevinEdit")?.addEventListener("click", resetKevinForm);
  $("#kevinSearch")?.addEventListener("input", () => {
    clearTimeout(window.kevinSearchTimer);
    window.kevinSearchTimer = setTimeout(renderKevinArchive, 250);
  });
  $("#kevinFilter")?.addEventListener("change", renderKevinArchive);
  $("#kevinArchiveList")?.addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-kevin]");
    const del = event.target.closest("[data-delete-kevin]");
    if (edit) editKevinFind(edit.dataset.editKevin);
    if (del) await removeKevinFind(del.dataset.deleteKevin);
  });
  $("#importRss")?.addEventListener("click", importRss);
  $("#saveSource")?.addEventListener("click", saveAutomaticSource);
  $("#runAllSources")?.addEventListener("click", collectAllSourcesNow);
  $("#refreshRuns")?.addEventListener("click", renderCollectionRuns);
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
  $("#todayCandidates")?.addEventListener("input", (event) => {
    const field = event.target.closest("[data-why-note]");
    if (field) scheduleWhyNoteSave(field);
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
  $("#archiveList").addEventListener("input", (event) => {
    const field = event.target.closest("[data-why-note]");
    if (field) scheduleWhyNoteSave(field);
  });
  $("#deckEditor").addEventListener("input", (event) => {
    const titleField = event.target.closest("[data-card-title]");
    const copyField = event.target.closest("[data-card-copy]");
    const imageField = event.target.closest("[data-card-image]");
    const field = titleField || copyField || imageField;
    if (!field) return;
    const index = Number(field.dataset.cardTitle ?? field.dataset.cardCopy ?? field.dataset.cardImage);
    if (!currentDeck[index]) return;
    if (titleField) currentDeck[index][0] = field.value;
    if (copyField) currentDeck[index][1] = field.value;
    if (imageField) currentDeck[index][2] = isWebUrl(field.value) ? field.value.trim() : "";
    renderDeckList(currentDeck);
    renderPreviewDeck(currentDeck, currentFormat, topic(), postCategory());
    scheduleDraftSave();
  });
  $("#deckEditor").addEventListener("change", async (event) => {
    const fileInput = event.target.closest("[data-card-file]");
    if (!fileInput?.files?.[0]) return;
    const index = Number(fileInput.dataset.cardFile);
    const button = fileInput.closest(".editor-image-actions")?.querySelector(".editor-upload-btn");
    await addSlideImage(index, fileInput.files[0], button);
    fileInput.value = "";
  });
  $("#deckEditor").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-card-image]");
    if (!remove) return;
    const index = Number(remove.dataset.removeCardImage);
    currentDeck[index][2] = "";
    syncDeck();
    scheduleDraftSave();
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
    renderPreviewDeck(currentDeck, currentFormat, topic(), postCategory());
    scheduleDraftSave();
  });
  $("#generateDeck").addEventListener("click", buildDeck);
  $("#saveDraft")?.addEventListener("click", () => saveCurrentDraft(false));
  $("#refreshDrafts")?.addEventListener("click", renderDrafts);
  $("#draftList")?.addEventListener("click", async (event) => {
    const open = event.target.closest("[data-open-draft]");
    const del = event.target.closest("[data-delete-draft]");
    if (open) await openDraft(open.dataset.openDraft);
    if (del) await removeDraft(del.dataset.deleteDraft);
  });
  ["createTitle", "whyILikeThis", "editorialAngle", "hookLine"].forEach((id) => $("#" + id)?.addEventListener("input", () => {
    if (id === "whyILikeThis" && currentBrief) currentBrief.whyILikeThis = $("#whyILikeThis").value.trim();
    $("#previewTitle").textContent = $("#createTitle").value.trim() || "dig.everyday";
    $("#previewHook").textContent = $("#hookLine").value.trim() || currentDeck[0]?.[1] || "";
    renderPreviewDeck(currentDeck, currentFormat, topic(), postCategory());
    scheduleDraftSave();
  }));
  $("#draftStatus")?.addEventListener("change", scheduleDraftSave);
  $("#downloadPngPack")?.addEventListener("click", downloadPngPack);
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
renderCollectionRuns();
renderInbox();
renderKevinArchive();
renderArchive();
renderDrafts();
buildFallbackDeck();
