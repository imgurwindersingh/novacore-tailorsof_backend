/**
 * Public routes — no authentication required.
 * These endpoints expose a limited, read-only view of client data
 * intended for the shareable client profile link.
 */
import { Hono } from "hono";
import { getClientDetail } from "../services/clients.service.js";

const publicRoutes = new Hono();

/**
 * GET /api/public/clients/:id
 *
 * Returns a read-only subset of client data suitable for a public profile page:
 * name, orders (status, items, payment status, totals) and measurements.
 * Sensitive fields like mobile, email, address and notes are omitted.
 */
publicRoutes.get("/clients/:id", async (c) => {
  const id = c.req.param("id");
  const result = await getClientDetail(id);
  if (!result.ok) return c.json({ error: "Client not found" }, 404);

  const client = result.data;

  // Strip personally identifiable / sensitive fields before returning
  return c.json({
    id: client.id,
    fullName: client.fullName,
    createdAt: client.createdAt,
    generalMeasurement: client.generalMeasurement,
    shirtMeasurement: client.shirtMeasurement,
    pantMeasurement: client.pantMeasurement,
    orders: client.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalPaise: order.totalPaise,
      paidPaise: order.paidPaise,
      duePaise: order.duePaise,
      expectedDelivery: order.expectedDelivery,
      notes: order.notes,
      createdAt: order.createdAt,
      items: order.items,
      // Payments are intentionally excluded from the public view
    })),
  });
});

export default publicRoutes;
