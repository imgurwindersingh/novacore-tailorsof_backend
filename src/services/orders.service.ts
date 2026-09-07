import type { Prisma } from "../lib/prisma-client.js";
import { prisma } from "../lib/prisma.js";
import { err, ok, type CreateOrderDTO, type PaymentStatus, type ServiceResult } from "../lib/types.js";

export function paymentStatusFor(totalPaise: number, paidPaise: number): PaymentStatus {
  if (paidPaise <= 0) return "PENDING";
  if (paidPaise >= totalPaise) return "PAID";
  return "PARTIAL";
}

export async function nextOrderNumberInTx(tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const count = await tx.order.count();
  let n = count + 1;
  let orderNumber = `ORD-${String(n).padStart(4, "0")}`;
  while (await tx.order.findUnique({ where: { orderNumber } })) {
    n += 1;
    orderNumber = `ORD-${String(n).padStart(4, "0")}`;
  }
  return orderNumber;
}

export async function recomputeOrderTotalsInTx(
  tx: Prisma.TransactionClient | typeof prisma = prisma,
  orderId: string
): Promise<{ totalPaise: number; paidPaise: number }> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { select: { quantity: true, unitPricePaise: true } },
      payments: { select: { amountPaise: true } },
    },
  });
  const totalPaise = order.items.reduce((sum, i) => sum + i.quantity * i.unitPricePaise, 0);
  const paidPaise = order.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  await tx.order.update({
    where: { id: orderId },
    data: { totalPaise, paymentStatus: paymentStatusFor(totalPaise, paidPaise) },
  });
  return { totalPaise, paidPaise };
}

export async function markOrderDelivered(
  orderId: string
): Promise<ServiceResult<{ orderId: string; clientId: string }>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, clientId: true, paymentStatus: true },
  });
  if (!order) return err("Order not found");
  if (order.status === "DELIVERED") return err("Order is already delivered");
  if (order.status === "CANCELLED") return err("Cannot deliver a cancelled order");
  if (order.paymentStatus !== "PAID") return err("Cannot mark as delivered: payment is still pending");

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "DELIVERED" },
  });

  return ok({ orderId: order.id, clientId: order.clientId });
}

export async function revertOrderDelivery(
  orderId: string
): Promise<ServiceResult<{ orderId: string; clientId: string }>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, clientId: true },
  });
  if (!order) return err("Order not found");
  if (order.status !== "DELIVERED") return err("Order is not delivered");

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "IN_PROGRESS" },
  });

  return ok({ orderId: order.id, clientId: order.clientId });
}

/**
 * Creates a new order for an existing client.
 * Validates the client exists, calculates totals, records an advance payment
 * if provided, and returns the new order details.
 */
export async function createOrderForClient(
  clientId: string,
  dto: CreateOrderDTO,
  shopId = process.env.DEFAULT_SHOP_ID ?? "default"
): Promise<ServiceResult<{ orderId: string; orderNumber: string; clientId: string }>> {
  const client = await prisma.client.findFirst({ where: { id: clientId, shopId } });
  if (!client) return err("Client not found");

  const totalPaise = dto.items.reduce((sum, i) => sum + i.quantity * i.unitPricePaise, 0);
  if (totalPaise <= 0) return err("Order total must be greater than zero");
  if (dto.advancePaise > totalPaise) return err("Advance cannot exceed the order total");
  if (dto.advancePaise > 0 && !dto.paymentMethod) {
    return err("Select a payment method for the advance");
  }

  try {
    const orderNumber = await nextOrderNumberInTx(prisma);

    const order = await prisma.order.create({
      data: {
        clientId,
        orderNumber,
        totalPaise,
        paymentStatus: paymentStatusFor(totalPaise, dto.advancePaise),
        expectedDelivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : null,
        notes: dto.notes ?? null,
        items: {
          create: dto.items.map((i) => ({
            garmentType: i.garmentType,
            description: i.description,
            designImageUrl: i.designImageUrl,
            designReferenceUrl: i.designReferenceUrl,
            quantity: i.quantity,
            unitPricePaise: i.unitPricePaise,
          })),
        },
        ...(dto.advancePaise > 0 && dto.paymentMethod
          ? {
              payments: {
                create: {
                  amountPaise: dto.advancePaise,
                  method: dto.paymentMethod,
                },
              },
            }
          : {}),
      },
    });

    return ok({ orderId: order.id, orderNumber, clientId });
  } catch (e) {
    console.error("[createOrderForClient]", e);
    return err("Failed to create order");
  }
}
