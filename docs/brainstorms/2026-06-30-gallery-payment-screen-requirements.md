---
date: 2026-06-30
topic: gallery-payment-screen
---

# Gallery on the Payment-Confirmed Screen — Requirements

## Summary

Embed a live mosaic of recent community uploads into the post-payment screens so every villager who checks in or pays sees the gallery as social proof and is nudged to add their own photo. The mosaic is a dense grid with a few "highlighted" photos breaking out to larger tiles, carries both an in-grid "Add yours" tile and a secondary "Add your photo" button, and uploading happens in place with the new photo appearing in the mosaic as confirmation. Because the mosaic is high-visibility, reported or removed photos never appear in it, and moderators can promote standout uploads into the larger highlighted tiles.

## Problem Frame

The gallery is the studio's community feed, but almost nobody discovers it. There is no global navigation entry; it surfaces only as a secondary button on the post-check-in "done" screen and a small footer link on the "who's here" page (`web/src/components/checkin-flow.tsx`, `web/src/app/here/page.tsx`). Villagers never realize the gallery exists, so they never realize they're invited to contribute.

The post-payment moment is the highest-attention point in the whole flow: the phone is already out, the villager just completed an action, and (because uploading is gated behind same-day check-in) they have just become eligible to upload. Today that moment shows only a confirmation and two buttons. The opportunity to convert attention into a contribution is being spent on a dead-end success screen.

## Key Decisions

- **Social proof over instruction.** Lead with real photos from the community rather than a "share your photos!" prompt, so the villager forms the question "how do I add mine?" themselves. The upload affordances answer a question they're already asking.
- **Keep the check-in→upload gate.** Surface the gallery at the post-payment moment when the villager is already eligible and attentive, rather than loosening uploads to anytime. This avoids reworking the upload eligibility model and keeps the social-proof moment tied to presence.
- **Preserve the existing primary action.** "See who's here" stays the primary button. Upload prominence comes from the mosaic itself plus a secondary "Add your photo" button and the in-grid add tile — not from demoting the existing CTA.
- **Highlight rule: moderator promotion first, then recency.** Moderator-promoted uploads fill the highlighted (larger) tiles first; recency fills any remaining highlighted spots. The selection sits behind a swappable rule so a future engagement signal (most-reacted) can replace the recency portion without reworking the mosaic.
- **Moderation-safe by default.** The mosaic is the most-seen surface in the app, so it must never show reported or removed content. It relies on the existing report + admin-removal mechanisms rather than introducing a new approval workflow.
- **Today-with-backfill content.** The mosaic prefers photos shared today, backfills with recent photos when today is thin so it always looks alive, and falls back to a "be the first" prompt only when there is genuinely nothing to show.

## Requirements

**Mosaic display**

- R1. The payment-confirmed screen shows a mosaic of recent community uploads above the existing action buttons.
- R2. The mosaic is a dense grid in which a small number of "highlighted" photos occupy a larger (roughly 2×2) tile while the rest occupy standard tiles.
- R3. Highlighted tiles are selected by a single, replaceable rule: moderator-promoted uploads fill the highlighted spots first, then the most-recent uploads fill any remaining highlighted spots.
- R4. The mosaic prefers photos uploaded today and backfills with the most recent prior uploads when today's count is below what the layout needs to look full.
- R5. When there are no uploads to show at all, the mosaic is replaced by a "be the first to share today" prompt that still presents an upload affordance.
- R6. Each tile shows the uploader's display name, consistent with the existing gallery feed; videos remain playable/recognizable as video.

**Upload affordances**

- R7. The mosaic includes an in-grid "Add yours" tile as an implicit upload affordance.
- R8. The screen also includes an explicit "Add your photo" button, positioned as a secondary action below the primary "See who's here" button.
- R9. Activating either upload affordance opens the device photo picker and uploads in place on the current screen, reusing the existing upload pipeline (client re-encode → presigned PUT to private storage → register).
- R10. After a successful in-place upload, the new photo appears in the mosaic on the same screen as confirmation.

**Placement**

- R11. The mosaic experience renders on the in-flow post-check-in "done" screen (`web/src/components/checkin-flow.tsx`).
- R12. The same mosaic experience renders on the `/success` page (`web/src/app/success/page.tsx`) where online Stripe payers land, via a shared component so both surfaces stay identical.

**Moderation and curation**

- R13. The mosaic excludes any upload that has been reported or removed (soft-deleted) — flagged or removed content never appears in this high-visibility position.
- R14. A moderator can promote an upload so it occupies a highlighted (larger) tile; promoted uploads take highlighted spots ahead of recency-selected ones (see R3).

## Key Flows

- F1. See-and-contribute on the done screen
  - **Trigger:** Villager completes check-in/payment and reaches the "done" screen.
  - **Steps:** Screen shows confirmation, then the mosaic of recent uploads, then "See who's here" (primary) and "Add your photo" (secondary). Villager taps an upload affordance → device photo picker opens → photo uploads in place → new photo appears in the mosaic.
  - **Outcome:** Villager has contributed without leaving the screen, or proceeds to "See who's here" / full gallery.
  - **Covered by:** R1, R7, R8, R9, R10, R11

- F2. Online payer on /success
  - **Trigger:** Villager pays online via Stripe and is redirected to `/success`.
  - **Steps:** Same mosaic + upload affordances as F1 render on `/success`.
  - **Outcome:** Online payers hit the identical social-proof and contribution moment.
  - **Covered by:** R12

