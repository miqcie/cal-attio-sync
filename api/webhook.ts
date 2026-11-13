// Vercel Function entry. Set env vars with: vercel env add ATTIO_API_KEY / CAL_WEBHOOK_SECRET
// .js specifiers: Vercel's Node build emits .js files and does not rewrite .ts imports.
import { handleRequest } from "../src/core.js";

declare const process: { env: Record<string, string | undefined> }; // avoids an @types/node dependency

const handle = (req: Request) =>
  handleRequest(req, {
    ATTIO_API_KEY: process.env.ATTIO_API_KEY ?? "",
    CAL_WEBHOOK_SECRET: process.env.CAL_WEBHOOK_SECRET ?? "",
  });

export const GET = handle;
export const POST = handle;
