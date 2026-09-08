import { z } from "zod";
import { PAYMENT_METHODS, UNITS } from "../constants.js";
import { measureField, mobileSchema } from "./common.js";

export const clientProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required").max(100, "Max 100 characters"),
  mobile: mobileSchema,
  fatherOrHusband: z.optional(z.string().trim().max(100, "Max 100 characters")),
  email: z.optional(z.union([z.email(), z.literal("")])),
  address: z.optional(z.string().trim().max(300, "Max 300 characters")),
  notes: z.string().trim().max(500, "Max 500 characters"),
});

export const generalMeasurementSchema = z.object({
  height: measureField,
});

export const shirtMeasurementSchema = z.object({
  chest: measureField,
  waist: measureField,
  shoulderWidth: measureField,
  sleeveLength: measureField,
  shirtLength: measureField,
  neck: measureField,
  cuff: measureField,
});

export const pantMeasurementSchema = z.object({
  waist: measureField,
  hip: measureField,
  thigh: measureField,
  knee: measureField,
  bottomOpening: measureField,
  inseam: measureField,
});

export const measurementsSchema = z.object({
  unit: z.enum(UNITS),
  general: generalMeasurementSchema,
  shirt: shirtMeasurementSchema,
  pant: pantMeasurementSchema,
});

export const orderItemSchema = z.object({
  garmentType: z.string().trim().min(1, "Garment type is required").max(50, "Max 50 characters"),
  description: z.string().trim().max(200, "Max 200 characters"),
  quantity: z.number().int("Whole numbers only").min(1, "At least 1").max(999, "Max 999"),
  unitPrice: z.number().positive("Enter a price greater than 0").max(10000000, "Too large"),
});

export const wizardOrderSchema = z
  .object({
    items: z.array(orderItemSchema).min(1, "Add at least one item"),
    expectedDelivery: z.string().min(1, "Delivery date is required"),
    advance: z.number().min(0, "Cannot be negative"),
    paymentMethod: z.union([z.enum(PAYMENT_METHODS), z.literal("")]),
    gstRatePercent: z.number().int("Whole numbers only").min(0, "Min 0%").max(100, "Max 100%").optional(),
  })
  .superRefine((order, ctx) => {
    const subtotal = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const rate = order.gstRatePercent ?? 0;
    const total = subtotal + Math.round((subtotal * rate) / 100);
    if (order.advance > total) {
      ctx.addIssue({ code: "custom", path: ["advance"], message: "Advance cannot exceed the order total" });
    }
    if (order.advance > 0 && order.paymentMethod === "") {
      ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Select a payment method" });
    }
  });

export const addClientWizardSchema = z.object({
  profile: clientProfileSchema,
  measurements: measurementsSchema,
  order: wizardOrderSchema,
});

export const updateClientSchema = z.object({
  profile: clientProfileSchema,
  measurements: measurementsSchema,
});

export const recordPaymentSchema = z.object({
  amount: z.number().positive("Enter an amount greater than 0"),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(200, "Max 200 characters"),
});

export type AddClientWizardInput = z.infer<typeof addClientWizardSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
