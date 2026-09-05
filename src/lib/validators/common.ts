import { z } from "zod";

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

export const measureField = z
  .union([z.string(), z.number(), z.undefined()])
  .superRefine((v, ctx) => {
    if (typeof v === "string" && v.trim() !== "" && Number.isNaN(Number(v))) {
      ctx.addIssue({ code: "custom", message: "Enter a number" });
    }
  })
  .transform((v) => {
    if (typeof v === "number") return v;
    if (v === undefined || v.trim() === "") return undefined;
    return Number(v);
  })
  .pipe(
    z.union([
      z.undefined(),
      z
        .number()
        .positive("Must be greater than 0")
        .max(300, "Must be 300 or less")
        .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Max 2 decimal places"),
    ])
  )
  .optional();
