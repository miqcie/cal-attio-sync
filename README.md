# cal-attio-sync

Free, self-hosted Cal.com → Attio booking sync. A single webhook handler that:

1. receives Cal.com booking webhooks (created / rescheduled / cancelled / no-show / meeting ended),
2. finds or creates the Attio **person** by attendee email,
3. upserts a record in a custom Attio **Bookings** object, keyed on the Cal.com booking UID — so cancellations and reschedules update the same record instead of duplicating it.

No database. Attio is the store. Runs on [Val.town](https://val.town) or Cloudflare Workers (free tiers of either) — the core is platform-agnostic Web-standard TypeScript.

## Setup

### 1. Create the Bookings object in Attio

Get a workspace API key from Attio → Settings → Developers, then:

```sh
ATTIO_API_KEY=... bun scripts/setup-attio.ts
```

Idempotent — creates the `bookings` object with `booking_uid` (unique), `title`, `starts_at`, `ends_at`, `status` (confirmed / rescheduled / cancelled / no_show / completed), `attendee` (→ People), `organizer_email`, `location`, `cancellation_reason`, `form_responses`.

### 2. Deploy the handler

Pick a webhook secret (any random string). You'll set it in both places.

**Val.town** — create an HTTP val from `main.tsx` + `src/` (or use the [`vt` CLI](https://docs.val.town/vt) to push this repo), then set `ATTIO_API_KEY` and `CAL_WEBHOOK_SECRET` in the val's Environment Variables. Your endpoint is the val's URL.

**Cloudflare Workers**:

```sh
wrangler secret put ATTIO_API_KEY
wrangler secret put CAL_WEBHOOK_SECRET
wrangler deploy
```

### 3. Point Cal.com at it

Either in the UI (Settings → Developer → Webhooks: subscriber URL = your endpoint, secret = the one you picked, enable the five booking/meeting triggers), or with an API key from Settings → Developer → API keys:

```sh
CAL_API_KEY=... bun scripts/setup-cal.ts https://your-endpoint.example.com <webhook-secret>
```

### 4. Verify

Book a test event. Within a second or two you should see a new Booking record in Attio linked to the attendee's person record. Cancel it — the same record flips to `cancelled`.

## How it works

- `src/core.ts` — signature verification (HMAC-SHA256 of the raw body vs `X-Cal-Signature-256`), payload normalization (Cal.com uses a nested payload for `BOOKING_*` events but a flat one for `MEETING_ENDED`), event → status mapping.
- `src/attio.ts` — thin Attio v2 client. Everything is a `PUT … ?matching_attribute=…` "assert" call: find-or-create and update-in-place in one request, so the handler is idempotent and safe under Cal.com's webhook retries.
- Reschedules that mint a new booking UID mark the old record `cancelled` (via `rescheduleUid`) so nothing dangles.
- Multiple attendees: all get person records; the first is linked as the booking's `attendee`.

## Tests

```sh
bun test
```

## License

MIT
