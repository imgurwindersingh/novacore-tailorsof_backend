import { prisma } from "../lib/prisma.js";
import {
  err,
  ok,
  type GarmentRateEntry,
  type ServiceResult,
  type ShopSettings,
} from "../lib/types.js";

const WHATSAPP_BUSINESS_KEY = "whatsapp_business_mobile";
const GST_RATE_KEY = "gst_rate_percent";
const GST_NUMBER_KEY = "gst_number";
const GARMENT_RATES_KEY = "default_garment_rates";
const DELIVERY_PRESETS_KEY = "delivery_presets";

function sanitizeMobile(mobile: string): string {
  return mobile.replace(/[^\d+]/g, "");
}

function sanitizeGstNumber(gstNumber: string): string {
  return gstNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function parseRate(value: string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

function parseGarmentRates(value: string | undefined | null): Record<string, number> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([garment, rate]) =>
          garment.trim().length > 0 &&
          typeof rate === "number" &&
          Number.isFinite(rate) &&
          rate >= 0
      )
    );
  } catch {
    return {};
  }
}

function parseDeliveryPresets(value: string | undefined | null): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const days = new Set<number>();
    for (const item of parsed) {
      if (typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 365) {
        days.add(item);
      }
    }
    return [...days].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Default GST rate (%) applied to new orders, or null when GST is disabled. */
export async function getDefaultGstRatePercent(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: GST_RATE_KEY } });
  return parseRate(row?.value);
}

/** GET current shop settings (WhatsApp Business number, GST config…). */
export async function getShopSettings(): Promise<ServiceResult<ShopSettings>> {
  try {
    const rows = await prisma.setting.findMany();
    const settings: ShopSettings = {
      whatsappBusinessMobile: null,
      gstRatePercent: null,
      gstNumber: null,
      defaultGarmentRates: {},
      deliveryPresets: [],
      twilioConfigured: false,
      whatsappEnabled: true,
      whatsappFromNumber: null,
      smsFromNumber: null,
    };
    for (const row of rows) {
      if (row.key === WHATSAPP_BUSINESS_KEY && row.value) {
        settings.whatsappBusinessMobile = row.value;
      } else if (row.key === GST_RATE_KEY) {
        const rate = parseRate(row.value);
        if (rate != null) settings.gstRatePercent = rate;
      } else if (row.key === GST_NUMBER_KEY && row.value) {
        settings.gstNumber = row.value;
      } else if (row.key === GARMENT_RATES_KEY) {
        settings.defaultGarmentRates = parseGarmentRates(row.value);
      } else if (row.key === DELIVERY_PRESETS_KEY) {
        settings.deliveryPresets = parseDeliveryPresets(row.value);
      }
    }
    // Messaging credentials come exclusively from the backend environment
    // (Cloudflare vars / `wrangler secret put`). Never exposed for admin editing.
    const envHas = (key: string) => Boolean(process.env[key]?.trim());
    settings.twilioConfigured =
      envHas("TWILIO_ACCOUNT_SID") && envHas("TWILIO_AUTH_TOKEN");
    if (envHas("TWILIO_WHATSAPP_FROM")) {
      settings.whatsappFromNumber = process.env.TWILIO_WHATSAPP_FROM!;
    }
    if (process.env.TWILIO_WHATSAPP_ENABLED) {
      settings.whatsappEnabled = process.env.TWILIO_WHATSAPP_ENABLED === "true";
    }
    if (envHas("TWILIO_PHONE_NUMBER")) {
      settings.smsFromNumber = process.env.TWILIO_PHONE_NUMBER!;
    }
    return ok(settings);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Failed to load settings");
  }
}

