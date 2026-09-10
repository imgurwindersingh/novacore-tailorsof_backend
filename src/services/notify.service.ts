import { prisma } from "../lib/prisma.js";
import { formatINR } from "../lib/money.js";
import type { NotifyResult } from "../lib/types.js";

/**
 * Outbound client notifications — Infobip WhatsApp API.
 * Credentials come exclusively from the backend environment variables/secrets:
 * `INFOBIP_API_KEY`, `INFOBIP_BASE_URL`, `INFOBIP_WHATSAPP_FROM`,
 * `INFOBIP_WHATSAPP_ENABLED`. They are never stored in or read from the database.
 *
 * The Infobip REST API is called directly (App authorization header) so no
 * SDK dependency is required on Cloudflare Workers.
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
  /** Public profile URL shown to the client (e.g. /p/:clientId). */
  publicProfileUrl?: string;
}

const BRAND_NAME = "Novacore Tailorsoft";

const ENV_KEYS = [
  "infobip_api_key",
  "infobip_base_url",
  "infobip_whatsapp_from",
  "infobip_whatsapp_enabled",
] as const;

const ENV_FALLBACK: Record<string, string | undefined> = {
  infobip_api_key: process.env.INFOBIP_API_KEY,
  infobip_base_url: process.env.INFOBIP_BASE_URL,
  infobip_whatsapp_from: process.env.INFOBIP_WHATSAPP_FROM,
  infobip_whatsapp_enabled: process.env.INFOBIP_WHATSAPP_ENABLED,
};

/** Normalize a client mobile to E.164 (e.g. `+919876543210`). */
export function toE164(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  let number: string;
  if (digits.length === 10) number = `91${digits}`;
  else if (digits.length === 11 && digits.startsWith("0")) number = `91${digits.slice(1)}`;
  else if (digits.length === 12 && digits.startsWith("91")) number = digits;
  else if (digits.length === 13 && digits.startsWith("091")) number = `91${digits.slice(3)}`;
  else number = digits;
  if (!number || number.length < 8) return "";
  return `+${number}`;
}

export function buildOrderMessage(input: OrderMessageInput): string {
  const name = input.fullName?.trim() ? input.fullName : "Customer";
  const items = input.items.map((i) => `${i.quantity}x ${i.garmentType}`).join(", ");
  const due = Math.max(0, input.totalPaise - input.paidPaise);

  if (input.type === "delivered") {
    return [
      `Dear ${name},`,
      "",
      `Your order ${input.orderNumber} at ${BRAND_NAME} is ready for pickup.`,
      "",
      `Items: ${items}`,
      `Total: ${formatINR(input.totalPaise)} | Paid: ${formatINR(input.paidPaise)}${
        due > 0 ? ` | Balance: ${formatINR(due)}` : ""
      }`,
      "",
      "Please visit us to collect it. Thank you for your business.",
      `- ${BRAND_NAME}`,
    ]
      .filter((line) => line.trim() !== "")
      .join("\n");
  }

  return [
    `Dear ${name},`,
    "",
    `Thank you for your order at ${BRAND_NAME}. Order ${input.orderNumber} has been confirmed successfully.`,
    "",
    `Items: ${items}`,
    `Total: ${formatINR(input.totalPaise)}${due > 0 ? ` | Balance due: ${formatINR(due)}` : ""}`,
    "",
    `View your order: ${input.publicProfileUrl ?? ""}`,
    "",
    "You will receive a notification when your order is ready for pickup.",
    `- ${BRAND_NAME}`,
  ]
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** Public client profile URL shown to the client in the notification. */
export function publicProfileUrl(clientId: string): string {
  const base = (process.env.FRONTEND_URL || "https://novacore-tailorsof-frontend.gora55039.workers.dev").replace(/\/$/, "");
  return `${base}/p/${clientId}`;
}

async function readMessageSettings(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = ENV_FALLBACK[key]?.trim();
    if (value) map[key] = value;
  }
  return map;
}

function extractError(json: string, httpStatus: number): string {
  try {
    const parsed = JSON.parse(json) as {
      requestError?: { serviceException?: { text?: string } };
      message?: string;
    };
    const message =
      parsed.requestError?.serviceException?.text ??
      (typeof parsed.message === "string" ? parsed.message : null);
    return message ?? `HTTP ${httpStatus}`;
  } catch {
    return (json || `HTTP ${httpStatus}`).slice(0, 300);
  }
}

/**
 * Send one WhatsApp message through the Infobip Messages API.
 * `from` is the registered WhatsApp Business sender number (international
 * MSISDN, e.g. `919876543210`). `to` is the recipient in international format.
 */
async function sendInfobipWhatsApp(
  to: string,
  from: string,
  text: string,
  creds: Record<string, string>
): Promise<NotifyResult> {
  const apiKey = creds["infobip_api_key"];
  const baseUrl = creds["infobip_base_url"];
  if (!apiKey || !baseUrl) {
    return { channel: "none", ok: false, error: "Infobip credentials missing" };
  }
  const destination = to.replace(/^\+/, "");

  try {
    const res = await fetch(`https://${baseUrl}/whatsapp/1/message/text`, {
      method: "POST",
      headers: {
        Authorization: `App ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from,
        to: destination,
        content: { text },
      }),
    });
    const resText = await res.text();
    if (!res.ok) {
      return {
        channel: "whatsapp",
        ok: false,
        error: `Infobip WhatsApp API ${res.status}: ${extractError(resText, res.status)}`,
        status: res.status,
      };
    }
    return { channel: "whatsapp", ok: true };
  } catch (e) {
    return {
      channel: "whatsapp",
      ok: false,
      error: e instanceof Error ? e.message : "Infobip WhatsApp send failed",
    };
  }
}

export async function sendOrderNotification(input: OrderMessageInput): Promise<NotifyResult> {
  const to = toE164(input.mobile);
  if (!to) return { channel: "none", ok: false, error: "Client mobile is not a valid number" };

  const creds = await readMessageSettings();
  const from = creds["infobip_whatsapp_from"];
  if (!from || !creds["infobip_api_key"] || !creds["infobip_base_url"]) {
    return {
      channel: "none",
      ok: false,
      error: "WhatsApp not configured: set INFOBIP_API_KEY, INFOBIP_BASE_URL and INFOBIP_WHATSAPP_FROM",
    };
  }
  if ((creds["infobip_whatsapp_enabled"] ?? "true") !== "true") {
    return { channel: "none", ok: false, error: "WhatsApp messaging is disabled" };
  }

  return sendInfobipWhatsApp(to, from, buildOrderMessage(input), creds);
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
        id: true,
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
      publicProfileUrl: publicProfileUrl(client.id),
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
        client: { select: { id: true, mobile: true, fullName: true } },
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
      publicProfileUrl: publicProfileUrl(order.client.id),
    });
  } catch (e) {
    return {
      channel: "none",
      ok: false,
      error: e instanceof Error ? e.message : "Notify failed",
    };
  }
}