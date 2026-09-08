import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth.middleware.js";
import { getShopSettings, updateWhatsappBusiness } from "../services/settings.service.js";

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

export default settings;