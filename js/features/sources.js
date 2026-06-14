import {
  createSource,
  deleteSource,
  finalizeCollectionRun,
  importRssFeed,
  loadCollectionRuns,
  loadSources,
  runAllSources,
  runSource,
  updateSource
} from "../api.js";
import { formatDateTime, isSourceCompatibilityError, showSourceWarning } from "../common.js";
import { $, safeText, setBusy } from "../render.js";

export function createSourcesFeature({ renderArchive, renderToday }) {
  function renderItems(sources, collection) {
    const target = $("#sourceList");
    if (!target) return;
    if (!sources?.length) {
      target.innerHTML = `<div class="empty">저장된 수집 소스가 없습니다.</div>`;
      return;
    }
    target.innerHTML = sources.map((source) => `<article class="archive-item"><div class="archive-top"><div><div class="badge-row"><span class="status-badge muted">${safeText(source.source_type || "Magazine")}</span><span class="status-badge ${source.is_active ? "saved" : "rejected"}">${source.is_active ? "수집 대상" : "제외됨"}</span></div><p class="archive-title">${safeText(source.name)}</p><p class="archive-meta">${safeText(source.type || "url").toUpperCase()} / 마지막 수집 ${safeText(source.last_fetched_at ? new Date(source.last_fetched_at).toLocaleString("ko-KR") : "없음")}</p></div><div class="archive-actions"><button class="mini-btn" data-run-source="${safeText(source.id)}" type="button">지금 수집</button><button class="mini-btn" data-toggle-source="${safeText(source.id)}" data-active="${source.is_active}" type="button">${source.is_active ? "전체 수집에서 제외" : "전체 수집에 포함"}</button><button class="mini-btn" data-delete-source="${safeText(source.id)}" type="button">삭제</button></div></div><p class="small">${safeText(source.url)}</p></article>`).join("");
    if ($("#rssStatus") && collection) $("#rssStatus").textContent = `버튼 실행 시 소스당 최대 ${collection.limit}개를 수집합니다.`;
  }

  async function render() {
    try {
      const result = await loadSources();
      renderItems(result.sources || [], result.collection);
    } catch (error) {
      console.error(error);
      if ($("#sourceList")) $("#sourceList").innerHTML = `<div class="empty">Sources를 불러오지 못했습니다. ${safeText(error.message)}</div>`;
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
      await Promise.all([render(), renderToday(), renderArchive()]);
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
      await render();
    } catch (error) {
      console.error(error);
      $("#rssStatus").textContent = `소스 저장 실패: ${error.message}`;
      if (isSourceCompatibilityError(error)) showSourceWarning(error);
    } finally {
      setBusy(button, false);
    }
  }

  async function collectAll() {
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
      await Promise.all([render(), renderToday(), renderArchive()]);
      await renderRuns();
    } catch (error) {
      console.error(error);
      $("#rssStatus").textContent = `전체 수집 실패: ${error.message}`;
      if (isSourceCompatibilityError(error)) showSourceWarning(error);
    } finally {
      setBusy(button, false);
    }
  }

  async function renderRuns() {
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

  function bindEvents() {
    $("#importRss")?.addEventListener("click", importRss);
    $("#saveSource")?.addEventListener("click", saveAutomaticSource);
    $("#runAllSources")?.addEventListener("click", collectAll);
    $("#refreshRuns")?.addEventListener("click", renderRuns);
    $("#closeSourceWarning")?.addEventListener("click", () => $("#sourceWarningDialog")?.close());
    $("#sourceWarningDialog")?.addEventListener("click", (event) => {
      if (event.target === $("#sourceWarningDialog")) $("#sourceWarningDialog").close();
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
        await Promise.all([render(), renderToday(), renderArchive()]);
      } catch (error) {
        console.error(error);
        $("#rssStatus").textContent = error.message;
        if (isSourceCompatibilityError(error)) showSourceWarning(error);
      }
    });
  }

  return { bindEvents, render, renderRuns };
}
