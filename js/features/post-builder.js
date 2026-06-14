import {
  createDeck,
  deletePostDraft,
  fetchPostDraft,
  insertPostDraft,
  loadPostDrafts,
  updatePostDraft,
  updateWhyNote,
  uploadPostSlideImage
} from "../api.js";
import { actionErrorMessage, formatDateTime } from "../common.js";
import { downloadDeckPngPack, resizeImage } from "../images.js";
import {
  $,
  $$,
  isWebUrl,
  makeDefaultHook,
  renderBrief,
  renderCaption,
  renderDeck,
  renderDeckList,
  renderPreviewDeck,
  safeText,
  setBusy,
  showToast
} from "../render.js";

export function createPostBuilderFeature() {
  let format = "Check-in";
  let brief = null;
  let postCategoryValue = "";
  let deck = [];
  let curationItemId = null;
  let sourceType = "daily_find";
  let draftId = null;
  let autoSaveTimer = null;

  function showBrief(nextBrief) {
    brief = nextBrief;
    postCategoryValue = nextBrief.category || "";
    curationItemId = nextBrief.curationItemId || null;
    sourceType = nextBrief.itemType || sourceType || "daily_find";
    renderBrief(nextBrief);
  }

  function getBrief() {
    return brief;
  }

  function updateBriefWhy(value) {
    if (brief) brief.whyILikeThis = value;
    if ($("#whyILikeThis")) $("#whyILikeThis").value = value;
  }

  function markResearchSaved(id) {
    curationItemId = id || curationItemId;
    sourceType = "daily_find";
    if (brief && id) brief.curationItemId = id;
  }

  function topic() {
    return $("#createTitle").value.trim() || brief?.name || "dig.everyday";
  }

  function postCategory() {
    return postCategoryValue || brief?.category || $("#category")?.value || format;
  }

  function syncDeck() {
    renderDeck(deck, format, topic(), postCategory());
  }

  function clearDeck() {
    deck = [];
  }

  function applyResearchResult(result) {
    if (Array.isArray(result.cards) && result.cards.length) {
      deck = result.cards.map((card) => [card.title, card.copy]);
      syncDeck();
    }
    if (result.caption) $("#captionText").textContent = result.caption;
  }

  function buildFallbackDeck() {
    const title = $("#createTitle").value.trim() || "Untitled Space";
    const angle = $("#editorialAngle").value.trim() || "이 공간은 방문보다 태도를 먼저 보여준다.";
    const hook = $("#hookLine").value.trim() || makeDefaultHook(title);
    deck = [
      ["Cover", hook],
      ["Introduction", "무엇인지 설명한다. 이름, 위치, 맥락, 발견한 경로를 짧게 정리한다."],
      ["Why It Matters", angle],
      ["Detail 1", "좋게 느껴지는 첫 번째 이유를 쓴다. 재료, 형태, 운영 방식, 태도 중 하나를 고른다."],
      ["Detail 2", "시각적으로 저장할 만한 지점을 쓴다. 이미지 힘과 기억되는 장면을 중심으로 본다."],
      ["Editor's Note", "Kevin의 취향과 연결되는 지점을 건조하게 남긴다."],
      ["CTA", "오늘의 좋은 발견으로 저장할 이유를 한 문장으로 남긴다."]
    ];
    $("#previewFormat").textContent = format;
    $("#previewTitle").textContent = title;
    $("#previewHook").textContent = hook;
    syncDeck();
    renderCaption(title, angle, hook);
  }

  async function buildDeck() {
    const button = $("#generateDeck");
    const title = $("#createTitle").value.trim() || "Untitled Space";
    const angle = $("#editorialAngle").value.trim() || "";
    const whyILikeThis = $("#whyILikeThis")?.value.trim() || brief?.whyILikeThis || "";
    const hook = $("#hookLine").value.trim() || makeDefaultHook(title);
    if (!whyILikeThis && !window.confirm("Why I Like This 메모가 없습니다. 원문 요약 중심의 초안이 될 수 있습니다. 그래도 생성할까요?")) return;
    $("#previewTitle").textContent = title;
    $("#previewHook").textContent = hook;
    $("#captionText").textContent = "카드 초안을 생성하는 중입니다...";
    setBusy(button, true, "생성 중...");
    try {
      if (curationItemId && whyILikeThis) {
        await updateWhyNote(curationItemId, whyILikeThis, brief?.kevinAngle || "");
      }
      const result = await createDeck({
        curationItemId,
        title,
        angle,
        whyILikeThis,
        kevinAngle: brief?.kevinAngle || "",
        hook,
        format,
        notes: brief?.notes || $("#researchNotes").value.trim() || ""
      });
      if (brief && result.kevinAngle) brief.kevinAngle = result.kevinAngle;
      applyResearchResult(result);
      try {
        const savedDraft = await insertPostDraft({
          curationItemId,
          title,
          category: postCategory(),
          sourceType: sourceType || "daily_find",
          cards: result.cards,
          caption: result.caption || "",
          hashtags: result.hashtags || [],
          creditNote: result.creditNote || "",
          sourceNote: result.sourceNote || "",
          imageCredit: brief?.imageCredit || "",
          imageUsageStatus: brief?.imageUsageStatus || "unknown",
          editorNote: angle,
          format,
          hook
        });
        draftId = savedDraft?.draft?.id || null;
        $("#draftStatus").value = savedDraft?.draft?.status || "Draft";
        $("#draftSaveStatus").textContent = draftId ? "저장됨" : "새 Draft";
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

  function draftCards() {
    return deck.map(([title, copy, imageUrl]) => ({ title, copy, imageUrl: imageUrl || "" }));
  }

  function draftPayload() {
    return {
      title: $("#createTitle").value.trim() || "Untitled Find",
      category: postCategory(),
      status: $("#draftStatus").value,
      format,
      hook: $("#hookLine").value.trim(),
      caption: $("#captionText").textContent,
      editorNote: $("#editorialAngle").value.trim(),
      cards: draftCards()
    };
  }

  function scheduleDraftSave() {
    if (!draftId || deck.length !== 7) return;
    clearTimeout(autoSaveTimer);
    $("#draftSaveStatus").textContent = "변경됨";
    autoSaveTimer = setTimeout(() => saveCurrentDraft(true), 900);
  }

  async function saveCurrentDraft(silent = false) {
    const button = $("#saveDraft");
    if (!draftId) {
      if (!silent) showToast("먼저 Create Post로 새 Draft를 만들어 주세요.", "error");
      return;
    }
    if (!silent) setBusy(button, true, "저장 중...");
    $("#draftSaveStatus").textContent = "저장 중...";
    try {
      await updatePostDraft(draftId, draftPayload());
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

  async function addSlideImage(index, file, button) {
    if (!draftId) {
      showToast("먼저 Create Post로 Draft를 만들어 주세요.", "error");
      return;
    }
    setBusy(button, true, "업로드 중...");
    try {
      const dataUrl = await resizeImage(file);
      const result = await uploadPostSlideImage(draftId, index + 1, dataUrl);
      deck[index][2] = result.imageUrl;
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

  function renderDraftRows(drafts) {
    const target = $("#draftList");
    if (!drafts.length) {
      target.innerHTML = '<div class="empty">저장된 Draft가 없습니다. Create Post로 첫 초안을 만드세요.</div>';
      return;
    }
    target.innerHTML = drafts.map((draft) => `<article class="draft-row ${draft.id === draftId ? "active" : ""}">
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
      draftId = draft.id;
      postCategoryValue = draft.category || "";
      deck = [...(draft.post_slides || [])]
        .sort((a, b) => Number(a.slide_index) - Number(b.slide_index))
        .map((slide) => [slide.title || slide.slide_type, slide.body || "", slide.image_url || ""]);
      $("#createTitle").value = draft.title || "";
      $("#editorialAngle").value = draft.editor_note || "";
      $("#hookLine").value = draft.hook || deck[0]?.[1] || "";
      $("#draftStatus").value = draft.status || "Draft";
      $("#captionText").textContent = draft.caption || "";
      format = draft.format || "Check-in";
      $$("#formatPills .pill").forEach((pill) => pill.classList.toggle("active", pill.dataset.format === format));
      $("#previewFormat").textContent = format;
      $("#previewTitle").textContent = draft.title || "dig.everyday";
      $("#previewHook").textContent = draft.hook || deck[0]?.[1] || "";
      $("#draftSaveStatus").textContent = "저장된 Draft";
      syncDeck();
      await renderDrafts();
    } catch (error) {
      showToast(actionErrorMessage(error), "error");
    }
  }

  async function removeDraft(id) {
    if (!window.confirm("이 Draft를 삭제할까요?")) return;
    try {
      await deletePostDraft(id);
      if (draftId === id) {
        draftId = null;
        $("#draftSaveStatus").textContent = "새 Draft";
      }
      showToast("Draft를 삭제했습니다.");
      await renderDrafts();
    } catch (error) {
      showToast(actionErrorMessage(error), "error");
    }
  }

  async function downloadPngPack() {
    if (deck.length !== 7) {
      showToast("먼저 7장 Draft를 생성해 주세요.", "error");
      return;
    }
    const button = $("#downloadPngPack");
    setBusy(button, true, "렌더링 중...");
    try {
      await downloadDeckPngPack(deck, topic(), postCategory());
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
    $("#deckEditor")?.addEventListener("input", (event) => {
      const titleField = event.target.closest("[data-card-title]");
      const copyField = event.target.closest("[data-card-copy]");
      const imageField = event.target.closest("[data-card-image]");
      const field = titleField || copyField || imageField;
      if (!field) return;
      const index = Number(field.dataset.cardTitle ?? field.dataset.cardCopy ?? field.dataset.cardImage);
      if (!deck[index]) return;
      if (titleField) deck[index][0] = field.value;
      if (copyField) deck[index][1] = field.value;
      if (imageField) deck[index][2] = isWebUrl(field.value) ? field.value.trim() : "";
      renderDeckList(deck);
      renderPreviewDeck(deck, format, topic(), postCategory());
      scheduleDraftSave();
    });
    $("#deckEditor")?.addEventListener("change", async (event) => {
      const fileInput = event.target.closest("[data-card-file]");
      if (!fileInput?.files?.[0]) return;
      const index = Number(fileInput.dataset.cardFile);
      const button = fileInput.closest(".editor-image-actions")?.querySelector(".editor-upload-btn");
      await addSlideImage(index, fileInput.files[0], button);
      fileInput.value = "";
    });
    $("#deckEditor")?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-card-image]");
      if (!remove) return;
      const index = Number(remove.dataset.removeCardImage);
      deck[index][2] = "";
      syncDeck();
      scheduleDraftSave();
    });
    $("#previewDeck")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-copy-card]");
      if (!button) return;
      const card = deck[Number(button.dataset.copyCard)];
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
    $("#formatPills")?.addEventListener("click", (event) => {
      const pill = event.target.closest(".pill");
      if (!pill) return;
      format = pill.dataset.format;
      $$("#formatPills .pill").forEach((item) => item.classList.remove("active"));
      pill.classList.add("active");
      $("#previewFormat").textContent = format;
      renderPreviewDeck(deck, format, topic(), postCategory());
      scheduleDraftSave();
    });
    $("#generateDeck")?.addEventListener("click", buildDeck);
    $("#saveDraft")?.addEventListener("click", () => saveCurrentDraft(false));
    $("#refreshDrafts")?.addEventListener("click", renderDrafts);
    $("#draftList")?.addEventListener("click", async (event) => {
      const open = event.target.closest("[data-open-draft]");
      const remove = event.target.closest("[data-delete-draft]");
      if (open) await openDraft(open.dataset.openDraft);
      if (remove) await removeDraft(remove.dataset.deleteDraft);
    });
    ["createTitle", "whyILikeThis", "editorialAngle", "hookLine"].forEach((id) => {
      $("#" + id)?.addEventListener("input", () => {
        if (id === "whyILikeThis") updateBriefWhy($("#whyILikeThis").value.trim());
        $("#previewTitle").textContent = $("#createTitle").value.trim() || "dig.everyday";
        $("#previewHook").textContent = $("#hookLine").value.trim() || deck[0]?.[1] || "";
        renderPreviewDeck(deck, format, topic(), postCategory());
        scheduleDraftSave();
      });
    });
    $("#draftStatus")?.addEventListener("change", scheduleDraftSave);
    $("#downloadPngPack")?.addEventListener("click", downloadPngPack);
    $("#copyCaption")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("#captionText").textContent);
        $("#exportStatus").textContent = "캡션을 클립보드에 복사했습니다.";
      } catch {
        $("#exportStatus").textContent = "브라우저 권한 때문에 복사하지 못했습니다.";
      }
    });
  }

  return {
    applyResearchResult,
    bindEvents,
    buildDeck,
    buildFallbackDeck,
    clearDeck,
    getBrief,
    markResearchSaved,
    renderDrafts,
    showBrief,
    updateBriefWhy
  };
}
