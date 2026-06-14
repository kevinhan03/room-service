import { $, isWebUrl, slugFromUrl } from "./render.js";

export function parseReferenceUrls(value) {
  return [...new Set(String(value || "")
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean))];
}

export function buildBriefFromForm() {
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

export function actionErrorMessage(error) {
  if (error?.code === "MISSING_SUPABASE_KEY") {
    return "Vercel에 SUPABASE_SERVICE_ROLE_KEY가 없습니다. 환경변수를 설정한 뒤 다시 배포해 주세요.";
  }
  return error?.message || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function formatDateTime(value) {
  if (!value) return "기록 없음";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export function displayableImageUrl(value) {
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

export function isSourceCompatibilityError(error) {
  return ["SOURCE_UNSUPPORTED", "RSS_FETCH_ERROR", "API_NETWORK_ERROR"].includes(error?.code);
}

export function showSourceWarning(error) {
  const dialog = $("#sourceWarningDialog");
  const message = $("#sourceWarningMessage");
  if (!dialog || !message) return;
  message.textContent = error?.message || "이 사이트의 기사 수집 호환성을 확인하지 못했습니다.";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
