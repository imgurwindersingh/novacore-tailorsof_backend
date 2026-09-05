import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { err, ok, type PaymentStatus, type ServiceResult } from "../lib/types.js";

export function paymentStatusFor(totalPaise: number, paidPaise: number): PaymentStatus {
  if (paidPaise <= 0) return "PENDING";
  if (paidPaise >= totalPaise) return "PAID";
  return "PARTIAL";
}

export async function nextOrderNumberInTx(tx: Prisma.TransactionClient): Promise<string> {
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
  tx: Prisma.TransactionClient,
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
