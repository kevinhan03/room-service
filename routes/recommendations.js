const { sendJson, sendError } = require("../lib/http");
const { supabaseRequest, normalizeBoardRow } = require("../lib/supabase-client");
const { getZonedParts } = require("../lib/feeds/runs");
const { calculateRecommendationScore, recommendationTier } = require("../lib/recommendations");

async function handleTodayRecommendations(req, res) {
  try {
    const recommendationDate = getZonedParts().date;
    const existing = await supabaseRequest(`recommendation_snapshots?select=*,recommendation_snapshot_items(*,curation_items(*,content_items(*),kevin_finds(*),ai_analyses(*)))&recommendation_date=eq.${recommendationDate}&limit=1`, { method: "GET", headers: { Prefer: "" } });
    if (existing?.[0]) {
      const snapshot = existing[0];
      if (Number(snapshot.item_count || 0) > 0) {
        const items = (snapshot.recommendation_snapshot_items || [])
          .sort((a, b) => a.rank - b.rank)
          .map((entry) => ({ ...normalizeBoardRow(entry.curation_items), finalScore: Number(entry.final_score), rank: entry.rank }))
          .filter((item) => item.status === "Candidate" && item.humanDecision !== "rejected");
        sendJson(res, 200, { items, snapshotId: snapshot.id, generatedAt: snapshot.generated_at, isSnapshot: true, collection: { mode: "manual" } });
        return;
      }
      await supabaseRequest(`recommendation_snapshots?id=eq.${encodeURIComponent(snapshot.id)}`, { method: "DELETE", headers: { Prefer: "" } });
    }

    const rows = await supabaseRequest("curation_items?select=*,content_items(*),kevin_finds(*),ai_analyses(*)&status=eq.Candidate&human_decision=neq.rejected&order=created_at.desc&limit=100", { method: "GET", headers: { Prefer: "" } });
    const now = Date.now();
    const items = (rows || [])
      .map(normalizeBoardRow)
      .map((item) => ({ ...item, finalScore: calculateRecommendationScore(item) }))
      .sort((a, b) => recommendationTier(a, now) - recommendationTier(b, now)
        || b.finalScore - a.finalScore
        || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
    const recommendedAt = new Date().toISOString();
    if (!items.length) {
      sendJson(res, 200, { items: [], snapshotId: null, generatedAt: recommendedAt, isSnapshot: false, collection: { mode: "manual" } });
      return;
    }
    const snapshotRows = await supabaseRequest("recommendation_snapshots", {
      method: "POST",
      body: JSON.stringify({ recommendation_date: recommendationDate, generated_at: recommendedAt, item_count: items.length })
    });
    const snapshot = snapshotRows?.[0];
    if (snapshot?.id) {
      await supabaseRequest("recommendation_snapshot_items", {
        method: "POST",
        body: JSON.stringify(items.map((item, index) => ({
          snapshot_id: snapshot.id,
          curation_item_id: item.id,
          rank: index + 1,
          final_score: item.finalScore
        })))
      });
      await Promise.all(items.map((item) => supabaseRequest(`curation_items?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ last_recommended_at: recommendedAt, recommendation_count: item.recommendationCount + 1 })
      })));
    }
    sendJson(res, 200, {
      items: items.map((item, index) => ({ ...item, rank: index + 1, lastRecommendedAt: recommendedAt, recommendationCount: item.recommendationCount + 1 })),
      snapshotId: snapshot?.id || null,
      generatedAt: recommendedAt,
      isSnapshot: true,
      collection: { mode: "manual" }
    });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = { handleTodayRecommendations };
