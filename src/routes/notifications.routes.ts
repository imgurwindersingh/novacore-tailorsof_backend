import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import { sendNotificationTest } from "../services/notify.service.js";

const notifications = new Hono<{ Variables: AuthVariables }>();
notifications.use(requireAuth);

const testNotificationSchema = z.object({
  mobile: z.string().trim().min(8, "Enter a valid mobile number").max(20),
  event: z.enum(["welcome", "order", "payment", "delivered"]),
});

/**
 * POST /api/notifications/test
 * Sends the configured message shape with safe demo values to a supplied number.
 * This endpoint is protected and intentionally creates no customer, order, or payment records.
 */
notifications.post("/test", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = testNotificationSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);

  const notified = await sendNotificationTest(parsed.data.mobile, parsed.data.event);
  return c.json({ notified });
});

export default notifications;
