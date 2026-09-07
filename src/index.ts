import "./lib/cjs-globals.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { PrismaClient } from "./lib/prisma-client.js";
import { ensureD1Prisma, prisma, setPrisma } from "./lib/prisma.js";
import authRoutes from "./routes/auth.routes.js";
import clientRoutes from "./routes/clients.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import orderRoutes from "./routes/orders.routes.js";
import paymentRoutes from "./routes/payments.routes.js";
import publicRoutes from "./routes/public.routes.js";
import uploadRoutes from "./routes/uploads.routes.js";
import { buildOpenApiSpec, renderSwaggerHtml } from "./lib/openapi.js";

type Bindings = {
  DB?: ConstructorParameters<typeof import("@prisma/adapter-d1").PrismaD1>[0];
};

const app = new Hono<{ Bindings: Bindings }>();

// D1 is the production database on Cloudflare Workers. Never load better-sqlite3 there —
// that native adapter references Node's `__filename` and crashes ESM/Workers.
app.use("*", async (c, next) => {
  if (c.env?.DB) ensureD1Prisma(c.env.DB);
  await next();
});

// ── Global middleware ──────────────────────────────────────────────────────────

const SNAPDEPLOY_BACKEND = "https://tailorsof-dac06.containers.snapdeploy.app";

const allowedOrigins = [
  process.env.FRONTEND_URL,
  SNAPDEPLOY_BACKEND,
  "https://novacore-tailorsof-frontend.gora55039.workers.dev",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:19006",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
].filter(Boolean) as string[];

function corsOrigin(origin: string): string {
  if (!origin) return allowedOrigins[0] ?? "http://localhost:3000";
  if (
    allowedOrigins.includes(origin) ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.endsWith(".workers.dev") ||
    origin.endsWith(".snapdeploy.app")
  ) {
    return origin;
  }
  return origin;
}

