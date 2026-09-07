import { prisma } from "../lib/prisma.js";
import { err, ok, type PaymentMethod, type ServiceResult } from "../lib/types.js";
import { recomputeOrderTotalsInTx } from "./orders.service.js";

export async function recordPayment(
  orderId: string,
  dto: { amountPaise: number; method: PaymentMethod; note: string | null }
): Promise<ServiceResult<{ paymentId: string; clientId: string; duePaise: number }>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { select: { amountPaise: true } } },
  });
  if (!order) return err("Order not found");

  const paidPaise = order.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const duePaise = Math.max(0, order.totalPaise - paidPaise);
  if (dto.amountPaise > duePaise) {
    return err("Payment exceeds the due amount for this order");
  }

  const payment = await prisma.payment.create({
    data: {
      orderId,
      amountPaise: dto.amountPaise,
      method: dto.method,
      note: dto.note,
    },
  });
  await recomputeOrderTotalsInTx(prisma, orderId);

  return ok({
    paymentId: payment.id,
    clientId: order.clientId,
    duePaise: duePaise - dto.amountPaise,
  });
}

export async function listPaymentsByClient(clientId: string): Promise<
  ServiceResult<
    {
      id: string;
      amountPaise: number;
      method: PaymentMethod;
      note: string | null;
      paidAt: Date;
      orderNumber: string;
    }[]
  >
> {
  const payments = await prisma.payment.findMany({
    where: { order: { clientId } },
    include: { order: { select: { orderNumber: true } } },
    orderBy: { paidAt: "desc" },
  });
  return ok(
    payments.map((p) => ({
      id: p.id,
      amountPaise: p.amountPaise,
      method: p.method as PaymentMethod,
      note: p.note,
      paidAt: p.paidAt,
      orderNumber: p.order.orderNumber,
    }))
  );
}
