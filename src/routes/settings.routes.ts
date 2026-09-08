import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import {
  getShopSettings,
  updateDeliveryPresets,
  updateGarmentRates,
  updateGstSettings,
  updateWhatsappBusiness,
} from "../services/settings.service.js";
import type { GarmentRateEntry } from "../lib/types.js";

const settings = new Hono<{ Variables: AuthVariables }>();

// All settings routes require auth
settings.use(requireAuth);

/**
 * GET /api/settings
 * Returns shop configuration (WhatsApp Business number, more keys later).
 */
settings.get("/", async (c) => {
  const result = await getShopSettings();
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

/**
 * PUT /api/settings/whatsapp-business
 * Body: { "mobile": "+91 98765 43210" | null } — null clears the number.
 */
settings.put("/whatsapp-business", async (c) => {
  const body = await c.req.json().catch(() => null);
  const mobile =
    body && typeof body.mobile === "string" && body.mobile.trim()
      ? (body.mobile as string).trim()
      : null;
  const result = await updateWhatsappBusiness(mobile);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result.data);
});

/**
 * PUT /api/settings/gst
 * Body: { "gstRatePercent": 5 | null, "gstNumber": "22AAAAA0000A1Z5" | null }
 * Pass null to clear a value / disable GST.
 */
settings.put("/gst", async (c) => {
  const body = await c.req.json().catch(() => null);
  const gstRatePercent =
    body && typeof body.gstRatePercent === "number" && Number.isFinite(body.gstRatePercent)
      ? Number(body.gstRatePercent)
      : null;
  const gstNumber =
    body && typeof body.gstNumber === "string" && body.gstNumber.trim()
      ? (body.gstNumber as string).trim()
      : null;
  const result = await updateGstSettings({ gstRatePercent, gstNumber });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

/**
 * PUT /api/settings/garment-rates
 * Body: { "rates": [{ "garment": "Shirt", "rate": 500 }, …] }
 * Default prices that pre-fill the unit rate when a garment is chosen on a
 * new order. Pass an empty array to clear them.
 */
settings.put("/garment-rates", async (c) => {
  const body = await c.req.json().catch(() => null);
  const rates: GarmentRateEntry[] = [];
  if (body && Array.isArray(body.rates)) {
    for (const item of body.rates) {
      if (
        item &&
        typeof item.garment === "string" &&
        item.garment.trim() &&
        typeof item.rate === "number" &&
        Number.isFinite(item.rate)
      ) {
        rates.push({ garment: item.garment, rate: Number(item.rate) });
      }
    }
  }
  const result = await updateGarmentRates({ rates });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

/**
 * PUT /api/settings/delivery-presets
 * Body: { "presets": [7, 10, 15, 20] }
 * Delivery-duration shortcuts (in days) offered when creating an order. Pass an
 * empty array to clear them.
 */
settings.put("/delivery-presets", async (c) => {
  const body = await c.req.json().catch(() => null);
  const presets: number[] = [];
  if (body && Array.isArray(body.presets)) {
    for (const days of body.presets) {
      if (typeof days === "number" && Number.isFinite(days)) presets.push(Number(days));
    }
  }
  const result = await updateDeliveryPresets({ presets });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result.data);
});

export default settings;