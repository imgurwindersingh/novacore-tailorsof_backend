import { prisma } from "../lib/prisma.js";
import { formatINR } from "../lib/money.js";
import type { NotifyResult } from "../lib/types.js";

/**
 * Outbound client notifications — all through Twilio's Messages API, which
 * handles both SMS and WhatsApp (using `whatsapp:+…` From/To channels).
 * Credentials come exclusively from the backend environment variables/secrets
 * (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
 * `TWILIO_WHATSAPP_ENABLED`, `TWILIO_CONTENT_SID`, `TWILIO_CONTENT_VARIABLES`,
 * `TWILIO_SMS_TEMPLATE`) — they are never stored in or read from the database.
 *
 * WhatsApp is tried first when enabled; if it fails the message automatically
 * falls back to a plain SMS. When no credentials are configured the result is
 * { channel: "none" } so callers can show a copy-ready message instead.
 */

type NotifyType = "created" | "delivered";

interface OrderMessageInput {
  type: NotifyType;
  mobile: string;
  fullName?: string | null;
  orderNumber: string;
  items: { garmentType: string; quantity: number }[];
  totalPaise: number;
  paidPaise: number;
}

const CHANNEL_KEYS = [
  "twilio_account_sid",
  "twilio_auth_token",
  "twilio_from_number",
  "twilio_whatsapp_enabled",
  "twilio_content_sid",
  "twilio_content_variables",
  "twilio_sms_template",
] as const;

const ENV_FALLBACK: Record<string, string | undefined> = {
  twilio_account_sid: process.env.TWILIO_ACCOUNT_SID,
  twilio_auth_token: process.env.TWILIO_AUTH_TOKEN,
  twilio_from_number: process.env.TWILIO_FROM_NUMBER,
  twilio_whatsapp_enabled: process.env.TWILIO_WHATSAPP_ENABLED,
  twilio_content_sid: process.env.TWILIO_CONTENT_SID,
  twilio_content_variables: process.env.TWILIO_CONTENT_VARIABLES,
  twilio_sms_template: process.env.TWILIO_SMS_TEMPLATE,
};

