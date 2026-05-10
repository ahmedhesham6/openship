import { serve } from "@hono/node-server";
import { app } from "./app";
import { env } from "./config/env";

const port = env.PORT;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 Openship API running on http://localhost:${info.port}`);
});
