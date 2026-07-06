// Minimal Attio v2 API client using Web-standard fetch (runs on Val.town, Workers, Bun).

const BASE = "https://api.attio.com/v2";

export class AttioError extends Error {
  constructor(public status: number, body: string) {
    super(`Attio ${status}: ${body}`);
  }
}

async function attio(apiKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new AttioError(res.status, text);
  return text ? JSON.parse(text) : null;
}

/** Find-or-create a person by email. Returns the person's record_id. */
export async function assertPerson(
  apiKey: string,
  attendee: { email: string; name?: string },
): Promise<string> {
  const values: Record<string, unknown> = { email_addresses: [attendee.email] };
  if (attendee.name) {
    // Attio's people.name is a personal-name type: structured, not a bare string.
    const [first, ...rest] = attendee.name.trim().split(/\s+/);
    values.name = [{
      first_name: first,
      last_name: rest.join(" ") || undefined,
      full_name: attendee.name,
    }];
  }
  const res = await attio(
    apiKey,
    "PUT",
    "/objects/people/records?matching_attribute=email_addresses",
    { data: { values } },
  );
  return res.data.id.record_id;
}

export interface BookingValues {
  booking_uid: string;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  status?: string;
  attendee?: string; // person record_id
  organizer_email?: string;
  location?: string;
  cancellation_reason?: string;
  form_responses?: string;
}

/** Idempotent upsert of a booking record keyed on booking_uid. */
export async function assertBooking(apiKey: string, booking: BookingValues) {
  const { attendee, ...rest } = booking;
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined && v !== ""),
  );
  if (attendee) {
    values.attendee = [{ target_object: "people", target_record_id: attendee }];
  }
  return attio(
    apiKey,
    "PUT",
    "/objects/bookings/records?matching_attribute=booking_uid",
    { data: { values } },
  );
}

/** Current status of a booking record, or null if the record doesn't exist. */
export async function getBookingStatus(apiKey: string, bookingUid: string): Promise<string | null> {
  const res = await attio(apiKey, "POST", "/objects/bookings/records/query", {
    filter: { booking_uid: bookingUid },
    limit: 1,
  });
  const status = res?.data?.[0]?.values?.status?.[0];
  return status?.option?.title ?? null;
}

// --- setup helpers (used by scripts/setup-attio.ts) ---

export async function createObject(apiKey: string) {
  return attio(apiKey, "POST", "/objects", {
    data: { api_slug: "bookings", singular_noun: "Booking", plural_noun: "Bookings" },
  });
}

export async function createAttribute(apiKey: string, attr: Record<string, unknown>) {
  return attio(apiKey, "POST", "/objects/bookings/attributes", { data: attr });
}

export async function createSelectOption(apiKey: string, attribute: string, title: string) {
  return attio(apiKey, "POST", `/objects/bookings/attributes/${attribute}/options`, {
    data: { title },
  });
}

export async function getObject(apiKey: string): Promise<unknown | null> {
  try {
    return await attio(apiKey, "GET", "/objects/bookings");
  } catch (e) {
    if (e instanceof AttioError && e.status === 404) return null;
    throw e;
  }
}
