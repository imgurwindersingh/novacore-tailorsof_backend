import { Prisma } from "../lib/prisma-client.js";
import { PAGE_SIZE } from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import {
  err,
  ok,
  type ClientDetail,
  type ClientListResult,
  type ClientRow,
  type CreateClientWithOrderDTO,
  type OrderDetail,
  type PaymentMethod,
  type PaymentStatus,
  type ServiceResult,
  type Unit,
  type UpcomingDelivery,
  type UpdateClientDTO,
} from "../lib/types.js";
import { hasAnyMeasurement, upsertMeasurementsInTx } from "./measurements.service.js";
import { nextOrderNumberInTx, paymentStatusFor } from "./orders.service.js";

export function emptyToNull(value: string | null | undefined): string | null {
  return value && value.trim() !== "" ? value : null;
}

function dueOf(totalPaise: number, payments: { amountPaise: number }[]): number {
  const paid = payments.reduce((sum, p) => sum + p.amountPaise, 0);
  return Math.max(0, totalPaise - paid);
}

function toRow(client: {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  createdAt: Date;
  orders: { totalPaise: number; payments: { amountPaise: number }[] }[];
}): ClientRow {
  return {
    id: client.id,
    fullName: client.fullName,
    mobile: client.mobile,
    email: client.email,
    createdAt: client.createdAt,
    orderCount: client.orders.length,
    duePaise: client.orders.reduce((sum, o) => sum + dueOf(o.totalPaise, o.payments), 0),
  };
}

const rowInclude = {
  orders: {
    select: { totalPaise: true, payments: { select: { amountPaise: true } } },
  },
} satisfies Prisma.ClientInclude;

