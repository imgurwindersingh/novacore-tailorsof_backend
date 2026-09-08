/**
 * Public routes — no authentication required.
 * These endpoints expose a limited, read-only view of client data
 * intended for the shareable client profile link.
 */
import { Hono } from "hono";
import { getClientDetail } from "../services/clients.service.js";
import { prisma } from "../lib/prisma.js";

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

/**
 * PATCH /api/public/orders/:orderId/items/:itemId
 * Update design image URL or reference URL for an order item.
 * No auth required (public page).
 */
publicRoutes.patch("/orders/:orderId/items/:itemId", async (c) => {
  const { orderId, itemId } = c.req.param();
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { designImageUrl, designReferenceUrl } = body as {
    designImageUrl?: string | null;
    designReferenceUrl?: string | null;
  };

  // Verify the item belongs to the order
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId },
  });
  if (!item) return c.json({ error: "Order item not found" }, 404);

  const updated = await prisma.orderItem.update({
    where: { id: itemId },
    data: {
      ...(designImageUrl !== undefined ? { designImageUrl: designImageUrl || null } : {}),
      ...(designReferenceUrl !== undefined ? { designReferenceUrl: designReferenceUrl || null } : {}),
    },
  });

  return c.json({
    id: updated.id,
    designImageUrl: updated.designImageUrl,
    designReferenceUrl: updated.designReferenceUrl,
  });
});

export default publicRoutes;
