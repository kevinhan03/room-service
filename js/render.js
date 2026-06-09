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
  } else {
    element.textContent = element.dataset.idleText || element.textContent;
    element.disabled = false;
    delete element.dataset.idleText;
  }
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
    $("#researchOutput").insertAdjacentHTML("beforeend", result.sources.slice(0, 8).map((source) => `<div class="insight-card"><p class="insight-title">Source</p><p class="insight-body">${source.url ? `<a href="${safeText(source.url)}" target="_blank" rel="noreferrer">${safeText(source.title || source.url)}</a>` : safeText(source.title || "")}</p></div>`).join(""));
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
    const status = item.status || "Candidate";
    const sourceName = item.sourceName || item.source_name || type;
    const createdAt = item.createdAtLabel || item.created_at_label || "";
    const angle = item.angle || item.oneLineSummary || item.whyThisFeelsGood || "";
    return `<article class="archive-item"><div class="archive-top"><div><p class="archive-title">${safeText(item.name || item.title)}</p><p class="archive-meta">${safeText(status)} / ${safeText(type)} / ${safeText(item.category)} / ${safeText(sourceName)} / ${safeText(createdAt)}</p></div><div class="archive-actions"><button class="mini-btn" data-status="${safeText(item.id)}" data-value="Approved" type="button">Approve</button><button class="mini-btn" data-status="${safeText(item.id)}" data-value="Hold" type="button">Hold</button><button class="mini-btn" data-status="${safeText(item.id)}" data-value="Rejected" type="button">Reject</button><button class="mini-btn" data-use="${safeText(item.id)}" type="button">사용</button><button class="mini-btn" data-delete="${safeText(item.id)}" type="button">삭제</button></div></div><p class="small">${safeText(angle)}</p></article>`;
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

export function renderPreviewDeck(deck, format, topic) {
  const safeTopic = safeText(topic || "dig.everyday");
  $("#previewDeck").innerHTML = deck.map((card, index) => {
    const title = safeText(card[0]);
    const copy = safeText(card[1]);
    const number = String(index + 1).padStart(2, "0");
    if (index === 0) {
      return `<article class="rs-slide rs-cover"><span class="rs-logo">dig.everyday</span><div class="rs-eyebrow"><span class="rs-bar"></span><span class="rs-eyebrow-text">${safeText(format)}</span></div><h3 class="rs-cover-title">${safeTopic}</h3><p class="rs-cover-copy">${copy}</p><button class="preview-copy-btn" data-copy-card="${index}" type="button">복사</button></article>`;
    }
    const sideClass = index % 2 === 0 ? " rs-side" : "";
    return `<article class="rs-slide rs-text${sideClass}"><p class="rs-index">${number} / ${title}</p><h3 class="rs-title">${title}</h3><p class="rs-copy">${copy}</p><p class="rs-footer">dig.everyday</p><button class="preview-copy-btn" data-copy-card="${index}" type="button">복사</button></article>`;
  }).join("");
}

export function renderDeckEditor(deck) {
  const editor = $("#deckEditor");
  if (!editor) return;
  editor.innerHTML = deck.map((card, index) => `<article class="editor-card"><div class="editor-top"><span class="editor-no">${index + 1}</span><input class="field editor-title-input" data-card-title="${index}" value="${safeText(card[0])}" aria-label="Card ${index + 1} title"></div><textarea class="textarea editor-copy-input" data-card-copy="${index}" aria-label="Card ${index + 1} copy">${safeText(card[1])}</textarea></article>`).join("");
}

export function renderDeck(deck, format, topic) {
  renderDeckList(deck);
  renderPreviewDeck(deck, format, topic);
  renderDeckEditor(deck);
}

export function renderCaption(title, angle, hook) {
  const hashtags = ["#digeveryday", "#오늘의발견", "#라이프스타일큐레이션"];
  $("#captionText").textContent = `${title}\n\n${hook}\n\nOrigin.\nGrowth.\nSignature.\n\n${angle}\n\n확인 필요: 위치, 운영 시간, 예약 방식, 가격, 공식 표기.\n\n${hashtags.join(" ")}`;
}
