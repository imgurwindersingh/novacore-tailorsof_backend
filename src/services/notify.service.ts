import { prisma } from "../lib/prisma.js";
import { formatINR } from "../lib/money.js";
import type { NotifyResult } from "../lib/types.js";

/**
 * Outbound client notifications — Twilio (WhatsApp first, SMS fallback).
 * Credentials come exclusively from the backend environment variables/secrets:
 * `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
 * `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_ENABLED`, `TWILIO_TRIAL_MODE`.
 * They are never stored in or read from the database.
 *
 * The Twilio REST API is called directly (Basic Auth with Account SID +
 * Auth Token) so no SDK dependency is required on Cloudflare Workers.
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

const ENV_KEYS = [
  "twilio_account_sid",
  "twilio_auth_token",
  "twilio_phone_number",
  "twilio_whatsapp_from",
  "twilio_whatsapp_enabled",
] as const;

const ENV_FALLBACK: Record<string, string | undefined> = {
  twilio_account_sid: process.env.TWILIO_ACCOUNT_SID,
  twilio_auth_token: process.env.TWILIO_AUTH_TOKEN,
  twilio_phone_number: process.env.TWILIO_PHONE_NUMBER,
  twilio_whatsapp_from: process.env.TWILIO_WHATSAPP_FROM,
  twilio_whatsapp_enabled: process.env.TWILIO_WHATSAPP_ENABLED,
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

/** Add the `whatsapp:` address-prefix used by the Twilio Messages API. */
function withChannelPrefix(number: string, channel: "whatsapp" | "sms"): string {
  if (channel === "whatsapp" && !number.toLowerCase().startsWith("whatsapp:")) {
    return `whatsapp:${number}`;
  }
  return number;
}

export function buildOrderMessage(input: OrderMessageInput): string {
  const greeting = input.fullName ? `Namaste ${input.fullName} 🙏` : "Namaste 🙏";
  const items = input.items.map((i) => `${i.quantity}x ${i.garmentType}`).join(", ");
  const due = Math.max(0, input.totalPaise - input.paidPaise);

  if (input.type === "delivered") {
    return [
      greeting,
      `Your order ${input.orderNumber} at ${BRAND_NAME} is ready for pickup!`,
      `Items: ${items}`,
      `Total: ${formatINR(input.totalPaise)}${due > 0 ? ` | Balance: ${formatINR(due)}` : ""}`,
      "Thank you for choosing us - see you soon!",
    ].join("\n");
  }

  return [
    greeting,
    `Welcome to ${BRAND_NAME}! Your order ${input.orderNumber} has been placed successfully.`,
    `Items: ${items}`,
    `Total: ${formatINR(input.totalPaise)}${due > 0 ? ` | Balance due: ${formatINR(due)}` : ""}`,
    "Thank you for choosing us. We will keep you updated!",
  ].join("\n");
}

async function readChannelSettings(): Promise<Record<string, string>> {
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
      message?: string;
      code?: number | string;
      more_info?: string;
    };
    return parsed.message
      ? `${parsed.message}${parsed.code ? ` (code ${parsed.code})` : ""}`
      : `HTTP ${httpStatus}`;
  } catch {
    return (json || `HTTP ${httpStatus}`).slice(0, 300);
  }
}

/** Send one message through the Twilio Messages API on a given channel. */
async function sendTwilio(
  to: string,
  from: string,
  body: string,
  channel: "whatsapp" | "sms",
  creds: Record<string, string>
): Promise<NotifyResult> {
  const accountSid = creds["twilio_account_sid"];
  const authToken = creds["twilio_auth_token"];
  if (!accountSid || !authToken) {
    return { channel: "none", ok: false, error: "Twilio credentials missing" };
  }
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const formBody = new URLSearchParams({
    To: withChannelPrefix(to, channel),
    From: withChannelPrefix(from, channel),
    Body: body,
  });

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formBody.toString(),
      }
    );
    const resText = await res.text();
    if (!res.ok) {
      return {
        channel,
        ok: false,
        error: `Twilio ${channel} API ${res.status}: ${extractError(resText, res.status)}`,
        status: res.status,
      };
    }
    return { channel, ok: true };
  } catch (e) {
    return {
      channel,
      ok: false,
      error: e instanceof Error ? e.message : `Twilio ${channel} send failed`,
    };
  }
}

export async function sendOrderNotification(input: OrderMessageInput): Promise<NotifyResult> {
  const to = toE164(input.mobile);
  if (!to) return { channel: "none", ok: false, error: "Client mobile is not a valid number" };

  const creds = await readChannelSettings();
  const smsFrom = creds["twilio_phone_number"];
  if (!smsFrom || !creds["twilio_account_sid"] || !creds["twilio_auth_token"]) {
    return {
      channel: "none",
      ok: false,
      error: "Nothing configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER",
    };
  }

  // Trial accounts reject custom message bodies ("predefined templates only").
  // We always try the full custom order message first, then automatically fall
  // back to Twilio's predefined template when the account is still on trial.
  const customBody = buildOrderMessage(input);
  const trialTemplateBody =
    input.type === "delivered" ? "sms_delivery_updates" : "sms_order_confirmation";

  const isTrialRestriction = (result: NotifyResult) =>
    result.ok === false &&
    (/template/i.test(result.error ?? "") || /21654|572006/i.test(result.error ?? ""));

  async function sendSms(): Promise<NotifyResult> {
    let sms = await sendTwilio(to, smsFrom, customBody, "sms", creds);
    if (!sms.ok && isTrialRestriction(sms)) {
      sms = await sendTwilio(to, smsFrom, trialTemplateBody, "sms", creds);
    }
    return sms;
  }

  const whatsappEnabled =
    (creds["twilio_whatsapp_enabled"] ?? "true") === "true";
  const whatsappFrom = creds["twilio_whatsapp_from"]?.trim();

  // Send WhatsApp AND SMS together so the client gets both messages.
  if (whatsappEnabled && whatsappFrom) {
    const [whatsapp, sms] = await Promise.all([
      sendTwilio(to, whatsappFrom, customBody, "whatsapp", creds),
      sendSms(),
    ]);
    const sent = (["whatsapp", "sms"] as const).filter(
      (ch) => (ch === "whatsapp" ? whatsapp.ok : sms.ok)
    );
    if (sent.length > 0) {
      return {
        channel: sent.length === 2 ? "whatsapp" : sent[0],
        ok: true,
        ...(sent.length === 2 ? { channels: ["whatsapp", "sms"] as const } : {}),
      };
    }
    return {
      channel: "none",
      ok: false,
      error: `WhatsApp failed (${whatsapp.error}); SMS failed (${sms.error})`,
    };
  }

  return sendSms();
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