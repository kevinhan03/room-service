function normalizeRecommendationScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(score <= 10 ? score * 10 : score, 100));
}

function calculateRecommendationScore(item) {
  const suitability = normalizeRecommendationScore(item.suitabilityScore);
  const tasteFit = normalizeRecommendationScore(item.tasteFitScore);
  const visual = normalizeRecommendationScore(item.visualScore);
  const story = normalizeRecommendationScore(item.storyScore);
  const humanSavedBonus = item.humanSaved ? 15 : 0;
  return Math.round((suitability * 0.4 + tasteFit * 0.3 + visual * 0.2 + story * 0.1 + humanSavedBonus) * 10) / 10;
}

function recommendationTier(item, now = Date.now()) {
  if (item.humanSaved && item.status === "Candidate") return 0;
  const createdAt = new Date(item.createdAt || 0).getTime();
  const isFresh = Number.isFinite(createdAt) && now - createdAt <= 24 * 60 * 60 * 1000;
  if (!item.lastRecommendedAt && !isFresh) return 1;
  if (isFresh) return 2;
  return 3;
}

module.exports = {
  calculateRecommendationScore,
  normalizeRecommendationScore,
  recommendationTier
};