app.use(
  "/*",
  cors({
    origin: corsOrigin,
    allowHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.use("/*", logger());

// ── Favicon ───────────────────────────────────────────────────────────────────

const SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="#0f172a"/>
  <path d="M10 22L22 10M22 22L10 10" stroke="url(#g)" stroke-width="2.8" stroke-linecap="round"/>
  <circle cx="8" cy="8" r="2.5" fill="#10b981"/>
  <circle cx="24" cy="8" r="2.5" fill="#10b981"/>
</svg>`;

app.get("/favicon.ico", (c) => {
  return c.body(SVG_FAVICON, 200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "public, max-age=86400",
  });
});

// ── Health check ──────────────────────────────────────────────────────────────

async function getHealthStatus() {
  let dbStatus = "connected";
  let dbLatencyMs = 0;
  let dbError: string | undefined;
  try {
    const start = performance.now();
    await prisma.user.count();
    dbLatencyMs = Math.round(performance.now() - start);
  } catch (err) {
    dbStatus = "disconnected";
    dbError = err instanceof Error ? err.message : String(err);
    console.error("[health] Database ping failed:", err);
  }

  const memory = process.memoryUsage();
  return {
    status: dbStatus === "connected" ? "ok" : "degraded",
    service: "novacore-tailorsof-backend",
    version: "1.0.0",
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
      ...(dbError ? { error: dbError } : {}),
    },
    system: {
      nodeVersion: process.version,
      memoryRssMb: Math.round(memory.rss / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
    },
    timestamp: new Date().toISOString(),
  };
}

app.get("/health", async (c) => {
  const health = await getHealthStatus();
  return c.json(
    {
      ...health,
      hasD1: Boolean(c.env?.DB),
    },
    health.status === "ok" ? 200 : 503
  );
});

app.get("/openapi.json", (c) => {
  const requestUrl = new URL(c.req.url);
  const serverUrl = process.env.BACKEND_URL || requestUrl.origin;
  return c.json(buildOpenApiSpec(serverUrl));
});

app.get("/docs", (c) => {
  return c.html(renderSwaggerHtml("/openapi.json"));
});

app.get("/swagger", (c) => c.redirect("/docs"));

app.get("/api/health", async (c) => {
  const health = await getHealthStatus();
  return c.json(health, health.status === "ok" ? 200 : 503);
});

// ── Root Endpoint (/ and /api) ────────────────────────────────────────────────

const ENDPOINTS_CATALOG = [
  { group: "System", method: "GET", path: "/docs", auth: false, desc: "Swagger UI — try endpoints with JWT Authorize" },
  { group: "System", method: "GET", path: "/openapi.json", auth: false, desc: "OpenAPI 3 specification" },
  { group: "System", method: "GET", path: "/health", auth: false, desc: "Server and SQLite health status & metrics" },
  { group: "Auth", method: "POST", path: "/api/auth/login", auth: false, desc: "Authenticate with email & password, returns JWT session token" },
  { group: "Auth", method: "GET", path: "/api/auth/me", auth: true, desc: "Get current authenticated user profile" },
  { group: "Auth", method: "POST", path: "/api/auth/refresh", auth: false, desc: "Exchange a valid refresh token for a new access token + rotated refresh token" },
  { group: "Auth", method: "POST", path: "/api/auth/logout", auth: false, desc: "Revoke the supplied refresh token and end the current session" },
  { group: "Auth", method: "POST", path: "/api/auth/logout-all", auth: true, desc: "Revoke all refresh tokens for the authenticated user (sign out everywhere)" },
  { group: "Clients", method: "GET", path: "/api/clients", auth: true, desc: "List paginated clients with search query (?q= & ?page=)" },
  { group: "Clients", method: "GET", path: "/api/clients/:id", auth: true, desc: "Get client detail with all measurements and order history" },
  { group: "Clients", method: "POST", path: "/api/clients", auth: true, desc: "Create client wizard (profile + measurements + first order)" },
  { group: "Clients", method: "PUT", path: "/api/clients/:id", auth: true, desc: "Update client profile details and measurements" },
  { group: "Clients", method: "DELETE", path: "/api/clients/:id", auth: true, desc: "Delete client and associated measurement records" },
  { group: "Clients", method: "POST", path: "/api/clients/:clientId/orders", auth: true, desc: "Add a new order to an existing client" },
  { group: "Dashboard", method: "GET", path: "/api/dashboard/stats", auth: true, desc: "Aggregate statistics: client count, active orders, revenue" },
  { group: "Dashboard", method: "GET", path: "/api/dashboard/recent-clients", auth: true, desc: "Fetch recently registered clients (?limit=5)" },
  { group: "Dashboard", method: "GET", path: "/api/dashboard/upcoming-deliveries", auth: true, desc: "Upcoming deliveries schedule (?limit=10)" },
  { group: "Orders", method: "PATCH", path: "/api/orders/:id/deliver", auth: true, desc: "Mark completed order as delivered (requires payment cleared)" },
  { group: "Orders", method: "PATCH", path: "/api/orders/:id/revert-delivery", auth: true, desc: "Revert order status from delivered to in-progress" },
  { group: "Payments", method: "POST", path: "/api/payments/orders/:orderId", auth: true, desc: "Record a payment against an order (CASH, UPI, CARD, OTHER)" },
  { group: "Payments", method: "GET", path: "/api/payments/clients/:clientId", auth: true, desc: "Retrieve all payment transactions for a client" },
  { group: "Public", method: "GET", path: "/api/public/clients/:id", auth: false, desc: "Public read-only client profile: name, measurements & order summary (no auth required)" },
];

function renderDashboardHtml(baseUrl: string, uptime: number) {
  const rows = ENDPOINTS_CATALOG.map((ep) => {
    const badgeColor =
      ep.method === "GET"
        ? "background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);"
        : ep.method === "POST"
          ? "background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);"
          : ep.method === "PUT"
            ? "background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);"
            : ep.method === "PATCH"
              ? "background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);"
              : "background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);";

    const pathHtml = !ep.auth && ep.method === "GET"
      ? `<a href="${ep.path}" target="_blank" style="color: #60a5fa; text-decoration: none; font-weight: 500;">${ep.path} ↗</a>`
      : `<code style="color: #cbd5e1; font-family: ui-monospace, monospace; font-size: 0.9em;">${ep.path}</code>`;

    const authBadge = ep.auth
      ? `<span style="padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.25);">Bearer Auth</span>`
      : `<span style="padding: 2px 8px; border-radius: 9999px; font-size: 0.72rem; background: rgba(100, 116, 139, 0.2); color: #94a3b8;">Public</span>`;

    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
        <td style="padding: 12px 16px;"><span style="display:inline-block; font-family: ui-monospace, monospace; font-size: 0.75rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; ${badgeColor}">${ep.method}</span></td>
        <td style="padding: 12px 16px;">${pathHtml}</td>
        <td style="padding: 12px 16px;">${authBadge}</td>
        <td style="padding: 12px 16px; color: #94a3b8; font-size: 0.88rem;">${ep.desc}</td>
      </tr>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TailorSoft API — Operational</title>
  <link rel="icon" href="/favicon.ico" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090d16;
      color: #f1f5f9;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      padding: 32px 20px;
      line-height: 1.5;
    }
    .container {
      max-width: 1080px;
      margin: 0 auto;
    }
    .header {
      background: radial-gradient(circle at 10% 20%, rgba(16, 185, 129, 0.12) 0%, transparent 40%),
                  radial-gradient(circle at 90% 80%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
                  #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 36px 32px;
      margin-bottom: 28px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5);
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #34d399;
      box-shadow: 0 0 10px #34d399;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    .title {
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #ffffff 40%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 1rem;
      max-width: 600px;
    }
    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .stat-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 14px 18px;
    }
    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 1.05rem;
      font-weight: 700;
      color: #f8fafc;
      font-family: 'JetBrains Mono', monospace;
      word-break: break-all;
    }
    .card {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 18px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 10px 30px -10px rgba(0,0,0,0.3);
    }
    .card-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .table-wrap {
      overflow-x: auto;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th {
      background: rgba(255, 255, 255, 0.03);
      padding: 12px 16px;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .code-box {
      background: #070a12;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #38bdf8;
      overflow-x: auto;
      position: relative;
    }
    .quick-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #10b981;
      color: #042f2e;
      font-weight: 700;
      font-size: 0.85rem;
      padding: 8px 16px;
      border-radius: 8px;
      text-decoration: none;
      transition: background 0.15s;
    }
    .quick-btn:hover {
      background: #34d399;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge-status">
        <span class="pulse"></span> Server Operational
      </div>
      <h1 class="title">TailorSoft REST API</h1>
      <p class="subtitle">High-performance backend service powered by Hono + Prisma + SQLite. Ready to serve client requests and API consumers.</p>

      <div class="grid-stats">
        <div class="stat-card">
          <div class="stat-label">Host URL</div>
          <div class="stat-value" style="font-size: 0.92rem;">${baseUrl}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Database</div>
          <div class="stat-value" style="color: #34d399;">SQLite (Active)</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Environment</div>
          <div class="stat-value">${process.env.NODE_ENV || "production"}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime</div>
          <div class="stat-value">${uptime}s</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>Available API Routes</span>
        <a href="/docs" class="quick-btn">Open Swagger UI ↗</a>
        <a href="/health" class="quick-btn">Check Health JSON ↗</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint Path</th>
              <th>Access</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Quick Test Command</div>
      <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 12px;">Test authentication and receive a valid session token:</p>
      <div class="code-box">curl -X POST ${baseUrl}/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@tailorsoft.dev","password":"admin123"}'</div>
    </div>
  </div>
</body>
</html>`;
}

app.get("/", (c) => {
  const acceptHeader = c.req.header("Accept") ?? "";
  const isHtml = acceptHeader.includes("text/html");
  const requestUrl = new URL(c.req.url);
  const baseUrl = process.env.BACKEND_URL || requestUrl.origin;

  if (isHtml) {
    const uptime = Math.floor(process.uptime());
    return c.html(renderDashboardHtml(baseUrl, uptime));
  }

  return c.json({
    success: true,
    service: "novacore-tailorsof-backend",
    name: "TailorSoft REST API",
    version: "1.0.0",
    status: "online",
    url: baseUrl,
    productionUrl: process.env.BACKEND_URL || SNAPDEPLOY_BACKEND,
    environment: process.env.NODE_ENV ?? "development",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    endpoints: ENDPOINTS_CATALOG,
    documentation: "https://github.com/imgurwindersingh/novacore-tailorsof_backend",
  });
});

app.get("/api", (c) => {
  return c.json({
    success: true,
    name: "TailorSoft REST API",
    version: "1.0.0",
    status: "online",
    endpoints: ENDPOINTS_CATALOG,
  });
});

// ── API routes ────────────────────────────────────────────────────────────────

app.route("/api/auth", authRoutes);
app.route("/api/clients", clientRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/orders", orderRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/uploads", uploadRoutes);

// ── 404 fallback ──────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json(
    {
      error: "Not found",
      message: `The route ${c.req.method} ${c.req.path} does not exist.`,
      availableEndpoints: "/api",
      documentation: "/",
    },
    404
  );
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("[unhandled error]", err);
  return c.json(
    {
      error: "Internal server error",
      message: err instanceof Error ? err.message : String(err),
    },
    500
  );
});

