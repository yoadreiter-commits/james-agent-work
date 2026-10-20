// Deno Deploy entrypoint. Cloudflare Workers can use main.js directly.
import app from "./main.js";
Deno.serve((req) => app.fetch(req));
