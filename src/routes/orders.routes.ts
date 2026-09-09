import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import { markOrderDelivered, revertOrderDelivery } from "../services/orders.service.js";
import { notifyOrderDelivered } from "../services/notify.service.js";

const orders = new Hono<{ Variables: AuthVariables }>();

orders.use(requireAuth);

/**
 * PATCH /api/orders/:id/deliver
 * Mark an order as DELIVERED (requires payment to be PAID).
 */
orders.patch("/:id/deliver", async (c) => {
  const id = c.req.param("id");
  const result = await markOrderDelivered(id);
  if (!result.ok) return c.json({ error: result.error }, 422);
  const notified = await notifyOrderDelivered(result.data.orderId);
  return c.json({ ...result.data, notified });
});

/**
 * PATCH /api/orders/:id/revert-delivery
 * Revert a DELIVERED order back to IN_PROGRESS.
 */
orders.patch("/:id/revert-delivery", async (c) => {
  const id = c.req.param("id");
  const result = await revertOrderDelivery(id);
  if (!result.ok) return c.json({ error: result.error }, 422);
  return c.json(result.data);
});

export default orders;
