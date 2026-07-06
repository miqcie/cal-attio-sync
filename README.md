# cal-attio-sync

Free, self-hosted Cal.com → Attio booking sync. A single webhook handler that:

1. receives Cal.com booking webhooks (created / rescheduled / cancelled / no-show / meeting ended),
2. finds or creates the Attio **person** by attendee email,
3. upserts an entry in a **Bookings list** (parented to People), keyed on the Cal.com booking UID — so cancellations and reschedules update the same entry instead of duplicating it.

A list rather than a custom object because Attio's free plan doesn't allow custom objects; the entry's parent record is the attendee, so bookings show on the person's timeline either way.

No database. Attio is the store. Runs on [Val.town](https://val.town) or Cloudflare Workers (free tiers of either) — the core is plain Web-standard TypeScript.

## Setup

### 1. Create the Bookings list in Attio

Get a workspace API key from [Attio → Workspace settings → Developers](https://app.attio.com/settings/developers) (record read-write + list read-write scopes), then:

```sh
ATTIO_API_KEY=... bun scripts/setup-attio.ts
```

Idempotent — creates the `bookings` list (parent: People) with `booking_uid` (unique), `title`, `starts_at`, `ends_at`, `status` (confirmed / rescheduled / cancelled / no_show / completed), `organizer_email`, `location`, `cancellation_reason`, `form_responses`.

### 2. Deploy the handler

Pick a webhook secret (any random string). You'll set it twice — on the handler and in Cal.com.

**Val.town** — create an HTTP val from `main.tsx` + `src/` (or use the [`vt` CLI](https://docs.val.town/vt) to push this repo), then set `ATTIO_API_KEY` and `CAL_WEBHOOK_SECRET` in the val's Environment Variables. Your endpoint is the val's URL.

**Cloudflare Workers**:

```sh
wrangler secret put ATTIO_API_KEY
wrangler secret put CAL_WEBHOOK_SECRET
wrangler deploy
```

### 3. Point Cal.com at it

Two ways. **In the UI:** [app.cal.com/settings/developer/webhooks](https://app.cal.com/settings/developer/webhooks) — set subscriber URL to your endpoint, secret to the one you picked, and enable the five booking/meeting triggers. **Or with an API key** ([app.cal.com/settings/developer/api-keys](https://app.cal.com/settings/developer/api-keys)):

```sh
CAL_API_KEY=... bun scripts/setup-cal.ts https://your-endpoint.example.com <webhook-secret>
```

### 4. Verify

Book a test event. Within a second or two you should see a new Booking record in Attio linked to the attendee's person record. Cancel it — the same record flips to `cancelled`.

## How it works

- `src/core.ts` — signature verification (HMAC-SHA256 of the raw body vs `X-Cal-Signature-256`), payload normalization (Cal.com uses a nested payload for `BOOKING_*` events but a flat one for `MEETING_ENDED`), event → status mapping.
- `src/attio.ts` — thin Attio v2 client. Person and booking writes are `PUT … ?matching_attribute=…` "assert" calls: find-or-create and update-in-place in one request, so the handler is idempotent and safe under Cal.com's webhook retries. Status-only events without attendee data (flat `MEETING_ENDED` payloads) update the existing entry via query + PATCH instead.
- Terminal statuses (`cancelled` / `completed` / `no_show`) never regress to `confirmed` — webhook deliveries are unordered and retried.
- Reschedules that mint a new booking UID mark the old entry `cancelled` (via `rescheduleUid`) so nothing dangles.
- Multiple attendees: all get person records; the first becomes the entry's parent.

## Tests

```sh
bun test
```

## License

MIT
