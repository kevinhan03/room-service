const {
  handleListSources,
  handleCreateSource,
  handleImportRss,
  handleRunAllSources,
  handleRunSource,
  handleFinalizeCollectionRun,
  handleUpdateSource,
  handleDeleteSource,
  handleCollectionRuns
} = require("./sources");
const {
  handleListBoard,
  handleDecision,
  handleBulkDecision,
  handleUpdateBoardItem,
  handleUpdateWhyNote,
  handleSaveDailyFind,
  handleDeleteBoardItem,
  handleGetBoardItem
} = require("./board");
const { handleTodayRecommendations } = require("./recommendations");
const {
  handleSaveKevinFind,
  handleListKevinFinds,
  handleUpdateKevinFind,
  handleDeleteKevinFind
} = require("./kevin-finds");
const {
  handleSavePostDraft,
  handleListPostDrafts,
  handleGetPostDraft,
  handleUpdatePostDraft,
  handleUploadPostSlideImage,
  handleDeletePostDraft
} = require("./drafts");
const {
  handleListInbox,
  handleCreateInbox,
  handleGenerateInboxIdeas,
  handleUpdateInboxIdea,
  handleResearchInboxIdea
} = require("./inbox");
const { handleResearch, handleCreateDeck } = require("./research");

function dispatchApiRequest(req, res, parsed) {
  const pathname = parsed.pathname;
  const method = req.method;

  if (method === "POST" && pathname === "/api/research") return handleResearch(req, res);
  if (method === "POST" && pathname === "/api/create-deck") return handleCreateDeck(req, res);

  if (method === "GET" && pathname === "/api/inbox") return handleListInbox(req, res);
  if (method === "POST" && pathname === "/api/inbox") return handleCreateInbox(req, res);
  const inboxIdeasMatch = pathname.match(/^\/api\/inbox\/([^/]+)\/ideas$/);
  if (inboxIdeasMatch && method === "POST") return handleGenerateInboxIdeas(req, res, inboxIdeasMatch[1]);
  const inboxIdeaResearchMatch = pathname.match(/^\/api\/inbox\/ideas\/([^/]+)\/research$/);
  if (inboxIdeaResearchMatch && method === "POST") return handleResearchInboxIdea(req, res, inboxIdeaResearchMatch[1]);
  const inboxIdeaMatch = pathname.match(/^\/api\/inbox\/ideas\/([^/]+)$/);
  if (inboxIdeaMatch && method === "PATCH") return handleUpdateInboxIdea(req, res, inboxIdeaMatch[1]);

  if (method === "GET" && pathname === "/api/collection-runs") return handleCollectionRuns(req, res);
  const finalizeCollectionMatch = pathname.match(/^\/api\/collection-runs\/([^/]+)\/finalize$/);
  if (finalizeCollectionMatch && method === "POST") return handleFinalizeCollectionRun(req, res, finalizeCollectionMatch[1]);

  if (method === "GET" && pathname === "/api/post-drafts") return handleListPostDrafts(req, res);
  if (method === "POST" && pathname === "/api/post-drafts") return handleSavePostDraft(req, res);
  const postSlideImageMatch = pathname.match(/^\/api\/post-drafts\/([^/]+)\/slides\/([1-7])\/image$/);
  if (postSlideImageMatch && method === "POST") {
    return handleUploadPostSlideImage(req, res, postSlideImageMatch[1], postSlideImageMatch[2]);
  }
  const postDraftMatch = pathname.match(/^\/api\/post-drafts\/([^/]+)$/);
  if (postDraftMatch && method === "GET") return handleGetPostDraft(req, res, postDraftMatch[1]);
  if (postDraftMatch && method === "PATCH") return handleUpdatePostDraft(req, res, postDraftMatch[1]);
  if (postDraftMatch && method === "DELETE") return handleDeletePostDraft(req, res, postDraftMatch[1]);

  if (method === "GET" && pathname === "/api/kevin-finds") return handleListKevinFinds(req, res, parsed);
  if (method === "POST" && pathname === "/api/kevin-finds") return handleSaveKevinFind(req, res);
  const kevinFindMatch = pathname.match(/^\/api\/kevin-finds\/([^/]+)$/);
  if (kevinFindMatch && method === "PATCH") return handleUpdateKevinFind(req, res, kevinFindMatch[1]);
  if (kevinFindMatch && method === "DELETE") return handleDeleteKevinFind(req, res, kevinFindMatch[1]);

  if (method === "GET" && pathname === "/api/curation-items") return handleListBoard(req, res);
  if (method === "GET" && (pathname === "/api/today" || pathname === "/api/recommendations/today")) {
    return handleTodayRecommendations(req, res);
  }
  if (method === "POST" && pathname === "/api/curation-items/daily-find") return handleSaveDailyFind(req, res);
  if (method === "PATCH" && pathname === "/api/curation-items/bulk-decision") return handleBulkDecision(req, res);
  const boardDecisionMatch = pathname.match(/^\/api\/curation-items\/([^/]+)\/decision$/);
  if (boardDecisionMatch && method === "PATCH") return handleDecision(req, res, boardDecisionMatch[1]);
  const boardWhyNoteMatch = pathname.match(/^\/api\/curation-items\/([^/]+)\/why-note$/);
  if (boardWhyNoteMatch && method === "PATCH") return handleUpdateWhyNote(req, res, boardWhyNoteMatch[1]);
  const boardItemMatch = pathname.match(/^\/api\/curation-items\/([^/]+)$/);
  if (boardItemMatch && method === "GET") return handleGetBoardItem(req, res, boardItemMatch[1]);
  if (boardItemMatch && method === "PATCH") return handleUpdateBoardItem(req, res, boardItemMatch[1]);
  if (boardItemMatch && method === "DELETE") return handleDeleteBoardItem(req, res, boardItemMatch[1]);

  if (method === "GET" && pathname === "/api/sources") return handleListSources(req, res);
  if (method === "POST" && pathname === "/api/sources") return handleCreateSource(req, res);
  if (method === "POST" && pathname === "/api/sources/run-all") return handleRunAllSources(req, res);
  if (method === "POST" && pathname === "/api/sources/rss-import") return handleImportRss(req, res);
  const sourceRunMatch = pathname.match(/^\/api\/sources\/([^/]+)\/run$/);
  if (sourceRunMatch && method === "POST") return handleRunSource(req, res, sourceRunMatch[1]);
  const sourceMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch && method === "PATCH") return handleUpdateSource(req, res, sourceMatch[1]);
  if (sourceMatch && method === "DELETE") return handleDeleteSource(req, res, sourceMatch[1]);

  return false;
}

module.exports = { dispatchApiRequest };