export async function listClients(args: {
  q?: string;
  page?: number;
}): Promise<ServiceResult<ClientListResult>> {
  try {
    const page = Math.max(1, args.page ?? 1);
    const q = args.q?.trim();
    const where: Prisma.ClientWhereInput = q
      ? {
          OR: [
            { fullName: { contains: q } },
            { mobile: { contains: q } },
            { orders: { some: { orderNumber: { contains: q } } } },
          ],
        }
      : {};

    const [total, clients] = await prisma.$transaction([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        include: rowInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return ok({
      clients: clients.map(toRow),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  } catch (error) {
    console.error("[listClients] Error querying database:", error);
    return ok({
      clients: [],
      total: 0,
      page: 1,
      pages: 1,
    });
  }
}

export async function getRecentClients(limit = 5): Promise<ServiceResult<ClientRow[]>> {
  try {
    const clients = await prisma.client.findMany({
      include: rowInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return ok(clients.map(toRow));
  } catch (error) {
    console.error("[getRecentClients] Error querying database:", error);
    return ok([]);
  }
}

export async function getUpcomingDeliveries(limit = 10): Promise<ServiceResult<UpcomingDelivery[]>> {
  try {
    const orders = await prisma.order.findMany({
      where: {
        expectedDelivery: { not: null },
        status: { notIn: ["DELIVERED", "CANCELLED"] },
      },
      include: {
        client: { select: { id: true, fullName: true, mobile: true } },
        items: { select: { garmentType: true } },
        payments: { select: { amountPaise: true } },
      },
      orderBy: { expectedDelivery: "asc" },
      take: limit,
    });

    return ok(
      orders.map((o) => {
        const paidPaise = o.payments.reduce((sum, p) => sum + p.amountPaise, 0);
        return {
          orderId: o.id,
          orderNumber: o.orderNumber,
          clientId: o.client.id,
          clientName: o.client.fullName,
          clientMobile: o.client.mobile,
          garmentTypes: [...new Set(o.items.map((i) => i.garmentType))],
          expectedDelivery: o.expectedDelivery!,
          totalPaise: o.totalPaise,
          duePaise: Math.max(0, o.totalPaise - paidPaise),
          status: o.status as UpcomingDelivery["status"],
          paymentStatus: o.paymentStatus as UpcomingDelivery["paymentStatus"],
        };
      })
    );
  } catch (error) {
    console.error("[getUpcomingDeliveries] Error querying database:", error);
    return ok([]);
  }
}

function toOrderDetail(order: {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  totalPaise: number;
  expectedDelivery: Date | null;
  notes: string | null;
  createdAt: Date;
  items: { id: string; garmentType: string; description: string | null; quantity: number; unitPricePaise: number }[];
  payments: { id: string; amountPaise: number; method: string; note: string | null; paidAt: Date }[];
}): OrderDetail {
  const paidPaise = order.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status as OrderDetail["status"],
    paymentStatus: order.paymentStatus as PaymentStatus,
    totalPaise: order.totalPaise,
    paidPaise,
    duePaise: Math.max(0, order.totalPaise - paidPaise),
    expectedDelivery: order.expectedDelivery,
    notes: order.notes,
    createdAt: order.createdAt,
    items: order.items,
    payments: order.payments.map((p) => ({ ...p, method: p.method as PaymentMethod })),
  };
}

export async function getClientDetail(id: string): Promise<ServiceResult<ClientDetail>> {
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      generalMeasurement: true,
      shirtMeasurement: true,
      pantMeasurement: true,
      orders: {
        include: {
          items: true,
          payments: { orderBy: { paidAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!client) return err("Client not found");

  return ok({
    id: client.id,
    fullName: client.fullName,
    mobile: client.mobile,
    fatherOrHusband: client.fatherOrHusband,
    email: client.email,
    address: client.address,
    notes: client.notes,
    createdAt: client.createdAt,
    generalMeasurement: client.generalMeasurement
      ? { unit: client.generalMeasurement.unit as Unit, height: client.generalMeasurement.height }
      : null,
    shirtMeasurement: client.shirtMeasurement
      ? {
          unit: client.shirtMeasurement.unit as Unit,
          chest: client.shirtMeasurement.chest,
          waist: client.shirtMeasurement.waist,
          shoulderWidth: client.shirtMeasurement.shoulderWidth,
          sleeveLength: client.shirtMeasurement.sleeveLength,
          shirtLength: client.shirtMeasurement.shirtLength,
          neck: client.shirtMeasurement.neck,
          cuff: client.shirtMeasurement.cuff,
        }
      : null,
    pantMeasurement: client.pantMeasurement
      ? {
          unit: client.pantMeasurement.unit as Unit,
          waist: client.pantMeasurement.waist,
          hip: client.pantMeasurement.hip,
          thigh: client.pantMeasurement.thigh,
          knee: client.pantMeasurement.knee,
          bottomOpening: client.pantMeasurement.bottomOpening,
          inseam: client.pantMeasurement.inseam,
        }
      : null,
    orders: client.orders.map(toOrderDetail),
  });
}

export async function createClientWithOrder(
  dto: CreateClientWithOrderDTO
): Promise<ServiceResult<{ clientId: string; orderId: string; orderNumber: string }>> {
  const existing = await prisma.client.findUnique({ where: { mobile: dto.profile.mobile } });
  if (existing) return err("A client with this mobile number already exists");

  const totalPaise = dto.order.items.reduce((sum, i) => sum + i.quantity * i.unitPricePaise, 0);
  if (dto.order.advancePaise > totalPaise) return err("Advance cannot exceed the order total");
  if (dto.order.advancePaise > 0 && !dto.order.paymentMethod) {
    return err("Select a payment method for the advance");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          fullName: dto.profile.fullName,
          mobile: dto.profile.mobile,
          fatherOrHusband: dto.profile.fatherOrHusband,
          email: dto.profile.email,
          address: dto.profile.address,
          notes: dto.profile.notes,
        },
      });

      if (dto.measurements && hasAnyMeasurement(dto.measurements)) {
        await upsertMeasurementsInTx(tx, client.id, dto.measurements);
      }

      const orderNumber = await nextOrderNumberInTx(tx);
      const order = await tx.order.create({
        data: {
          clientId: client.id,
          orderNumber,
          totalPaise,
          paymentStatus: paymentStatusFor(totalPaise, dto.order.advancePaise),
          expectedDelivery: dto.order.expectedDelivery ? new Date(dto.order.expectedDelivery) : null,
          notes: dto.order.notes ?? null,
          items: {
            create: dto.order.items.map((i) => ({
              garmentType: i.garmentType,
              description: i.description,
              quantity: i.quantity,
              unitPricePaise: i.unitPricePaise,
            })),
          },
        },
      });

      if (dto.order.advancePaise > 0 && dto.order.paymentMethod) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            amountPaise: dto.order.advancePaise,
            method: dto.order.paymentMethod,
          },
        });
      }

      return { clientId: client.id, orderId: order.id, orderNumber };
    });
    return ok(result);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return err("A client with this mobile number already exists");
    }
    throw e;
  }
}

export async function updateClient(
  id: string,
  dto: UpdateClientDTO
): Promise<ServiceResult<{ clientId: string }>> {
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return err("Client not found");

  if (dto.profile.mobile !== existing.mobile) {
    const clash = await prisma.client.findUnique({ where: { mobile: dto.profile.mobile } });
    if (clash) return err("A client with this mobile number already exists");
  }

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id },
      data: {
        fullName: dto.profile.fullName,
        mobile: dto.profile.mobile,
        fatherOrHusband: dto.profile.fatherOrHusband,
        email: dto.profile.email,
        address: dto.profile.address,
        notes: dto.profile.notes,
      },
    });
    if (dto.measurements) {
      await upsertMeasurementsInTx(tx, id, dto.measurements);
    }
  });

  return ok({ clientId: id });
}

export async function deleteClient(id: string): Promise<ServiceResult<{ clientId: string }>> {
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return err("Client not found");
  await prisma.client.delete({ where: { id } });
  return ok({ clientId: id });
}
