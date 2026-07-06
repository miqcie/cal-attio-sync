// One-shot, idempotent setup: creates the "Bookings" object and its attributes in Attio.
// Usage: ATTIO_API_KEY=... bun scripts/setup-attio.ts

import {
  AttioError,
  createAttribute,
  createObject,
  createSelectOption,
  getObject,
} from "../src/attio.ts";

const apiKey = process.env.ATTIO_API_KEY;
if (!apiKey) {
  console.error("Set ATTIO_API_KEY");
  process.exit(1);
}

const text = (slug: string, title: string, extra: Record<string, unknown> = {}) => ({
  api_slug: slug,
  title,
  type: "text",
  is_required: false,
  is_unique: false,
  is_multiselect: false,
  ...extra,
});

const ATTRIBUTES: Record<string, unknown>[] = [
  text("booking_uid", "Booking UID", { is_unique: true }),
  text("title", "Title"),
  { ...text("starts_at", "Starts at"), type: "timestamp" },
  { ...text("ends_at", "Ends at"), type: "timestamp" },
  { ...text("status", "Status"), type: "select" },
  {
    ...text("attendee", "Attendee"),
    type: "record-reference",
    config: { record_reference: { allowed_objects: ["people"] } },
  },
  text("organizer_email", "Organizer email"),
  text("location", "Location"),
  text("cancellation_reason", "Cancellation reason"),
  text("form_responses", "Form responses"),
];

const STATUS_OPTIONS = ["confirmed", "rescheduled", "cancelled", "no_show", "completed"];

const existing = await getObject(apiKey);
if (existing) {
  console.log("Bookings object already exists — skipping object creation.");
} else {
  await createObject(apiKey);
  console.log("Created Bookings object.");
}

for (const attr of ATTRIBUTES) {
  try {
    await createAttribute(apiKey, attr);
    console.log(`Created attribute: ${attr.api_slug}`);
  } catch (e) {
    if (e instanceof AttioError && e.status === 409) {
      console.log(`Attribute exists: ${attr.api_slug}`);
    } else throw e;
  }
}

for (const title of STATUS_OPTIONS) {
  try {
    await createSelectOption(apiKey, "status", title);
    console.log(`Created status option: ${title}`);
  } catch (e) {
    if (e instanceof AttioError && e.status === 409) {
      console.log(`Status option exists: ${title}`);
    } else throw e;
  }
}

console.log("Done.");
