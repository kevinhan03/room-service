export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => Array.from(document.querySelectorAll(selector));

export function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

export function isWebUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

export function slugFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "manual note";
  }
}

export function makeDefaultHook(name) {
  const target = name && name !== "Untitled Space" ? name : "그곳";
  return `${target}에 가는 게 아니다.\n${target}을 이해하러 간다.`;
}

export function setBusy(element, busy, label) {
  if (!element) return;
  if (busy) {
    element.dataset.idleText = element.textContent;
    element.textContent = label || element.textContent;
    element.disabled = true;
    element.setAttribute("aria-busy", "true");
  } else {
    element.textContent = element.dataset.idleText || element.textContent;
    element.disabled = false;
    element.removeAttribute("aria-busy");
    delete element.dataset.idleText;
  }
}

let toastTimer;

export function showToast(message, tone = "success") {
  const toast = $("#actionToast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), tone === "error" ? 5200 : 2800);
}

export function renderBrief(brief) {
  const analysisCards = [
    ["One Line Summary", brief.oneLineSummary || brief.generatedTitle || brief.angle],
    ["Why This Feels Good", brief.whyThisFeelsGood],
    ["Editorial Angle", brief.editorialAngle || brief.angle],
    ["Visual Strength", brief.visualStrength],
    ["Kevin Taste Fit", brief.kevinTasteFit],
    ["Recommendation", brief.recommendationReason],
    ["Image Credit", brief.imageCredit],
    ["Image Usage", brief.imageUsageStatus],
    ["Verification", brief.verificationNeeded || brief.verification]
  ].filter(([, body]) => body);
  $("#researchOutput").innerHTML = analysisCards.map(([title, body]) => `<div class="insight-card"><p class="insight-title">${safeText(title)}</p><p class="insight-body">${safeText(body)}</p></div>`).join("") || `<div class="insight-card"><p class="insight-title">Editorial Angle</p><p class="insight-body">${safeText(brief.angle)}</p></div>`;
  $("#createTitle").value = brief.name;
  if ($("#whyILikeThis")) $("#whyILikeThis").value = brief.whyILikeThis || "";
  $("#editorialAngle").value = brief.editorialAngle || brief.angle || "";
  $("#hookLine").value = makeDefaultHook(brief.name);
  $("#previewTitle").textContent = brief.name;
  $("#previewHook").textContent = $("#hookLine").value;
}

export function renderFactsAndSources(result) {
  if (Array.isArray(result.researchFacts)) {
    $("#researchOutput").insertAdjacentHTML("beforeend", result.researchFacts.slice(0, 12).map((item) => `<div class="insight-card"><p class="insight-title">${safeText(item.section || "Fact")} / ${safeText(item.confidence || "medium")}</p><p class="insight-body">${safeText(item.fact || "")}${item.sourceHint ? `\n${safeText(item.sourceHint)}` : ""}</p></div>`).join(""));
  }
  if (Array.isArray(result.sources)) {
    $("#researchOutput").insertAdjacentHTML("beforeend", result.sources.slice(0, 8).map((source) => `<div class="insight-card"><p class="insight-title">Source</p><p class="insight-body">${isWebUrl(source.url) ? `<a href="${safeText(source.url)}" target="_blank" rel="noreferrer">${safeText(source.title || source.url)}</a>` : safeText(source.title || "")}</p></div>`).join(""));
  }
}

export function renderArchiveItems(items) {
  const list = $("#archiveList");
  if (!items.length) {
    list.innerHTML = `<div class="empty">저장된 후보가 없습니다. Sources에서 첫 후보를 Analyze한 뒤 저장하세요.</div>`;
    return;
  }
  list.innerHTML = items.map((item) => {
    const type = item.itemType === "kevin_found" ? "Kevin Found" : "Daily Find";
    const sourceKind = item.sourceKind || (item.itemType === "kevin_found" ? "Kevin" : "Magazine");
    const status = item.status || "Candidate";
    const sourceName = item.sourceName || item.source_name || type;
    const createdAt = item.createdAtLabel || item.created_at_label || "";
    const summary = item.oneLineSummary || item.notes || "아직 한줄 요약이 없습니다.";
    const angle = item.angle || item.whyThisFeelsGood || "아직 editorial angle이 없습니다.";
    const image = isWebUrl(item.imageUrl)
      ? `<img src="${safeText(item.imageUrl)}" alt="" loading="lazy">`
      : `<div class="archive-image-placeholder">${safeText(item.category || type)}</div>`;
    const score = (label, value) => `<span>${label}<strong>${Number(value || 0)}</strong></span>`;
    const statusButton = (value, label) => `<button class="mini-btn status-btn${status === value ? " active" : ""}" data-status="${safeText(item.id)}" data-value="${value}" type="button"${status === value ? " disabled aria-current=\"true\"" : ""}>${label}</button>`;
    const referenceUrls = [...new Set([item.sourceUrl, ...(item.referenceUrls || [])].filter(isWebUrl))];
    const sourceLinks = referenceUrls.slice(0, 10).map((url, index) => `<a class="mini-btn" href="${safeText(url)}" target="_blank" rel="noreferrer">${index === 0 ? "원문" : `참고 ${index}`}</a>`).join("");
    return `<article class="archive-item archive-editorial" data-item-id="${safeText(item.id)}">
      <div class="archive-image">${image}</div>
      <div class="archive-content">
        <div class="archive-top"><div><p class="archive-meta"><span class="status-label">${safeText(status)}</span> / ${safeText(sourceKind)} / ${safeText(type)} / ${safeText(item.category)} / ${safeText(sourceName)}</p><h3 class="archive-title">${safeText(item.name || item.title)}</h3></div><div class="archive-actions">${statusButton("Approved", "Approve")}${statusButton("Hold", "Hold")}${statusButton("Rejected", "Reject")}<button class="mini-btn" data-use="${safeText(item.id)}" type="button">사용</button>${sourceLinks}<button class="mini-btn danger" data-delete="${safeText(item.id)}" type="button">삭제</button></div></div>
        <p class="archive-summary">${safeText(summary)}</p>
        <div class="archive-score-row">${score("Suitability", item.suitabilityScore)}${score("Taste", item.tasteFitScore)}${score("Visual", item.visualScore)}${score("Story", item.storyScore)}</div>
        <div class="archive-angle"><span>Editorial angle</span><p>${safeText(angle)}</p></div>
        <div class="why-note-box">
          <div class="why-note-head"><strong>Why I Like This</strong><span class="why-note-status" data-why-note-status="${safeText(item.id)}">${item.whyNoteUpdatedAt ? "저장됨" : "입력 대기"}</span></div>
          <textarea class="why-note-input" data-why-note="${safeText(item.id)}" placeholder="왜 이게 좋았는지 한두 줄로 적어보세요. 최종 게시물은 이 메모를 중심으로 작성됩니다.">${safeText(item.whyILikeThis || "")}</textarea>
        </div>
        <p class="archive-date">${safeText(createdAt)}</p>
      </div>
    </article>`;
  }).join("");
}

export function renderArchiveMessage(message) {
  $("#archiveList").innerHTML = `<div class="empty">${safeText(message)}</div>`;
}

export function prependArchiveMessage(message) {
  $("#archiveList").insertAdjacentHTML("afterbegin", `<div class="empty">${safeText(message)}</div>`);
}

export function renderDeckList(deck) {
  $("#deckList").innerHTML = deck.map((card, index) => `<div class="deck-card"><div class="deck-no">${index + 1}</div><div><p class="deck-title">${safeText(card[0])}</p><p class="deck-copy">${safeText(card[1])}</p></div></div>`).join("");
}

export function renderPreviewDeck(deck, format, topic, category = "") {
  const safeTopic = safeText(topic || "dig.everyday");
  const safeCategory = safeText(category || format || "Find");
  $("#previewDeck").innerHTML = deck.map((card, index) => {
    const copy = safeText(card[1]);
    const imageUrl = isWebUrl(card[2]) ? card[2] : "";
    const photoImageStyle = imageUrl
      ? ` style="background-image:url('${safeText(imageUrl.replace(/'/g, "%27"))}')"`
      : "";
    const imageClass = imageUrl ? " rs-has-image" : "";
    if (index === 0) {
      return `<article class="rs-slide rs-cover-photo${imageClass}"${photoImageStyle}>
        ${imageUrl ? "" : `<div class="rs-photo-placeholder">커버 사진을 추가하세요</div>`}
        <div class="rs-cover-photo-copy">
          <p class="rs-cover-meta"><span>${safeTopic}</span><span aria-hidden="true">·</span><span>${safeCategory}</span></p>
          <h3 class="rs-cover-hook">${copy}</h3>
        </div>
        <button class="preview-copy-btn" data-copy-card="${index}" type="button">복사</button>
      </article>`;
    }
    if (index < deck.length - 1) {
      return `<article class="rs-slide rs-photo-slide${imageClass}"${photoImageStyle}>
        ${imageUrl ? "" : `<div class="rs-photo-placeholder">사진을 추가하세요</div>`}
        <div class="rs-photo-copy">
          <p class="rs-photo-body">${copy}</p>
        </div>
        <button class="preview-copy-btn" data-copy-card="${index}" type="button">복사</button>
      </article>`;
    }
    return `<article class="rs-slide rs-cta-slide${imageClass}"${photoImageStyle}>
      ${imageUrl ? "" : `<div class="rs-photo-placeholder">CTA 사진을 추가하세요</div>`}
      <p class="rs-cta-copy">${copy}</p>
      <button class="preview-copy-btn" data-copy-card="${index}" type="button">복사</button>
    </article>`;
  }).join("");
}

export function renderDeckEditor(deck) {
  const editor = $("#deckEditor");
  if (!editor) return;
  editor.innerHTML = deck.map((card, index) => {
    const imageUrl = isWebUrl(card[2]) ? card[2] : "";
    return `<article class="editor-card">
      <div class="editor-top"><span class="editor-no">${index + 1}</span><input class="field editor-title-input" data-card-title="${index}" value="${safeText(card[0])}" aria-label="Card ${index + 1} title"></div>
      <textarea class="textarea editor-copy-input" data-card-copy="${index}" aria-label="Card ${index + 1} copy">${safeText(card[1])}</textarea>
      ${imageUrl ? `<img class="editor-image-preview" src="${safeText(imageUrl)}" alt="Card ${index + 1} preview">` : ""}
      <div class="editor-image-actions">
        <label class="mini-btn editor-upload-btn">사진 선택<input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-card-file="${index}"></label>
        <input class="field editor-image-url" type="url" data-card-image="${index}" value="${safeText(imageUrl)}" placeholder="또는 이미지 URL">
        ${imageUrl ? `<button class="mini-btn danger" data-remove-card-image="${index}" type="button">사진 제거</button>` : ""}
      </div>
    </article>`;
  }).join("");
}

export function renderDeck(deck, format, topic, category = "") {
  renderDeckList(deck);
  renderPreviewDeck(deck, format, topic, category);
  renderDeckEditor(deck);
}

export function renderCaption(title, angle, hook) {
  const hashtags = ["#digeveryday", "#오늘의발견", "#라이프스타일큐레이션"];
  $("#captionText").textContent = `${title}\n\n${hook}\n\nOrigin.\nGrowth.\nSignature.\n\n${angle}\n\n확인 필요: 위치, 운영 시간, 예약 방식, 가격, 공식 표기.\n\n${hashtags.join(" ")}`;
}
