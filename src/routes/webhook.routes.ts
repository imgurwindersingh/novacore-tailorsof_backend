import { Hono } from "hono";

const webhook = new Hono();

/**
 * Vonage Messages API status webhook.
 * Receives delivery receipts: sent, delivered, failed, rejected, etc.
 * Configure this URL in your Vonage Application → Status webhook.
 */
webhook.post("/vonage/status", async (c) => {
  try {
    const body = await c.req.json();
    console.log("[Vonage Status Webhook]", JSON.stringify(body, null, 2));
    return c.json({ received: true });
  } catch (e) {
    console.error("[Vonage Status Webhook] parse error:", e);
    return c.json({ received: true, parseError: true });
  }
});

/**
 * Vonage Messages API inbound webhook.
 * Receives incoming WhatsApp/SMS messages from clients.
 * Configure this URL in your Vonage Application → Inbound webhook.
 */
webhook.post("/vonage/inbound", async (c) => {
  try {
    const body = await c.req.json();
    console.log("[Vonage Inbound Webhook]", JSON.stringify(body, null, 2));
    return c.json({ received: true });
  } catch (e) {
    console.error("[Vonage Inbound Webhook] parse error:", e);
    return c.json({ received: true, parseError: true });
  }
});

export default webhook;
