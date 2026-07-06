# Session Recap: cal-attio-sync initial ship

**Date:** 2026-07-06
**Project:** cal-attio-sync (miqcie/cal-attio-sync)
**PRs Merged:** #1 (initial sync), #2 (null payload fields), #3 (README prose), #4 (per-booking entries), #5 (API key links)

## What Was Built

A free, self-hosted replacement for Kola AI's paid Cal.com → Attio sync. Single webhook handler (Web-standard TypeScript) that verifies Cal.com's HMAC signature, asserts the attendee as an Attio person by email, and upserts the booking into a "Bookings" list parented to People, keyed on the Cal.com booking UID. No database — Attio is the store.

Deployed live to Val.town (val `cal-attio`, @miqcie) with a Cloudflare Worker entry shipped in the repo as an alternative. Cal.com webhook active on five triggers: created, rescheduled, cancelled, no-show, meeting-ended. Verified end-to-end with real Cal.com bookings (create, cancel, reschedule).

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Bookings as a list parented to People, not a custom object | Attio free plan returns `quota_exceeded` on object creation; list entries show on the person timeline anyway |
| Query-by-uid → PATCH/POST instead of Attio's entry assert endpoint | `PUT /lists/{list}/entries` matches on the PARENT record regardless of `matching_attribute` — a repeat booker's second booking overwrote their first |
| Terminal statuses never regress to `confirmed` | Webhook deliveries are unordered and retried; a retried BOOKING_CREATED must not resurrect a cancelled booking |
| Val.town hosting, platform-agnostic core | Zero-deploy iteration; Worker entry keeps the exit open. Env vars are UI-only on Val.town — one manual setup step |
| 500 on Attio errors | Cal.com retries failed deliveries, so transient (and fixable) failures self-heal — the null bug's missed bookings drained automatically after the fix |

## Corrections Applied

- **Null payload fields (PR #2):** real Cal.com payloads carry `cancellationReason: null`; Attio 400s on null. Fixtures omitted the field, so 18 green tests missed it. Filter with `!= null`.
- **Assert-by-parent (PR #4):** found by live reschedule testing; confirmed with a one-call API probe. Regression test added for the repeat-booker case.
- **Attio `people.name`** is a structured `personal-name` type — a bare string is rejected/mis-parsed. Caught pre-merge by parallel review agents.

## What's Next

- #6 — verify the Cloudflare Worker deploy path once
- #7 — capture real `MEETING_ENDED` / `BOOKING_NO_SHOW_UPDATED` payloads as fixtures (the two untested-live shapes)
