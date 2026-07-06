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
  attendee?: string; // person record_id — becomes the list entry's parent record
  organizer_email?: string;
  location?: string;
  cancellation_reason?: string;
  form_responses?: string;
}

/**
 * Idempotent upsert of a booking, stored as an entry in the "bookings" list
 * (parented to People — Attio's free plan doesn't allow custom objects).
 *
 * Deliberately NOT Attio's assert endpoint: PUT /lists/{list}/entries matches
 * on the PARENT record regardless of matching_attribute, so a person's second
 * booking would overwrite their first. Instead: query by booking_uid, then
 * PATCH the match or POST a fresh entry. Retries stay idempotent via the
 * query, and booking_uid's uniqueness constraint backstops the rare race.
 */
export async function assertBooking(apiKey: string, booking: BookingValues) {
  const { attendee, ...rest } = booking;
  const entry_values: Record<string, unknown> = Object.fromEntries(
    // != null drops both null and undefined — Cal.com sends explicit nulls (e.g. cancellationReason).
    Object.entries(rest).filter(([, v]) => v != null && v !== ""),
  );
  const existing = await findBookingEntry(apiKey, booking.booking_uid);
  if (existing) {
    return attio(apiKey, "PATCH", `/lists/bookings/entries/${existing.entryId}`, {
      data: { entry_values },
    });
  }
  // A list entry needs a parent record; without an attendee there's nothing to create.
  if (!attendee) return null;
  return attio(apiKey, "POST", "/lists/bookings/entries", {
    data: { parent_record_id: attendee, parent_object: "people", entry_values },
  });
}

async function findBookingEntry(
  apiKey: string,
  bookingUid: string,
): Promise<{ entryId: string; status: string | null } | null> {
  const res = await attio(apiKey, "POST", "/lists/bookings/entries/query", {
    filter: { booking_uid: bookingUid },
    limit: 1,
  });
  const entry = res?.data?.[0];
  if (!entry) return null;
  return {
    entryId: entry.id.entry_id,
    status: entry.entry_values?.status?.[0]?.option?.title ?? null,
  };
}

/** Current status of a booking entry, or null if it doesn't exist. */
export async function getBookingStatus(apiKey: string, bookingUid: string): Promise<string | null> {
  return (await findBookingEntry(apiKey, bookingUid))?.status ?? null;
}

// --- setup helpers (used by scripts/setup-attio.ts) ---

export async function createList(apiKey: string) {
  return attio(apiKey, "POST", "/lists", {
    data: {
      name: "Bookings",
      api_slug: "bookings",
      parent_object: "people",
      workspace_access: "full-access",
      workspace_member_access: [],
    },
  });
}

export async function createAttribute(apiKey: string, attr: Record<string, unknown>) {
  return attio(apiKey, "POST", "/lists/bookings/attributes", { data: attr });
}

export async function createSelectOption(apiKey: string, attribute: string, title: string) {
  return attio(apiKey, "POST", `/lists/bookings/attributes/${attribute}/options`, {
    data: { title },
  });
}

export async function getList(apiKey: string): Promise<unknown | null> {
  try {
    return await attio(apiKey, "GET", "/lists/bookings");
  } catch (e) {
    if (e instanceof AttioError && e.status === 404) return null;
    throw e;
  }
}
