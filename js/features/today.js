import { loadToday, updateBulkCurationDecision, updateCurationDecision, updateWhyNote } from "../api.js";
import { actionErrorMessage, displayableImageUrl } from "../common.js";
import { $, $$, isWebUrl, safeText, setBusy, showToast } from "../render.js";

export function createTodayFeature({ getCurrentBrief, updateCurrentBriefWhy, renderArchive, useArchive }) {
  let items = [];
  const selectedIds = new Set();
  const noteTimers = new Map();

  function humanBadge(item) {
    if (item.humanDecision === "post_today") return ["Approved", "approved"];
    if (item.humanDecision === "dig_more" || item.status === "Dig More Candidate") return ["Dig More", "dig-more"];
    if (item.humanDecision === "saved_candidate" || item.humanSaved) return ["Kevin Saved", "saved"];
    if (item.humanDecision === "rejected" || item.status === "Rejected") return ["Rejected", "rejected"];
    return ["AI Recommended", "ai"];
  }

  function renderBulkBar() {
    const count = selectedIds.size;
    if ($("#selectedCount")) $("#selectedCount").textContent = `${count}개 선택`;
    $$("[data-bulk-decision]").forEach((button) => {
      button.disabled = count === 0;
    });
  }

  function renderItems(nextItems) {
    const target = $("#todayCandidates");
    if (!target) return;
    items = nextItems || [];
    const visibleIds = new Set(items.map((item) => item.id));
    [...selectedIds].forEach((id) => {
      if (!visibleIds.has(id)) selectedIds.delete(id);
    });
    renderBulkBar();
    if (!items.length) {
      target.innerHTML = `<div class="empty">추천 가능한 후보가 없습니다. Sources에서 새 콘텐츠를 수집하거나 Candidate를 저장하세요.</div>`;
      return;
    }
    target.innerHTML = items.map((item) => {
      const [badgeLabel, badgeTone] = humanBadge(item);
      const checked = selectedIds.has(item.id);
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
    clearTimeout(noteTimers.get(id));
    noteTimers.set(id, setTimeout(async () => {
      if (status) status.textContent = "저장 중...";
      try {
        const result = await updateWhyNote(id, field.value.trim());
        const saved = result.item || {};
        const item = items.find((entry) => entry.id === id);
        if (item) {
          item.whyILikeThis = saved.whyILikeThis ?? field.value.trim();
          item.personalRelevanceScore = saved.personalRelevanceScore ?? item.personalRelevanceScore;
          item.whyNoteUpdatedAt = saved.whyNoteUpdatedAt || new Date().toISOString();
        }
        if (getCurrentBrief()?.curationItemId === id) updateCurrentBriefWhy(field.value.trim());
        if (status) status.textContent = "저장됨";
      } catch (error) {
        console.error(error);
        if (status) status.textContent = "저장 실패";
        showToast(actionErrorMessage(error), "error");
      } finally {
        noteTimers.delete(id);
      }
    }, 700));
  }

  async function render() {
    const target = $("#todayCandidates");
    const scrollY = window.scrollY;
    if (target && !items.length) target.innerHTML = `<div class="empty">오늘의 후보를 불러오는 중...</div>`;
    try {
      const result = await loadToday();
      renderItems(result.items || []);
      if ($("#todaySchedule")) $("#todaySchedule").textContent = "Sources에서 수집 버튼을 누르면 후보가 업데이트됩니다.";
    } catch (error) {
      console.error(error);
      if (target) target.innerHTML = `<div class="empty">Today 후보를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
    } finally {
      window.scrollTo(0, scrollY);
    }
  }

  async function applyDecision(id, decision, button) {
    const labels = {
      post_today: "Post Today",
      saved_candidate: "Save Candidate",
      dig_more: "Dig More",
      rejected: "Reject"
    };
    setBusy(button, true, decision === "dig_more" || decision === "post_today" ? "심층 조사 중..." : "저장 중...");
    try {
      const result = await updateCurationDecision(id, decision);
      selectedIds.delete(id);
      showToast(result.deepResearchWarning
        ? `${labels[decision]}은 저장했지만 심층 조사에 실패했습니다.`
        : `${labels[decision]} 처리를 완료했습니다.`);
      if (decision === "post_today") {
        await renderArchive();
        await useArchive(id);
        return;
      }
      await Promise.all([render(), renderArchive()]);
    } catch (error) {
      console.error(error);
      showToast(actionErrorMessage(error), "error");
      setBusy(button, false);
    }
  }

  async function applyBulkDecision(decision, button) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBusy(button, true, "처리 중...");
    try {
      const result = await updateBulkCurationDecision(ids, decision);
      setBusy(button, false);
      selectedIds.clear();
      showToast(`${result.updated ?? ids.length}개 후보를 업데이트했습니다.`);
      await Promise.all([render(), renderArchive()]);
    } catch (error) {
      console.error(error);
      showToast(actionErrorMessage(error), "error");
      setBusy(button, false);
    }
  }

  function bindEvents() {
    $("#todayCandidates")?.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-select-recommendation]");
      if (!checkbox) return;
      if (checkbox.checked) selectedIds.add(checkbox.dataset.selectRecommendation);
      else selectedIds.delete(checkbox.dataset.selectRecommendation);
      renderBulkBar();
    });
    $("#todayCandidates")?.addEventListener("input", (event) => {
      const field = event.target.closest("[data-why-note]");
      if (field) scheduleWhyNoteSave(field);
    });
    $("#todayCandidates")?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-decision]");
      if (action) await applyDecision(action.dataset.id, action.dataset.decision, action);
    });
    $("#bulkActionBar")?.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-bulk-decision]");
      if (action) await applyBulkDecision(action.dataset.bulkDecision, action);
    });
  }

  return { bindEvents, render, scheduleWhyNoteSave };
}
