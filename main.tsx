// Val.town HTTP entry. Set ATTIO_API_KEY and CAL_WEBHOOK_SECRET in the val's environment variables.
import { handleRequest } from "./src/core.ts";

export default async function (req: Request): Promise<Response> {
  return handleRequest(req, {
    ATTIO_API_KEY: Deno.env.get("ATTIO_API_KEY") ?? "",
    CAL_WEBHOOK_SECRET: Deno.env.get("CAL_WEBHOOK_SECRET") ?? "",
  });
}