/** Save the admin WhatsApp Business number shown on the share sheet. */
export async function updateWhatsappBusiness(
  mobile: string | null
): Promise<ServiceResult<ShopSettings>> {
  try {
    const value = mobile ? sanitizeMobile(mobile) : "";
    if (!value) {
      await prisma.setting.deleteMany({ where: { key: WHATSAPP_BUSINESS_KEY } });
    } else {
      await prisma.setting.upsert({
        where: { key: WHATSAPP_BUSINESS_KEY },
        update: { value },
        create: { key: WHATSAPP_BUSINESS_KEY, value },
      });
    }
    return getShopSettings();
  } catch (e) {
    return err(e instanceof Error ? e.message : "Failed to save settings");
  }
}

/**
 * Save GST configuration. Pass null values to disable GST / clear the GSTIN.
 * Note: existing orders keep the GST snapshot captured at creation; this only
 * affects new orders.
 */
export async function updateGstSettings(dto: {
  gstRatePercent: number | null;
  gstNumber: string | null;
}): Promise<ServiceResult<ShopSettings>> {
  try {
    const rate = dto.gstRatePercent != null ? Math.trunc(dto.gstRatePercent) : null;
    if (rate != null && (rate < 0 || rate > 100)) {
      return err("GST rate must be between 0% and 100%");
    }

    if (rate == null || rate === 0) {
      await prisma.setting.deleteMany({ where: { key: GST_RATE_KEY } });
    } else {
      await prisma.setting.upsert({
        where: { key: GST_RATE_KEY },
        update: { value: String(rate) },
        create: { key: GST_RATE_KEY, value: String(rate) },
      });
    }

    const gstNumber = dto.gstNumber ? sanitizeGstNumber(dto.gstNumber) : "";
    if (!gstNumber) {
      await prisma.setting.deleteMany({ where: { key: GST_NUMBER_KEY } });
    } else {
      await prisma.setting.upsert({
        where: { key: GST_NUMBER_KEY },
        update: { value: gstNumber },
        create: { key: GST_NUMBER_KEY, value: gstNumber },
      });
    }

    return getShopSettings();
  } catch (e) {
    return err(e instanceof Error ? e.message : "Failed to save GST settings");
  }
}

/**
 * Save the default garment rates used to pre-fill new orders. Pass an empty
 * list to clear them. Rates are stored per garment name (trimmed, deduped).
 */
export async function updateGarmentRates(dto: {
  rates: GarmentRateEntry[];
}): Promise<ServiceResult<ShopSettings>> {
  try {
    const cleaned: Record<string, number> = {};
    for (const entry of dto.rates) {
      const garment = entry.garment.trim();
      const rate = Number(entry.rate);
      if (!garment || !Number.isFinite(rate) || rate < 0) continue;
      cleaned[garment] = rate;
    }

    if (Object.keys(cleaned).length === 0) {
      await prisma.setting.deleteMany({ where: { key: GARMENT_RATES_KEY } });
    } else {
      await prisma.setting.upsert({
        where: { key: GARMENT_RATES_KEY },
        update: { value: JSON.stringify(cleaned) },
        create: { key: GARMENT_RATES_KEY, value: JSON.stringify(cleaned) },
      });
    }

    return getShopSettings();
  } catch (e) {
    return err(e instanceof Error ? e.message : "Failed to save garment rates");
  }
}

/** Save the delivery-duration presets (in days) offered when creating an order. */
export async function updateDeliveryPresets(dto: {
  presets: number[];
}): Promise<ServiceResult<ShopSettings>> {
  try {
    const cleaned = new Set<number>();
    for (const days of dto.presets) {
      if (Number.isInteger(days) && days >= 1 && days <= 365) cleaned.add(days);
    }
    const presets = [...cleaned].sort((a, b) => a - b);

    if (presets.length === 0) {
      await prisma.setting.deleteMany({ where: { key: DELIVERY_PRESETS_KEY } });
    } else {
      await prisma.setting.upsert({
        where: { key: DELIVERY_PRESETS_KEY },
        update: { value: JSON.stringify(presets) },
        create: { key: DELIVERY_PRESETS_KEY, value: JSON.stringify(presets) },
      });
    }

    return getShopSettings();
  } catch (e) {
    return err(e instanceof Error ? e.message : "Failed to save delivery presets");
  }
}