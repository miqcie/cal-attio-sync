// Platform-agnostic Cal.com → Attio webhook handler.
// Entry points (Val.town main.tsx, Cloudflare worker.ts) just call handleRequest().

import { assertBooking, assertPerson, getBookingStatus, type BookingValues } from "./attio.ts";

export interface Env {
  ATTIO_API_KEY: string;
  CAL_WEBHOOK_SECRET: string;
}

const STATUS_BY_EVENT: Record<string, string> = {
  BOOKING_CREATED: "confirmed",
  BOOKING_RESCHEDULED: "confirmed", // the new booking is the active one; the old uid gets cancelled below
  BOOKING_CANCELLED: "cancelled",
  MEETING_ENDED: "completed",
  // BOOKING_NO_SHOW_UPDATED handled specially (payload says who no-showed)
};

// Terminal states never regress to "confirmed" — webhook deliveries are unordered and retried.
const TERMINAL = new Set(["cancelled", "completed", "no_show"]);

/** Timing-safe HMAC-SHA256 verification of Cal.com's X-Cal-Signature-256 header. Fails closed on a missing secret. */
export async function verifySignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = Uint8Array.from(
    signature.match(/../g)!.map((h) => parseInt(h, 16)),
  );
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(rawBody));
}

interface Attendee {
  email: string;
  name?: string;
  noShow?: boolean;
}

interface NormalizedBooking {
  uid: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  attendees: Attendee[];
  organizerEmail?: string;
  location?: string;
  cancellationReason?: string;
  formResponses?: string;
  rescheduleUid?: string;
}

/**
 * Cal.com uses a nested payload for BOOKING_* events but a flat one for
 * MEETING_STARTED/MEETING_ENDED (booking fields at top level).
 */
export function normalizePayload(body: any): NormalizedBooking | null {
  const p = body?.payload;
  if (!p) return null;
  const uid = p.uid ?? p.bookingUid ?? p.bookingId?.toString();
  if (!uid) return null;
  const attendees: Attendee[] = (p.attendees ?? [])
    .filter((a: any) => a?.email)
    .map((a: any) => ({ email: a.email, name: a.name, noShow: a.noShow }));
  const responses = p.responses ?? p.userFieldsResponses;
  return {
    uid,
    title: p.title ?? p.eventTitle,
    startTime: p.startTime,
    endTime: p.endTime,
    attendees,
    organizerEmail: p.organizer?.email,
    location: p.location,
    cancellationReason: p.cancellationReason,
    formResponses: responses ? JSON.stringify(responses) : undefined,
    rescheduleUid: p.rescheduleUid,
  };
}

export async function handleWebhook(body: any, env: Env): Promise<string> {
  const event: string = body?.triggerEvent;
  const booking = normalizePayload(body);
  if (!event || !booking) return "ignored: no event or booking uid";

  let status = STATUS_BY_EVENT[event];
  if (event === "BOOKING_NO_SHOW_UPDATED") {
    // Payload carries per-attendee noShow flags; without a positive flag, don't guess a status.
    if (!booking.attendees.some((a) => a.noShow)) return "ignored: no-show update without noShow flag";
    status = "no_show";
  }
  if (!status) return `ignored: unhandled event ${event}`;

  // Unordered/retried deliveries must not resurrect a finished booking
  // (e.g. a retried BOOKING_CREATED landing after BOOKING_CANCELLED).
  if (status === "confirmed") {
    const current = await getBookingStatus(env.ATTIO_API_KEY, booking.uid);
    if (current && TERMINAL.has(current)) {
      return `ignored: ${booking.uid} already ${current}`;
    }
  }

  // Assert person records for all attendees; link the first as the booking's attendee.
  let firstPersonId: string | undefined;
  for (const [i, a] of booking.attendees.entries()) {
    const id = await assertPerson(env.ATTIO_API_KEY, a);
    if (i === 0) firstPersonId = id;
  }

  const values: BookingValues = {
    booking_uid: booking.uid,
    title: booking.title,
    starts_at: booking.startTime,
    ends_at: booking.endTime,
    status,
    attendee: firstPersonId,
    organizer_email: booking.organizerEmail,
    location: booking.location,
    cancellation_reason: booking.cancellationReason,
    form_responses: booking.formResponses,
  };
  await assertBooking(env.ATTIO_API_KEY, values);

  // A reschedule that minted a new uid leaves the old booking dangling — mark it cancelled.
  if (event === "BOOKING_RESCHEDULED" && booking.rescheduleUid && booking.rescheduleUid !== booking.uid) {
    await assertBooking(env.ATTIO_API_KEY, {
      booking_uid: booking.rescheduleUid,
      status: "cancelled",
      cancellation_reason: `rescheduled to ${booking.uid}`,
    });
  }

  return `ok: ${event} → ${booking.uid} (${status})`;
}

/** Full HTTP handler: verify signature, parse, sync. Shared by all entry points. */
export async function handleRequest(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response("cal-attio-sync", { status: 200 });
  const rawBody = await req.text();
  const ok = await verifySignature(
    env.CAL_WEBHOOK_SECRET,
    rawBody,
    req.headers.get("x-cal-signature-256"),
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  try {
    const result = await handleWebhook(body, env);
    console.log(result);
    return new Response(result, { status: 200 });
  } catch (e) {
    // Non-2xx makes Cal.com retry the delivery — desired for transient Attio failures.
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
}
