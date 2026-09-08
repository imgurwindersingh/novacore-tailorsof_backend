export type Unit = "CM" | "INCH";
export type Role = "ADMIN" | "STAFF";
export type OrderStatus = "IN_PROGRESS" | "COMPLETED" | "DELIVERED" | "CANCELLED";
export type PaymentStatus = "PAID" | "PARTIAL" | "PENDING";
export type PaymentMethod = "CASH" | "UPI" | "CARD" | "OTHER";

export interface ShopSettings {
  whatsappBusinessMobile: string | null;
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function err<T = never>(error: string): ServiceResult<T> {
  return { ok: false, error };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface MeasurementsDTO {
  unit: Unit;
  general: { height?: number | null };
  shirt: {
    chest?: number | null;
    waist?: number | null;
    shoulderWidth?: number | null;
    sleeveLength?: number | null;
    shirtLength?: number | null;
    neck?: number | null;
    cuff?: number | null;
  };
  pant: {
    waist?: number | null;
    hip?: number | null;
    thigh?: number | null;
    knee?: number | null;
    bottomOpening?: number | null;
    inseam?: number | null;
  };
}

export interface ProfileDTO {
  fullName: string;
  mobile: string;
  fatherOrHusband: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface OrderItemDTO {
  garmentType: string;
  description: string | null;
  quantity: number;
  unitPricePaise: number;
}

export interface CreateOrderDTO {
  items: OrderItemDTO[];
  expectedDelivery: string | null;
  advancePaise: number;
  paymentMethod: PaymentMethod | null;
  notes?: string | null;
}

export interface CreateClientWithOrderDTO {
  profile: ProfileDTO;
  measurements: MeasurementsDTO | null;
  order: CreateOrderDTO;
}

export interface UpdateClientDTO {
  profile: ProfileDTO;
  measurements: MeasurementsDTO | null;
}

export interface ClientRow {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  createdAt: Date;
  orderCount: number;
  duePaise: number;
}

export interface ClientListResult {
  clients: ClientRow[];
  total: number;
  page: number;
  pages: number;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  expectedDelivery: Date | null;
  notes: string | null;
  createdAt: Date;
  items: {
    id: string;
    garmentType: string;
    description: string | null;
    designImageUrl: string | null;
    designReferenceUrl: string | null;
    quantity: number;
    unitPricePaise: number;
  }[];
  payments: {
    id: string;
    amountPaise: number;
    method: PaymentMethod;
    note: string | null;
    paidAt: Date;
  }[];
}

export interface ClientDetail {
  id: string;
  fullName: string;
  mobile: string;
  fatherOrHusband: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  generalMeasurement: { unit: Unit; height: number | null } | null;
  shirtMeasurement: {
    unit: Unit;
    chest: number | null;
    waist: number | null;
    shoulderWidth: number | null;
    sleeveLength: number | null;
    shirtLength: number | null;
    neck: number | null;
    cuff: number | null;
  } | null;
  pantMeasurement: {
    unit: Unit;
    waist: number | null;
    hip: number | null;
    thigh: number | null;
    knee: number | null;
    bottomOpening: number | null;
    inseam: number | null;
  } | null;
  orders: OrderDetail[];
}

export interface DashboardStats {
  totalClients: number;
  ordersInProgress: number;
  pendingAmountPaise: number;
  collectedThisMonthPaise: number;
}

export interface UpcomingDelivery {
  orderId: string;
  orderNumber: string;
  clientId: string;
  clientName: string;
  clientMobile: string;
  garmentTypes: string[];
  expectedDelivery: Date;
  totalPaise: number;
  duePaise: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}
