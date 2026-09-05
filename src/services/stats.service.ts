import { prisma } from "../lib/prisma.js";
import { ok, type DashboardStats, type ServiceResult } from "../lib/types.js";

export async function getDashboardStats(): Promise<ServiceResult<DashboardStats>> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [totalClients, ordersInProgress, openOrders, collected] = await prisma.$transaction([
    prisma.client.count(),
    prisma.order.count({ where: { status: "IN_PROGRESS" } }),
    prisma.order.findMany({
      where: { paymentStatus: { in: ["PENDING", "PARTIAL"] } },
      select: { totalPaise: true, payments: { select: { amountPaise: true } } },
    }),
    prisma.payment.aggregate({
      _sum: { amountPaise: true },
      where: { paidAt: { gte: startOfMonth } },
    }),
  ]);

  const pendingAmountPaise = openOrders.reduce((sum, order) => {
    const paid = order.payments.reduce((s, p) => s + p.amountPaise, 0);
    return sum + Math.max(0, order.totalPaise - paid);
  }, 0);

  return ok({
    totalClients,
    ordersInProgress,
    pendingAmountPaise,
    collectedThisMonthPaise: collected._sum.amountPaise ?? 0,
  });
}
