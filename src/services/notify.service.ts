import { prisma } from "../lib/prisma.js";
import { formatINR } from "../lib/money.js";
import type { NotifyResult } from "../lib/types.js";

/**
 * Outbound client notifications — Kapso WhatsApp (Meta Cloud API proxy).
 * Credentials come exclusively from the backend environment variables/secrets:
 * `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WHATSAPP_ENABLED`,
 * `KAPSO_WHATSAPP_TEMPLATE` / `KAPSO_WHATSAPP_DELIVERY_TEMPLATE` (approved
 * template names — body `{{1}}` = order number, `{{2}}` = amount),
 * `KAPSO_WHATSAPP_LANGUAGE` (template language code, default en_US). They are
 * never stored in or read from the database.
 *
 * When no credentials are configured the result is { channel: "none" } so
 * callers can show a copy-ready message instead.
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
  "kapso_api_key",
  "kapso_phone_number_id",
  "kapso_whatsapp_enabled",
  "kapso_whatsapp_template",
  "kapso_whatsapp_delivery_template",
  "kapso_whatsapp_language",
] as const;

const ENV_FALLBACK: Record<string, string | undefined> = {
  kapso_api_key: process.env.KAPSO_API_KEY,
  kapso_phone_number_id: process.env.KAPSO_PHONE_NUMBER_ID,
  kapso_whatsapp_enabled: process.env.KAPSO_WHATSAPP_ENABLED,
  kapso_whatsapp_template: process.env.KAPSO_WHATSAPP_TEMPLATE,
  kapso_whatsapp_delivery_template: process.env.KAPSO_WHATSAPP_DELIVERY_TEMPLATE,
  kapso_whatsapp_language: process.env.KAPSO_WHATSAPP_LANGUAGE,
};

/** Normalize a client mobile to E.164 with a leading "+". */
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

/**
 * Parameters for the approved templates (`order_placed_v3` / `order_ready_v2`,
 * body `{{1}} = order number`, `{{2}} = amount`).
 */
export function buildOrderTemplateParams(input: OrderMessageInput): string[] {
  const due = Math.max(0, input.totalPaise - input.paidPaise);

  const amount =
    input.type === "delivered"
      ? `Total ${formatINR(input.totalPaise)} · Paid ${formatINR(input.paidPaise)}${
          due > 0 ? ` · Balance ${formatINR(due)}` : ""
        }`
      : `Total ${formatINR(input.totalPaise)}${
          due > 0 ? ` · Balance due ${formatINR(due)}` : ""
        }`;

  return [input.orderNumber, amount];
}

async function readChannelSettings(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const key of CHANNEL_KEYS) {
    const value = ENV_FALLBACK[key]?.trim();
    if (value) map[key] = value;
  }
  return map;
}

function extractApiError(resText: string, resStatus: number): string {
  try {
    const parsed: unknown = JSON.parse(resText);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = (parsed as { error?: { message?: string; code?: number | string } }).error;
      const code = error?.code != null ? ` (code ${error.code})` : "";
      return `${error?.message ?? "Unknown error"}${code}`;
    }
  } catch {
    // Fall through to raw text.
  }
  return resText ? resText.slice(0, 300) : `HTTP ${resStatus}`;
}

/** Send one WhatsApp message through Kapso (Meta Cloud API proxy). */
async function sendKapsoWhatsApp(
  toE164Value: string,
  templateName: string | undefined,
  params: string[],
  creds: Record<string, string>
): Promise<NotifyResult> {
  const apiKey = creds["kapso_api_key"];
  const phoneNumberId = creds["kapso_phone_number_id"];
  const template = templateName?.trim();
  const language = creds["kapso_whatsapp_language"]?.trim() || "en_US";
  // Meta Cloud API expects the recipient without the leading "+".
  const to = toE164Value.replace(/\D/g, "");

  let payload: Record<string, unknown>;
  if (template) {
    // Business-initiated messages to clients who haven't messaged first must be
    // an approved template (`order_placed_v3` / `order_ready_v2`). The params
    // are mapped 1:1: {{1}} = order number, {{2}} = amount.
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: language },
        components: [
          {
            type: "body",
            parameters: params.map((text) => ({ type: "text", text })),
          },
        ],
      },
    };
  } else {
    // Plain text works only inside an open 24-hour customer-service window.
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: params.join("\n\n") },
    };
  }

  try {
    const res = await fetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    const resText = await res.text();
    let hasApiError = false;
    try {
      const parsed: unknown = JSON.parse(resText);
      hasApiError =
        (parsed !== null && typeof parsed === "object" && "error" in parsed) ||
        (Array.isArray(parsed) && parsed.some((p) => p && typeof p === "object" && "error" in p));
    } catch {
      // not JSON
    }
    if (!res.ok || hasApiError) {
      return {
        channel: "whatsapp",
        ok: false,
        error: `Kapso WhatsApp API ${res.status}: ${extractApiError(resText, res.status)}`,
      };
    }
    return { channel: "whatsapp", ok: true };
  } catch (e) {
    return {
      channel: "whatsapp",
      ok: false,
      error: e instanceof Error ? e.message : "Kapso WhatsApp send failed",
    };
  }
}

export async function sendOrderNotification(input: OrderMessageInput): Promise<NotifyResult> {
  const to = toE164(input.mobile);
  if (!to) return { channel: "none", ok: false, error: "Client mobile is not a valid number" };

  const creds = await readChannelSettings();
  if (!creds["kapso_api_key"] || !creds["kapso_phone_number_id"]) {
    return { channel: "none", ok: false, error: "No Kapso WhatsApp channel configured" };
  }

  if ((creds["kapso_whatsapp_enabled"] ?? "true") !== "true") {
    return { channel: "none", ok: false, error: "WhatsApp notifications are disabled" };
  }

  const template =
    input.type === "delivered"
      ? (creds["kapso_whatsapp_delivery_template"] ?? "").trim()
      : (creds["kapso_whatsapp_template"] ?? "").trim();

  return sendKapsoWhatsApp(to, template || undefined, buildOrderTemplateParams(input), creds);
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