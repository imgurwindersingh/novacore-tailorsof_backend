import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import { getDashboardStats } from "../services/stats.service.js";
import { getRecentClients, getUpcomingDeliveries } from "../services/clients.service.js";

const dashboard = new Hono<{ Variables: AuthVariables }>();

// All dashboard routes require auth
dashboard.use(requireAuth);

/**
 * GET /api/dashboard/stats
 * Returns totals: clients, orders in progress, pending amount, collected this month.
 */
dashboard.get("/stats", async (c) => {
  const result = await getDashboardStats();
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

/**
 * GET /api/dashboard/recent-clients?limit=5
 */
dashboard.get("/recent-clients", async (c) => {
  const limit = Number(c.req.query("limit") ?? "5");
  const result = await getRecentClients(isNaN(limit) ? 5 : limit);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

/**
 * GET /api/dashboard/upcoming-deliveries?limit=10
 */
dashboard.get("/upcoming-deliveries", async (c) => {
  const limit = Number(c.req.query("limit") ?? "10");
  const result = await getUpcomingDeliveries(isNaN(limit) ? 10 : limit);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

export default dashboard;
