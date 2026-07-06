// One-shot, idempotent setup: creates the "Bookings" list (parented to People)
// and its attributes in Attio. A list, not a custom object, so it works on the free plan.
// Usage: ATTIO_API_KEY=... bun scripts/setup-attio.ts

import {
  AttioError,
  createAttribute,
  createList,
  createSelectOption,
  getList,
} from "../src/attio.ts";

const apiKey = process.env.ATTIO_API_KEY;
if (!apiKey) {
  console.error("Set ATTIO_API_KEY");
  process.exit(1);
}

const text = (slug: string, title: string, extra: Record<string, unknown> = {}) => ({
  api_slug: slug,
  title,
  description: "",
  type: "text",
  is_required: false,
  is_unique: false,
  is_multiselect: false,
  config: {},
  ...extra,
});

const ATTRIBUTES: Record<string, unknown>[] = [
  text("booking_uid", "Booking UID", { is_unique: true }),
  text("title", "Title"),
  { ...text("starts_at", "Starts at"), type: "timestamp" },
  { ...text("ends_at", "Ends at"), type: "timestamp" },
  { ...text("status", "Status"), type: "select" },
  // No attendee attribute: the list entry's parent record IS the attendee person.
  text("organizer_email", "Organizer email"),
  text("location", "Location"),
  text("cancellation_reason", "Cancellation reason"),
  text("form_responses", "Form responses"),
];

const STATUS_OPTIONS = ["confirmed", "rescheduled", "cancelled", "no_show", "completed"];

const existing = await getList(apiKey);
if (existing) {
  console.log("Bookings list already exists — skipping list creation.");
} else {
  await createList(apiKey);
  console.log("Created Bookings list.");
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
