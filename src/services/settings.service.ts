import { prisma } from "../lib/prisma.js";
import { err, ok, type ServiceResult, type ShopSettings } from "../lib/types.js";

const WHATSAPP_BUSINESS_KEY = "whatsapp_business_mobile";

function sanitizeMobile(mobile: string): string {
  return mobile.replace(/[^\d+]/g, "");
}

/** GET current shop settings (e.g. the admin WhatsApp Business number). */
export async function getShopSettings(): Promise<ServiceResult<ShopSettings>> {
  try {
    const rows = await prisma.setting.findMany();
    const settings: ShopSettings = { whatsappBusinessMobile: null };
    for (const row of rows) {
      if (row.key === WHATSAPP_BUSINESS_KEY && row.value) {
        settings.whatsappBusinessMobile = row.value;
      }
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