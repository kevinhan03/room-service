# dig.everyday MVP Architecture

Room Service pivots from a card-news maker into the operating CMS for
dig.everyday: a daily lifestyle curation system for things Kevin finds online
and offline.

## Product Shape

The MVP keeps the system small enough to run every day.

- `Daily Find`: web/RSS/URL based discovery.
- `Kevin Found Lite`: manual registration for things Kevin personally found.
- `Analyze`: summary, classification, and taste evaluation in one user action.
- `Create Post`: seven-slide copy and caption generation in one user action.
- `Board`: one curation board for both Daily Find and Kevin Found.

## MVP Tables

Only these tables should be implemented first:

- `sources`
- `content_items`
- `kevin_finds`
- `ai_analyses`
- `curation_items`
- `post_drafts`
- `post_slides`

`image_assets` and `exports` are intentionally deferred. For V1, image metadata
lives directly on `content_items`, `kevin_finds`, and `post_drafts`.

## Core Distinction

- `content_items`: things discovered from the web.
- `kevin_finds`: things Kevin directly experienced or personally saved.
- `ai_analyses`: the dig.everyday taste filter.
- `curation_items`: editorial workflow state.
- `post_drafts`: publishable Instagram carousel draft.

## Curation Statuses

- `Candidate`
- `Dig More Candidate`
- `Approved`
- `Hold`
- `Rejected`

## Categories

Daily Find categories:

- `Fashion`
- `Space`
- `Food`
- `Travel`
- `Hotel`
- `Object`
- `Perfume`
- `Architecture`
- `Product`
- `Brand`
- `Book`
- `Magazine`
- `Artwork`
- `Playlist`

Kevin Found Lite categories:

- `Restaurant`
- `Cafe`
- `Hotel`
- `Travel`
- `Store`
- `Exhibition`
- `Perfume`
- `Object`
- `Product`
- `Brand`
- `Book`
- `Magazine`
- `Artwork`
- `Playlist`

## AI Contract

Internally, AI work is split into four stages. The UX exposes only two buttons.

### User Action: Analyze

Runs:

1. Summary & Classification
2. Taste Evaluation

Required output:

- `generated_title`
- `one_line_summary`
- `three_line_summary`
- `category`
- `recommendation_reason`
- `why_this_feels_good`
- `editorial_angle`
- `visual_strength`
- `kevin_taste_fit`
- `suitability_score`
- `taste_fit_score`
- `visual_score`
- `story_score`
- `suggested_status`
- `risk_notes`
- `verification_needed`
- `key_points`
- `source_facts`

### User Action: Create Post

Runs:

1. Slide Copy Generation
2. Caption Generation

Required output:

- seven slides exactly:
  1. `Cover`
  2. `Introduction`
  3. `Why It Matters`
  4. `Detail 1`
  5. `Detail 2`
  6. `Editor's Note`
  7. `CTA`
- `caption`
- `hashtags`
- `credit_note`
- `source_note`

## Page IA

- `Today`: daily operating dashboard.
- `Sources`: RSS feed and URL source management.
- `Inbox`: collected Daily Find candidates.
- `Kevin Found`: manual registration for personal finds.
- `Board`: unified curation board.
- `Builder`: seven-slide post editor.
- `Export`: PNG/caption/credit preparation.

## Automatic Daily Collection

- Save multiple RSS feeds or editorial website URLs in `Sources`.
- Vercel Cron calls `/api/cron` every day at `22:00 UTC`, which is `07:00` the next day in `Asia/Seoul`.
- A locally running server also checks active sources every day at `07:00` in `Asia/Seoul`.
- If the server starts after 07:00 and a source has not run that day, it performs a startup catch-up collection.
- RSS/Atom is preferred. Normal websites use a basic same-domain article-link crawler and Open Graph metadata fallback.
- Existing content URLs and existing curation rows are skipped before AI analysis to prevent duplicate cost and duplicate Board items.
- New items are analyzed, scored, and saved to Today/Board.
- Once the Vercel deployment and Production environment variables are updated, collection runs while the Mac is off.
- On Vercel Hobby, a daily cron can start at any point within the scheduled hour, so the practical collection window is `07:00-07:59 KST`.

Environment controls:

```env
AUTO_COLLECT_TIME=07:00
AUTO_COLLECT_TIMEZONE=Asia/Seoul
AUTO_COLLECT_LIMIT=5
CRON_SECRET=use-a-long-random-value
```

The Vercel Production environment must also include the Supabase, OpenAI, and Perplexity variables used by the local `.env.local` file. Local environment files are intentionally not committed or uploaded.
