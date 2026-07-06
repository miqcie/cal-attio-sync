import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleRequest, normalizePayload, verifySignature, type Env } from "../src/core.ts";

const env: Env = { ATTIO_API_KEY: "test-attio-key", CAL_WEBHOOK_SECRET: "test-secret" };

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- fetch mock: records every Attio call ---
interface RecordedCall {
  method: string;
  url: string;
  body: any;
}
let calls: RecordedCall[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ method: init.method, url: String(url), body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ data: { id: { record_id: "person-123" }, values: {} } }),
      { status: 200 },
    );
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function webhookBody(triggerEvent: string, payload: Record<string, unknown>) {
  return JSON.stringify({ triggerEvent, createdAt: "2026-07-06T12:00:00Z", payload });
}

async function post(body: string, signature?: string): Promise<Response> {
  const sig = signature ?? (await sign(env.CAL_WEBHOOK_SECRET, body));
  return handleRequest(
    new Request("https://example.com/", {
      method: "POST",
      headers: { "x-cal-signature-256": sig },
      body,
    }),
    env,
  );
}

const baseBooking = {
  uid: "abc123",
  title: "Intro call",
  startTime: "2026-07-10T15:00:00Z",
  endTime: "2026-07-10T15:30:00Z",
  attendees: [{ email: "jane@example.com", name: "Jane Doe", timeZone: "America/New_York" }],
  organizer: { email: "chris@caldris.io", name: "Chris" },
  location: "https://cal.com/video/abc123",
  responses: { notes: { value: "Interested in CMMC" } },
};

function bookingUpsert(): RecordedCall | undefined {
  return calls.find((c) => c.url.includes("/objects/bookings/records"));
}
function personUpserts(): RecordedCall[] {
  return calls.filter((c) => c.url.includes("/objects/people/records"));
}

describe("verifySignature", () => {
  test("accepts a valid signature", async () => {
    const body = "hello";
    expect(await verifySignature("s", body, await sign("s", body))).toBe(true);
  });
  test("rejects a bad signature", async () => {
    expect(await verifySignature("s", "hello", "deadbeef")).toBe(false);
  });
  test("rejects a missing signature", async () => {
    expect(await verifySignature("s", "hello", null)).toBe(false);
  });
});

describe("handleRequest", () => {
  test("401 on wrong signature, no Attio calls", async () => {
    const res = await post(webhookBody("BOOKING_CREATED", baseBooking), "0".repeat(64));
    expect(res.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  test("GET returns 200 without touching Attio", async () => {
    const res = await handleRequest(new Request("https://example.com/"), env);
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });

  test("BOOKING_CREATED asserts person and booking", async () => {
    const res = await post(webhookBody("BOOKING_CREATED", baseBooking));
    expect(res.status).toBe(200);

    const person = personUpserts()[0];
    expect(person.method).toBe("PUT");
    expect(person.url).toContain("matching_attribute=email_addresses");
    expect(person.body.data.values.email_addresses).toEqual(["jane@example.com"]);

    const booking = bookingUpsert()!;
    expect(booking.method).toBe("PUT");
    expect(booking.url).toContain("matching_attribute=booking_uid");
    const v = booking.body.data.values;
    expect(v.booking_uid).toBe("abc123");
    expect(v.status).toBe("confirmed");
    expect(v.attendee).toEqual([{ target_object: "people", target_record_id: "person-123" }]);
    expect(JSON.parse(v.form_responses).notes.value).toBe("Interested in CMMC");
  });

  test("BOOKING_CANCELLED sets status and reason", async () => {
    await post(
      webhookBody("BOOKING_CANCELLED", { ...baseBooking, cancellationReason: "conflict" }),
    );
    const v = bookingUpsert()!.body.data.values;
    expect(v.status).toBe("cancelled");
    expect(v.cancellation_reason).toBe("conflict");
  });

  test("BOOKING_RESCHEDULED with new uid cancels the old booking", async () => {
    await post(
      webhookBody("BOOKING_RESCHEDULED", { ...baseBooking, uid: "new456", rescheduleUid: "abc123" }),
    );
    const bookings = calls.filter((c) => c.url.includes("/objects/bookings/records"));
    expect(bookings.length).toBe(2);
    expect(bookings[0].body.data.values.booking_uid).toBe("new456");
    expect(bookings[0].body.data.values.status).toBe("rescheduled");
    expect(bookings[1].body.data.values.booking_uid).toBe("abc123");
    expect(bookings[1].body.data.values.status).toBe("cancelled");
  });

  test("BOOKING_NO_SHOW_UPDATED maps noShow flag", async () => {
    await post(
      webhookBody("BOOKING_NO_SHOW_UPDATED", {
        ...baseBooking,
        attendees: [{ email: "jane@example.com", noShow: true }],
      }),
    );
    expect(bookingUpsert()!.body.data.values.status).toBe("no_show");
  });

  test("MEETING_ENDED flat payload marks completed", async () => {
    // Flat payload: booking fields at top level, no attendees array in some deliveries.
    await post(
      webhookBody("MEETING_ENDED", {
        bookingUid: "abc123",
        title: "Intro call",
        startTime: baseBooking.startTime,
        endTime: baseBooking.endTime,
      }),
    );
    const v = bookingUpsert()!.body.data.values;
    expect(v.booking_uid).toBe("abc123");
    expect(v.status).toBe("completed");
  });

  test("unhandled event is ignored without Attio calls", async () => {
    const res = await post(webhookBody("FORM_SUBMITTED", { uid: "x" }));
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });
});

describe("normalizePayload", () => {
  test("returns null without a uid", () => {
    expect(normalizePayload({ payload: { title: "no uid" } })).toBeNull();
    expect(normalizePayload({})).toBeNull();
  });
  test("skips attendees without email", () => {
    const n = normalizePayload({
      payload: { uid: "u", attendees: [{ name: "No Email" }, { email: "a@b.co" }] },
    })!;
    expect(n.attendees).toEqual([{ email: "a@b.co", name: undefined, noShow: undefined }]);
  });
});
