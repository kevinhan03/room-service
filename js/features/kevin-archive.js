import {
  deleteKevinFind,
  insertKevinFind,
  loadKevinFinds,
  updateKevinFind
} from "../api.js";
import { actionErrorMessage } from "../common.js";
import { $, safeText, setBusy, showToast } from "../render.js";

export function createKevinArchiveFeature({ renderArchive, showBrief }) {
  let items = [];
  let searchTimer = null;

  function resetForm() {
    $("#kevinEditingId").value = "";
    $("#kevinName").value = "";
    $("#kevinLocation").value = "";
    $("#kevinVisitedAt").value = "";
    $("#kevinRating").value = "";
    $("#kevinWhySaved").value = "";
    $("#saveKevinFind").textContent = "새 항목 저장";
    $("#cancelKevinEdit").hidden = true;
  }

  async function save() {
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
      const payload = {
        name,
        category,
        location,
        visitedAt,
        rating,
        whySaved,
        notes: whySaved,
        imageUsageStatus: "owned"
      };
      if (id) {
        await updateKevinFind(id, payload);
        $("#kevinStatus").textContent = "Kevin Archive 항목을 수정했습니다.";
      } else {
        const saved = await insertKevinFind(payload);
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
      resetForm();
      await Promise.all([render(), renderArchive()]);
    } catch (error) {
      console.error(error);
      $("#kevinStatus").textContent = `저장에 실패했습니다. ${error.message}`;
    } finally {
      setBusy(button, false);
    }
  }

  async function render() {
    const target = $("#kevinArchiveList");
    if (!target) return;
    target.innerHTML = '<div class="empty">Kevin Archive를 불러오는 중...</div>';
    try {
      items = await loadKevinFinds($("#kevinSearch").value.trim(), $("#kevinFilter").value);
      if (!items.length) {
        target.innerHTML = '<div class="empty">조건에 맞는 Kevin Found가 없습니다.</div>';
        return;
      }
      target.innerHTML = items.map((item) => `<article class="kevin-find-row">
        <div><div class="badge-row"><span class="status-badge saved">${safeText(item.category || "Find")}</span>${item.rating ? `<span class="status-badge muted">★ ${Number(item.rating)}</span>` : ""}</div><p class="draft-title">${safeText(item.name)}</p><p class="archive-meta">${safeText(item.location || "위치 없음")} · ${safeText(item.visited_at || "날짜 없음")}</p><p class="kevin-note">${safeText(item.why_saved || item.notes || "")}</p></div>
        <div class="archive-actions"><button class="mini-btn" data-edit-kevin="${safeText(item.id)}" type="button">수정</button><button class="mini-btn danger" data-delete-kevin="${safeText(item.id)}" type="button">삭제</button></div>
      </article>`).join("");
    } catch (error) {
      target.innerHTML = `<div class="empty">Kevin Archive를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
    }
  }

  function edit(id) {
    const item = items.find((entry) => entry.id === id);
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

  async function remove(id) {
    if (!window.confirm("이 Kevin Found를 삭제할까요?")) return;
    try {
      await deleteKevinFind(id);
      showToast("Kevin Archive에서 삭제했습니다.");
      await render();
    } catch (error) {
      showToast(actionErrorMessage(error), "error");
    }
  }

  function bindEvents() {
    $("#saveKevinFind")?.addEventListener("click", save);
    $("#cancelKevinEdit")?.addEventListener("click", resetForm);
    $("#kevinSearch")?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(render, 250);
    });
    $("#kevinFilter")?.addEventListener("change", render);
    $("#kevinArchiveList")?.addEventListener("click", async (event) => {
      const editButton = event.target.closest("[data-edit-kevin]");
      const deleteButton = event.target.closest("[data-delete-kevin]");
      if (editButton) edit(editButton.dataset.editKevin);
      if (deleteButton) await remove(deleteButton.dataset.deleteKevin);
    });
  }

  return { bindEvents, render };
}
