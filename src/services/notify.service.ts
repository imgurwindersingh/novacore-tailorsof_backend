import { prisma } from "../lib/prisma.js";
import { formatINR } from "../lib/money.js";
import type { NotifyResult } from "../lib/types.js";

/**
 * Outbound client notifications — Vonage Messages API (SMS + WhatsApp).
 * Credentials come exclusively from the backend environment variables/secrets:
 * `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_WHATSAPP_FROM`,
 * `VONAGE_SMS_FROM`, `VONAGE_WHATSAPP_ENABLED`, `VONAGE_SANDBOX`.
 * They are never stored in or read from the database.
 *
 * WhatsApp is tried first when enabled; if it fails the message falls back to
 * SMS when a sender is configured. When no credentials are configured the
 * result is { channel: "none" } so callers can show a copy-ready message.
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

const BRAND_NAME = "Novacore Tailorsoft";

const CHANNEL_KEYS = [
  "vonage_api_key",
  "vonage_api_secret",
  "vonage_whatsapp_from",
  "vonage_sms_from",
  "vonage_whatsapp_enabled",
  "vonage_sandbox",
] as const;

const ENV_FALLBACK: Record<string, string | undefined> = {
  vonage_api_key: process.env.VONAGE_API_KEY,
  vonage_api_secret: process.env.VONAGE_API_SECRET,
  vonage_whatsapp_from: process.env.VONAGE_WHATSAPP_FROM,
  vonage_sms_from: process.env.VONAGE_SMS_FROM,
  vonage_whatsapp_enabled: process.env.VONAGE_WHATSAPP_ENABLED,
  vonage_sandbox: process.env.VONAGE_SANDBOX,
};

/** Normalize a client mobile to E.164 without the leading "+" (Vonage format). */
export function toE164(mobile: string): string | null {
  const digits = mobile.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return `91${digits.slice(3)}`;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

export function buildOrderMessage(input: OrderMessageInput): string {
  const greeting = input.fullName ? `Namaste ${input.fullName} 🙏` : "Namaste 🙏";
  const items = input.items.map((i) => `${i.quantity}× ${i.garmentType}`).join(", ");
  const due = Math.max(0, input.totalPaise - input.paidPaise);

  if (input.type === "delivered") {
    return [
      greeting,
      "",
      `Your order ${input.orderNumber} at ${BRAND_NAME} is ready for pickup! 🎉`,
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
    `Welcome to ${BRAND_NAME}! Your order ${input.orderNumber} has been placed successfully.`,
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

function extractError(json: string, httpStatus: number): string {
  try {
    const parsed = JSON.parse(json) as {
      title?: string;
      message?: string;
      detail?: string;
      error?: string;
    };
    return parsed.title ?? parsed.message ?? parsed.detail ?? parsed.error ?? `HTTP ${httpStatus}`;
  } catch {
    return (json || `HTTP ${httpStatus}`).slice(0, 300);
  }
}

/** Send one text message through the Vonage Messages API. */
async function sendVonage(
  to: string,
  from: string,
  text: string,
  channel: "whatsapp" | "sms",
  creds: Record<string, string>
): Promise<NotifyResult> {
  const apiKey = creds["vonage_api_key"];
  const apiSecret = creds["vonage_api_secret"];
  // WhatsApp runs on the sandbox endpoint until a WhatsApp Business Account is
  // linked (then set VONAGE_SANDBOX=false). SMS always uses the production
  // endpoint — the sandbox only reaches whitelisted recipients.
  const sandbox = channel === "whatsapp" && (creds["vonage_sandbox"] || "true") === "true";
  const baseUrl = sandbox
    ? "https://messages-sandbox.nexmo.com/v1/messages"
    : "https://api.nexmo.com/v1/messages";

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        message_type: "text",
        text,
        channel,
      }),
    });
    const resText = await res.text();
    if (!res.ok) {
      return {
        channel,
        ok: false,
        error: `Vonage ${channel} API ${res.status}: ${extractError(resText, res.status)}`,
      };
    }
    return { channel, ok: true };
  } catch (e) {
    return {
      channel,
      ok: false,
      error: e instanceof Error ? e.message : `Vonage ${channel} send failed`,
    };
  }
}

export async function sendOrderNotification(input: OrderMessageInput): Promise<NotifyResult> {
  const to = toE164(input.mobile);
  if (!to) return { channel: "none", ok: false, error: "Client mobile is not a valid number" };

  const creds = await readChannelSettings();
  if (!creds["vonage_api_key"] || !creds["vonage_api_secret"]) {
    return { channel: "none", ok: false, error: "No Vonage channel configured" };
  }

  const message = buildOrderMessage(input);
  const whatsappEnabled =
    (creds["vonage_whatsapp_enabled"] ?? "true") === "true";
  const whatsappFrom = creds["vonage_whatsapp_from"]?.trim();
  const smsFrom = creds["vonage_sms_from"]?.trim();

  if (whatsappEnabled && whatsappFrom) {
    const whatsapp = await sendVonage(to, whatsappFrom, message, "whatsapp", creds);
    if (whatsapp.ok) return whatsapp;
    if (smsFrom) {
      const sms = await sendVonage(to, smsFrom, message, "sms", creds);
      return sms.ok
        ? sms
        : {
            ...whatsapp,
            channel: "none" as const,
            error: `WhatsApp failed (${whatsapp.error}); SMS failed (${sms.error})`,
          };
    }
    return whatsapp;
  }

  if (smsFrom) return sendVonage(to, smsFrom, message, "sms", creds);

  return {
    channel: "none",
    ok: false,
    error: "Nothing configured: set VONAGE_WHATSAPP_FROM or VONAGE_SMS_FROM",
  };
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