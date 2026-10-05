import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./actions/travel.js"; // registers the travel action handler
import "./actions/disconnect.js"; // registers the disconnect action handler
import "./actions/layout.js"; // registers the layout action handler
import { playersRoute } from "./routes/players.js";
import { routesRoute } from "./routes/routes.js";
import { actionsRoute } from "./routes/actions.js";
import { buildingsRoute } from "./routes/buildings.js";
import { zonesRoute } from "./routes/zones.js";
import { baseRoute } from "./routes/base.js";
import { infrastructureRoute } from "./routes/infrastructure.js";

const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.route("/players", playersRoute);
app.route("/routes", routesRoute);
app.route("/actions", actionsRoute);
app.route("/buildings", buildingsRoute);
app.route("/zones", zonesRoute);
app.route("/infrastructure", infrastructureRoute);
app.route("/base", baseRoute);

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
