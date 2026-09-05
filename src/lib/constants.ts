import type { OrderStatus, PaymentMethod, PaymentStatus, Unit } from "./types.js";

export const UNITS = ["CM", "INCH"] as const;

export const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "OTHER"] as const;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other",
};

export const ORDER_STATUSES = ["IN_PROGRESS", "COMPLETED", "DELIVERED", "CANCELLED"] as const;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: "Paid",
  PARTIAL: "Partial",
  PENDING: "Pending",
};

export const GARMENT_TYPES = [
  "Shirt",
  "Kurta",
  "Pant",
  "Trouser",
  "Sherwani",
  "Blazer",
  "Suit",
  "Blouse",
  "Other",
];

export const PAGE_SIZE = 10;

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const SHIRT_MEASUREMENT_LABELS: Record<string, string> = {
  chest: "Chest",
  waist: "Waist",
  shoulderWidth: "Shoulder width",
  sleeveLength: "Sleeve length",
  shirtLength: "Shirt length",
  neck: "Neck",
  cuff: "Cuff",
};

export const PANT_MEASUREMENT_LABELS: Record<string, string> = {
  waist: "Waist",
  hip: "Hip",
  thigh: "Thigh",
  knee: "Knee",
  bottomOpening: "Bottom opening",
  inseam: "Inseam",
};

export const GENERAL_MEASUREMENT_LABELS: Record<string, string> = {
  height: "Height",
};

export type { Unit };
