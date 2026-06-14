import {
  createInboxItem,
  generateInboxIdeas,
  insertArchiveItem,
  loadInboxItems,
  researchInboxIdea,
  updateInboxIdea
} from "../api.js";
import { actionErrorMessage, formatDateTime, parseReferenceUrls } from "../common.js";
import { $, safeText, setBusy, showToast } from "../render.js";

export function createInboxFeature({
  buildDeck,
  clearDeck,
  renderArchive,
  renderDrafts,
  renderFactsAndSources,
  showBrief,
  switchTab
}) {
  function renderRows(items) {
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
      const links = (item.reference_urls || [])
        .map((url, index) => `<a class="mini-btn" href="${safeText(url)}" target="_blank" rel="noreferrer">참고 ${index + 1}</a>`)
        .join("");
      return `<article class="inbox-item">
        <div class="inbox-item-head"><div><p class="archive-meta">${safeText(item.status || "new")} · ${formatDateTime(item.created_at)}</p><p class="inbox-seed">${safeText(item.seed_text)}</p></div><div class="inline">${links}</div></div>
        ${ideaRows}
      </article>`;
    }).join("");
  }

  async function render() {
    const target = $("#inboxList");
    if (!target) return;
    target.innerHTML = '<div class="empty">Inbox를 불러오는 중...</div>';
    try {
      renderRows(await loadInboxItems());
    } catch (error) {
      target.innerHTML = `<div class="empty">Inbox를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
    }
  }

  async function saveClue() {
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
      await render();
    } catch (error) {
      $("#inboxStatus").textContent = actionErrorMessage(error);
    } finally {
      setBusy(button, false);
    }
  }

  async function makeIdeas(id, button) {
    setBusy(button, true, "찾는 중...");
    $("#inboxStatus").textContent = "Perplexity가 관련 자료를 찾고 게시 아이디어 3개를 만드는 중...";
    try {
      await generateInboxIdeas(id);
      $("#inboxStatus").textContent = "게시 가능한 아이디어 3개를 만들었습니다.";
      await render();
    } catch (error) {
      $("#inboxStatus").textContent = actionErrorMessage(error);
    } finally {
      setBusy(button, false);
    }
  }

  async function setIdeaStatus(id, status, button) {
    setBusy(button, true, "저장 중...");
    try {
      await updateInboxIdea(id, status);
      await render();
    } catch (error) {
      showToast(actionErrorMessage(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function developIdea(id, button) {
    setBusy(button, true, "심층 조사 중...");
    $("#inboxStatus").textContent = "공식 출처와 참고 자료를 심층 조사하고 있습니다...";
    try {
      const result = await researchInboxIdea(id);
      const saved = await insertArchiveItem(result.brief);
      await updateInboxIdea(id, "researched", saved.id);
      showBrief({ ...result.brief, curationItemId: saved.id, itemType: "daily_find" });
      renderFactsAndSources(result);
      clearDeck();
      switchTab("builder");
      await buildDeck();
      showToast("상세 조사 결과로 새 Draft를 만들었습니다.");
      await Promise.all([render(), renderArchive(), renderDrafts()]);
    } catch (error) {
      console.error(error);
      $("#inboxStatus").textContent = actionErrorMessage(error);
      showToast(actionErrorMessage(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  function bindEvents() {
    $("#saveInboxItem")?.addEventListener("click", saveClue);
    $("#refreshInbox")?.addEventListener("click", render);
    $("#inboxList")?.addEventListener("click", async (event) => {
      const generate = event.target.closest("[data-generate-inbox-ideas]");
      const status = event.target.closest("[data-inbox-idea-status]");
      const research = event.target.closest("[data-research-inbox-idea]");
      if (generate) await makeIdeas(generate.dataset.generateInboxIdeas, generate);
      if (status) await setIdeaStatus(status.dataset.inboxIdeaStatus, status.dataset.status, status);
      if (research) await developIdea(research.dataset.researchInboxIdea, research);
    });
  }

  return { bindEvents, render };
}
