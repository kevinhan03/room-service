import {
  deleteArchiveItem,
  fetchArchiveItem,
  loadArchive,
  updateCurationStatus
} from "../api.js";
import { actionErrorMessage } from "../common.js";
import {
  $,
  prependArchiveMessage,
  renderArchiveItems,
  renderArchiveMessage,
  setBusy,
  showToast
} from "../render.js";

export function createBoardFeature({
  renderToday,
  scheduleWhyNoteSave,
  showBrief,
  switchTab
}) {
  async function render() {
    const list = $("#archiveList");
    const scrollY = window.scrollY;
    if (list && !list.children.length) renderArchiveMessage("Board를 불러오는 중...");
    try {
      renderArchiveItems(await loadArchive() || []);
    } catch (error) {
      console.error(error);
      renderArchiveMessage("Board를 불러오지 못했습니다. Supabase 테이블과 RLS 정책을 확인하세요.");
    } finally {
      window.scrollTo(0, scrollY);
    }
  }

  async function use(id) {
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
      if ($("#referenceUrls")) {
        $("#referenceUrls").value = (brief.referenceUrls || [])
          .filter((url) => url !== brief.sourceUrl)
          .join("\n");
      }
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

  async function remove(id) {
    try {
      await deleteArchiveItem(id);
      await render();
    } catch (error) {
      console.error(error);
      prependArchiveMessage("Board 항목을 삭제하지 못했습니다. Supabase 권한을 확인하세요.");
    }
  }

  async function setStatus(id, status, button) {
    setBusy(button, true, "저장 중...");
    try {
      await updateCurationStatus(id, status);
      showToast(`${status}로 변경했습니다.`);
      await Promise.all([renderToday(), render()]);
    } catch (error) {
      console.error(error);
      showToast(actionErrorMessage(error), "error");
      setBusy(button, false);
    }
  }

  function bindEvents() {
    $("#archiveList")?.addEventListener("click", async (event) => {
      const useButton = event.target.closest("[data-use]");
      const deleteButton = event.target.closest("[data-delete]");
      const statusButton = event.target.closest("[data-status]");
      if (useButton) await use(useButton.dataset.use);
      if (deleteButton) await remove(deleteButton.dataset.delete);
      if (statusButton) await setStatus(statusButton.dataset.status, statusButton.dataset.value, statusButton);
    });
    $("#archiveList")?.addEventListener("input", (event) => {
      const field = event.target.closest("[data-why-note]");
      if (field) scheduleWhyNoteSave(field);
    });
  }

  return { bindEvents, render, use };
}
