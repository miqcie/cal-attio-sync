// Cloudflare Worker entry. Set secrets with: wrangler secret put ATTIO_API_KEY / CAL_WEBHOOK_SECRET
import { handleRequest, type Env } from "./src/core.ts";

export default {
  fetch: (req: Request, env: Env) => handleRequest(req, env),
};