- F3. Thin or empty content
  - **Trigger:** Screen loads early in the day or before any uploads exist.
  - **Steps:** If today is thin, the mosaic backfills with recent prior uploads. If nothing exists at all, the mosaic is replaced by a "be the first to share today" prompt with an upload affordance.
  - **Outcome:** The screen never shows an awkward empty grid; the contribution path is always present.
  - **Covered by:** R4, R5

- F4. Moderator curates the mosaic
  - **Trigger:** A moderator reviews uploads and reports/removes bad content or promotes a standout photo.
  - **Steps:** Reported or removed uploads drop out of the mosaic; a promoted upload moves into a highlighted tile ahead of recency-selected photos.
  - **Outcome:** The high-visibility mosaic stays clean and showcases the best content.
  - **Covered by:** R13, R14

## Acceptance Examples

- AE1. Healthy day
  - **Given:** Several photos were uploaded today.
  - **When:** The villager reaches the payment-confirmed screen.
  - **Then:** The mosaic shows today's photos with the most recent ones in the larger highlighted tiles, plus the in-grid add tile.
  - **Covers:** R2, R3, R4, R7

- AE2. Early in the day (thin)
  - **Given:** Only one photo has been uploaded today, but the gallery has recent prior photos.
  - **When:** The villager reaches the screen.
  - **Then:** The mosaic shows today's photo plus recent prior photos so the grid looks full.
  - **Covers:** R4

- AE3. Empty gallery
  - **Given:** There are no uploads to show.
  - **When:** The villager reaches the screen.
  - **Then:** Instead of a grid, a "be the first to share today" prompt is shown with an upload affordance.
  - **Covers:** R5

- AE4. In-place contribution
  - **Given:** A checked-in villager is on the payment-confirmed screen.
  - **When:** They tap "Add your photo" and pick an image.
  - **Then:** The image uploads without navigating away, and appears in the mosaic on the same screen.
  - **Covers:** R9, R10

- AE5. Flagged content stays out
  - **Given:** A recent upload has been reported or removed.
  - **When:** The villager reaches the payment-confirmed screen.
  - **Then:** That upload does not appear anywhere in the mosaic, including the highlighted tiles.
  - **Covers:** R13

- AE6. Promoted photo is highlighted
  - **Given:** A moderator has promoted an upload that is not the most recent.
  - **When:** The villager reaches the screen.
  - **Then:** The promoted upload occupies a highlighted (larger) tile, ahead of more-recent non-promoted photos.
  - **Covers:** R3, R14

## Scope Boundaries

**Deferred for later**

- A persistent or global gallery navigation entry (top nav / menu) — discoverability here is solved at the post-payment moment, not app-wide.
- Letting non-checked-in villagers upload — the check-in gate stays in place.
- Swapping the highlight rule to an engagement-based signal — designed for (R3) but not built now.

**Outside this brief**

- Building a reactions/likes system. The highlight rule is built to accommodate one later, but no reactions concept is introduced here.

## Dependencies / Assumptions

- Reuses the existing upload pipeline and private-storage model (presigned upload + short-lived presigned download URLs); no change to where or how media is stored.
- Reuses the existing report + admin-removal mechanisms (`reported` flag, soft-delete) for exclusion; no new approval/review workflow is introduced.
- Introduces a moderator "promote to highlight" capability — a new promoted state on the upload record plus a moderator control to set it (likely in the existing admin gallery panel).
- Assumes the gallery read path can be adapted to support a "today, with recent backfill" selection and to honor promotion + exclusion; the current read path returns recent uploads overall, not today-scoped.
- Assumes loading a handful of presigned image/video URLs inline on the post-payment screen is acceptable for performance on mobile.

## Outstanding Questions

**Deferred to planning**

- The exact tile counts (how many tiles, how many highlighted) and the "thin" threshold that triggers backfill.
- How the in-place upload and "new photo appears in mosaic" interaction integrates with the existing upload component currently living on the `/gallery` page.
- Whether the `/success` page has the viewer's villager identity available for the "(you)" / ownership affordances, or whether those are simply omitted there.
- Whether the current gallery read path already excludes `reported` items or only soft-deleted ones, and where the moderator's "promote" control lives (the admin gallery panel vs. elsewhere).
- Whether more highlighted tiles can be promoted than the layout has large spots, and how that overflow is handled (e.g., newest-promoted wins).

## Sources / Research

- `web/src/app/gallery/page.tsx` — current gallery feed and upload client logic; `canUpload` requires same-day check-in.
- `web/src/app/api/gallery/route.ts` — read API; returns most-recent uploads (cap ~60), not today-scoped.
- `web/src/app/api/upload/route.ts`, `web/src/app/api/upload/presign/route.ts` — upload register + presign lifecycle.
- `web/src/lib/r2.ts` — allowed upload types (jpeg/png/webp, mp4/quicktime) and private-bucket presigning.
- `web/src/components/checkin-flow.tsx` — post-check-in "done" screen and `CommunityLinks` (primary "See who's here", secondary "Village gallery").
- `web/src/app/success/page.tsx` — online-payment return screen; currently only a "Back to Home" action.
- `web/src/components/admin/gallery-panel.tsx` — existing admin moderation view; likely home for the "promote to highlight" control.
- `web/src/app/api/upload/[id]/report/route.ts`, `web/src/app/api/upload/[id]/route.ts` — report and owner/admin delete (soft-delete) endpoints.
- `supabase/migrations/20260625120000_uploads.sql` — `uploads` table; has `reported` and `deleted_at`/`deleted_by` for moderation, but no `promoted`/`featured` column and no reactions/engagement columns yet.
