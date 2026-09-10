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

import { SignJWT } from "jose";

const BRAND_NAME = "Novacore Tailorsoft";

const CHANNEL_KEYS = [
  "vonage_api_key",
  "vonage_api_secret",
  "vonage_application_id",
  "vonage_private_key",
  "vonage_whatsapp_from",
  "vonage_sms_from",
  "vonage_whatsapp_enabled",
  "vonage_sandbox",
] as const;

const ENV_FALLBACK: Record<string, string | undefined> = {
  vonage_api_key: process.env.VONAGE_API_KEY,
  vonage_api_secret: process.env.VONAGE_API_SECRET,
  vonage_application_id: process.env.VONAGE_APPLICATION_ID,
  vonage_private_key: process.env.VONAGE_PRIVATE_KEY,
  vonage_whatsapp_from: process.env.VONAGE_WHATSAPP_FROM,
  vonage_sms_from: process.env.VONAGE_SMS_FROM,
  vonage_whatsapp_enabled: process.env.VONAGE_WHATSAPP_ENABLED,
  vonage_sandbox: process.env.VONAGE_SANDBOX,
};

let _jwtCache: { token: string; exp: number } | null = null;

async function getJwt(creds: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_jwtCache && _jwtCache.exp > now + 30) return _jwtCache.token;

  const appId = creds["vonage_application_id"];
  const privateKeyPem = creds["vonage_private_key"];
  if (!appId || !privateKeyPem) {
    throw new Error("Vonage JWT credentials missing (VONAGE_APPLICATION_ID / VONAGE_PRIVATE_KEY)");
  }

  // Parse PEM → raw base64 → DER ArrayBuffer for Web Crypto API
  const b64 = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const token = await new SignJWT({ application_id: appId })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const exp = now + 300;
  _jwtCache = { token, exp };
  return token;
}

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
  // JWT auth (Application ID + Private Key) for production; falls back to
  // API Key/Secret Basic Auth if JWT fails (e.g., Messages capability not enabled).
  const hasJwtCreds = Boolean(creds["vonage_application_id"] && creds["vonage_private_key"]);
  const sandbox = channel === "whatsapp" && (creds["vonage_sandbox"] || "true") === "true";
  const baseUrl = sandbox
    ? "https://messages-sandbox.nexmo.com/v1/messages"
    : "https://api.nexmo.com/v1/messages";

  async function trySend(authHeader: string): Promise<NotifyResult> {
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
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
          status: res.status,
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

  if (hasJwtCreds) {
    const jwtResult = await trySend(`Bearer ${await getJwt(creds)}`);
    if (jwtResult.ok || jwtResult.status !== 401) return jwtResult;
  }
  // Fallback to Basic Auth (API Key/Secret)
  const apiKey = creds["vonage_api_key"];
  const apiSecret = creds["vonage_api_secret"];
  if (apiKey && apiSecret) {
    return trySend(`Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`);
  }
  return { channel, ok: false, error: "No Vonage credentials configured" };
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