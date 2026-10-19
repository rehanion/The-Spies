import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache binding: every page that reads the database is dynamic,
// and an R2/KV cache would add a service to manage. Static assets are served
// by Workers Static Assets.
export default defineCloudflareConfig();
