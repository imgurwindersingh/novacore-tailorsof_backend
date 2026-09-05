import { Hono } from "hono";
import { rupeesToPaise } from "../lib/money.js";
import { recordPaymentSchema } from "../lib/validators/client.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import { listPaymentsByClient, recordPayment } from "../services/payments.service.js";

const payments = new Hono<{ Variables: AuthVariables }>();

payments.use("/*", requireAuth);

/**
 * POST /api/payments/orders/:orderId
 * Body: { amount (rupees), method, note }
 * Records a payment against an order.
 */
payments.post("/orders/:orderId", async (c) => {
  const orderId = c.req.param("orderId");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = recordPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  const result = await recordPayment(orderId, {
    amountPaise: rupeesToPaise(parsed.data.amount),
    method: parsed.data.method,
    note: parsed.data.note.trim() === "" ? null : parsed.data.note,
  });

  if (!result.ok) return c.json({ error: result.error }, 422);
  return c.json({ duePaise: result.data.duePaise }, 201);
});

/**
 * GET /api/payments/clients/:clientId
 * Returns all payments for a client across all their orders.
 */
payments.get("/clients/:clientId", async (c) => {
  const clientId = c.req.param("clientId");
  const result = await listPaymentsByClient(clientId);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

export default payments;