// ── Start server (Node.js runtime only) ───────────────────────────────────────

const g = globalThis as unknown as {
  navigator?: { userAgent?: string };
  caches?: { default?: unknown };
};

const isCloudflareWorker =
  Boolean(g.navigator?.userAgent?.includes("Cloudflare-Workers")) ||
  Boolean(g.caches && "default" in g.caches);

const isNodeRuntime = !isCloudflareWorker && typeof process !== "undefined" && Boolean(process.versions?.node);

async function startNodeServer() {
  const [{ serve }, { PrismaBetterSqlite3 }] = await Promise.all([
    import("@hono/node-server"),
    import("@prisma/adapter-better-sqlite3"),
  ]);
  await import("dotenv/config");

  setPrisma(
    new PrismaClient({
      adapter: new PrismaBetterSqlite3({
        url: process.env.DATABASE_URL ?? "file:./dev.db",
      }),
    })
  );

  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`🚀 Backend running on http://localhost:${info.port}`);
  });
}

if (isNodeRuntime) {
  await startNodeServer();
}

export default {
  async fetch(request: Request, env: Bindings, ctx?: Parameters<typeof app.fetch>[2]) {
    if (env?.DB) ensureD1Prisma(env.DB);
    return app.fetch(request, env, ctx);
  },
};
