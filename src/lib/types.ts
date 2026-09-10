export type Unit = "CM" | "INCH";
export type Role = "ADMIN" | "STAFF";
export type OrderStatus = "IN_PROGRESS" | "COMPLETED" | "DELIVERED" | "CANCELLED";
export type PaymentStatus = "PAID" | "PARTIAL" | "PENDING";
export type PaymentMethod = "CASH" | "UPI" | "CARD" | "OTHER";

export interface ShopSettings {
  whatsappBusinessMobile: string | null;
  /** Default GST rate (%) applied to new orders when not overridden. */
  gstRatePercent: number | null;
  /** Business GSTIN shown on the order slip / invoice. */
  gstNumber: string | null;
  /** Default price per garment type, used to pre-fill the unit rate on new orders. */
  defaultGarmentRates: Record<string, number>;
  /** Delivery-duration presets (in days) offered when creating an order. */
  deliveryPresets: number[];
  /** True when Twilio credentials (Account SID + Auth Token) are configured. */
  twilioConfigured: boolean;
  /** Whether client messages are enabled via Twilio WhatsApp. */
  whatsappEnabled: boolean;
  /** Twilio WhatsApp sender number used for outgoing messages. */
  whatsappFromNumber: string | null;
  /** Twilio phone number used as the SMS sender. */
  smsFromNumber: string | null;
}

export type NotifyChannel = "whatsapp" | "sms" | "none";

export interface NotifyResult {
  channel: NotifyChannel;
  ok: boolean;
  error?: string;
  status?: number;
  /** Set when more than one channel was delivered (e.g. WhatsApp + SMS). */
  channels?: NotifyChannel[];
}

export interface GarmentRateEntry {
  garment: string;
  rate: number;
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
  fatherOrHusband?: string | null;
  email?: string | null;
  address?: string | null;
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
  /** GST rate (%) snapshot for this order. Omit (or null) to use the shop default. */
  gstRatePercent?: number | null;
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
  subtotalPaise: number;
  gstPaise: number;
  gstRatePercent: number | null;
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