/** Normalize a client mobile to E.164 with a leading "+" (Twilio requires it). */
export function toE164(mobile: string): string | null {
  const digits = mobile.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("091")) return `+91${digits.slice(3)}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Strip a stored "whatsapp:" / spaces / dashes prefix, keep E.164. */
function cleanE164(value: string): string {
  return value.replace(/whatsapp:/gi, "").replace(/[^\d+]/g, "");
}

export function buildOrderMessage(input: OrderMessageInput): string {
  const greeting = input.fullName ? `Namaste ${input.fullName} 🙏` : "Namaste 🙏";
  const items = input.items.map((i) => `${i.quantity}× ${i.garmentType}`).join(", ");
  const due = Math.max(0, input.totalPaise - input.paidPaise);

  if (input.type === "delivered") {
    return [
      greeting,
      "",
      `Your order ${input.orderNumber} at Bluestar Tailors is ready for pickup! 🎉`,
      `📦 ${items}`,
      `💰 Total ${formatINR(input.totalPaise)} · Paid ${formatINR(input.paidPaise)}${
        due > 0 ? ` · Balance ${formatINR(due)}` : ""
      }`,
      "",
      "Thank you for choosing us — see you soon! ✨",
    ].join("\n");
  }

  return [
    greeting,
    "",
    `Welcome to Bluestar Tailors! Your order ${input.orderNumber} has been placed successfully.`,
    `📦 ${items}`,
    `💰 Total ${formatINR(input.totalPaise)}${due > 0 ? ` · Balance due ${formatINR(due)}` : ""}`,
    "",
    "Thank you for choosing us. We will keep you updated! ✨",
  ].join("\n");
}

async function readChannelSettings(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const key of CHANNEL_KEYS) {
    const value = ENV_FALLBACK[key]?.trim();
    if (value) map[key] = value;
  }
  return map;
}

async function sendTwilioMessage(
  to: string,
  message: string,
  creds: Record<string, string>,
  channel: "whatsapp" | "sms"
): Promise<NotifyResult> {
  const sid = creds["twilio_account_sid"];
  const authToken = creds["twilio_auth_token"];
  const from = cleanE164(creds["twilio_from_number"]);
  try {
    const form = new URLSearchParams();
    if (channel === "whatsapp") {
      form.set("To", `whatsapp:${to}`);
      form.set("From", `whatsapp:${from}`);
      // WhatsApp business-initiated messages require an approved content
      // template (ContentSid). Free-form Body only works inside the 24-hour
      // customer-service window, so we always prefer the template when set.
      const contentSid = creds["twilio_content_sid"]?.trim();
      const contentVariables = creds["twilio_content_variables"]?.trim();
      if (contentSid) {
        form.set("ContentSid", contentSid);
        if (contentVariables) form.set("ContentVariables", contentVariables);
      } else {
        form.set("Body", message);
      }
    } else {
      form.set("To", to);
      form.set("From", from);
      // Trial accounts can only send predefined SMS template names in Body.
      // When a template name is set, use it; otherwise free-form (upgraded
      // accounts).
      const smsTemplate = creds["twilio_sms_template"]?.trim();
      form.set("Body", smsTemplate || message);
    }
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      }
    );
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return {
        channel: channel === "whatsapp" ? "whatsapp" : "sms",
        ok: false,
        error: `Twilio ${channel} API ${res.status}: ${detail}`,
      };
    }
    return { channel: channel === "whatsapp" ? "whatsapp" : "sms", ok: true };
  } catch (e) {
    return {
      channel: channel === "whatsapp" ? "whatsapp" : "sms",
      ok: false,
      error: e instanceof Error ? e.message : `Twilio ${channel} send failed`,
    };
  }
}

export async function sendOrderNotification(input: OrderMessageInput): Promise<NotifyResult> {
  const to = toE164(input.mobile);
  if (!to) return { channel: "none", ok: false, error: "Client mobile is not a valid number" };

  const creds = await readChannelSettings();
  if (!creds["twilio_account_sid"] || !creds["twilio_auth_token"] || !creds["twilio_from_number"]) {
    return { channel: "none", ok: false, error: "No Twilio channel configured" };
  }

  const message = buildOrderMessage(input);
  const whatsappEnabled =
    (creds["twilio_whatsapp_enabled"] || ENV_FALLBACK.twilio_whatsapp_enabled || "true") === "true";

  if (whatsappEnabled) {
    const whatsapp = await sendTwilioMessage(to, message, creds, "whatsapp");
    if (whatsapp.ok) return whatsapp;
    const sms = await sendTwilioMessage(to, message, creds, "sms");
    return sms.ok
      ? sms
      : {
          ...whatsapp,
          channel: "none",
          error: `WhatsApp failed (${whatsapp.error}); SMS failed (${sms.error})`,
        };
  }

  return sendTwilioMessage(to, message, creds, "sms");
}

/** Send the "order placed" message after a client's order is created. */
export async function notifyOrderCreated(
  clientId: string,
  orderId: string
): Promise<NotifyResult> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        mobile: true,
        fullName: true,
        orders: {
          where: { id: orderId },
          select: {
            orderNumber: true,
            totalPaise: true,
            items: { select: { garmentType: true, quantity: true } },
            payments: { select: { amountPaise: true } },
          },
        },
      },
    });
    const order = client?.orders[0];
    if (!client || !order) return { channel: "none", ok: false, error: "Order/client not found" };
    const paid = order.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    return sendOrderNotification({
      type: "created",
      mobile: client.mobile,
      fullName: client.fullName,
      orderNumber: order.orderNumber,
      items: order.items,
      totalPaise: order.totalPaise,
      paidPaise: paid,
    });
  } catch (e) {
    return {
      channel: "none",
      ok: false,
      error: e instanceof Error ? e.message : "Notify failed",
    };
  }
}

/** Send the "order ready for pickup" message after an order is marked delivered. */
export async function notifyOrderDelivered(orderId: string): Promise<NotifyResult> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        totalPaise: true,
        client: { select: { mobile: true, fullName: true } },
        items: { select: { garmentType: true, quantity: true } },
        payments: { select: { amountPaise: true } },
      },
    });
    if (!order) return { channel: "none", ok: false, error: "Order not found" };
    const paid = order.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    return sendOrderNotification({
      type: "delivered",
      mobile: order.client.mobile,
      fullName: order.client.fullName,
      orderNumber: order.orderNumber,
      items: order.items,
      totalPaise: order.totalPaise,
      paidPaise: paid,
    });
  } catch (e) {
    return {
      channel: "none",
      ok: false,
      error: e instanceof Error ? e.message : "Notify failed",
    };
  }
}