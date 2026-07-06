// Creates the Cal.com webhook pointing at your deployed handler.
// Usage: CAL_API_KEY=... bun scripts/setup-cal.ts <subscriber-url> <webhook-secret>

const apiKey = process.env.CAL_API_KEY;
const [subscriberUrl, secret] = process.argv.slice(2);
if (!apiKey || !subscriberUrl || !secret) {
  console.error("Usage: CAL_API_KEY=... bun scripts/setup-cal.ts <subscriber-url> <webhook-secret>");
  process.exit(1);
}

const TRIGGERS = [
  "BOOKING_CREATED",
  "BOOKING_RESCHEDULED",
  "BOOKING_CANCELLED",
  "BOOKING_NO_SHOW_UPDATED",
  "MEETING_ENDED",
];

const res = await fetch(`https://api.cal.com/v1/webhooks?apiKey=${apiKey}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    subscriberUrl,
    eventTriggers: TRIGGERS,
    active: true,
    secret,
  }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`Cal.com ${res.status}: ${body}`);
  process.exit(1);
}
console.log("Webhook created:", body);
