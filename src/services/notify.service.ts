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
  "infobip_whatsapp_sender",
  "infobip_whatsapp_enabled",
  "infobip_sms_from",
  "infobip_sms_enabled",
  "infobip_whatsapp_template_welcome",
  "infobip_whatsapp_template_order",
  "infobip_whatsapp_template_payment",
  "infobip_whatsapp_template_delivered",
  "infobip_whatsapp_template_language",
] as const;

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
  // Read at send time. In local Node development dotenv is loaded after module
  // imports, and static environment snapshots would otherwise miss .env values.
  const environment: Record<string, string | undefined> = {
    infobip_api_key: process.env.INFOBIP_API_KEY,
    infobip_base_url: process.env.INFOBIP_BASE_URL,
    infobip_whatsapp_from: process.env.INFOBIP_WHATSAPP_FROM,
    // Use this alternate secret when an older Worker variable already owns
    // INFOBIP_WHATSAPP_FROM in Cloudflare.
    infobip_whatsapp_sender: process.env.INFOBIP_WHATSAPP_SENDER,
    infobip_whatsapp_enabled: process.env.INFOBIP_WHATSAPP_ENABLED,
    infobip_sms_from: process.env.INFOBIP_SMS_FROM,
    infobip_sms_enabled: process.env.INFOBIP_SMS_ENABLED,
    infobip_whatsapp_template_welcome: process.env.INFOBIP_WHATSAPP_TEMPLATE_WELCOME,
    infobip_whatsapp_template_order: process.env.INFOBIP_WHATSAPP_TEMPLATE_ORDER,
    infobip_whatsapp_template_payment: process.env.INFOBIP_WHATSAPP_TEMPLATE_PAYMENT,
    infobip_whatsapp_template_delivered: process.env.INFOBIP_WHATSAPP_TEMPLATE_DELIVERED,
    infobip_whatsapp_template_language: process.env.INFOBIP_WHATSAPP_TEMPLATE_LANGUAGE,
  };
  const map: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = environment[key]?.trim();
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

/** Send an approved Meta template, which works outside WhatsApp's 24-hour window. */
async function sendInfobipWhatsAppTemplate(
  to: string,
  from: string,
  templateName: string,
  placeholders: string[],
  creds: Record<string, string>
): Promise<NotifyResult> {
  const apiKey = creds["infobip_api_key"];
  const baseUrl = creds["infobip_base_url"];
  if (!apiKey || !baseUrl) return { channel: "none", ok: false, error: "Infobip credentials missing" };

  try {
    const res = await fetch(`https://${baseUrl}/whatsapp/1/message/template`, {
      method: "POST",
      headers: {
        Authorization: `App ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{
          from,
          to: to.replace(/^\+/, ""),
          messageId: crypto.randomUUID(),
          content: {
            templateName,
            templateData: { body: { placeholders } },
            language: creds["infobip_whatsapp_template_language"] || "en",
          },
        }],
      }),
    });
    const resText = await res.text();
    if (!res.ok) {
      return {
        channel: "whatsapp",
        ok: false,
        error: `Infobip WhatsApp template API ${res.status}: ${extractError(resText, res.status)}`,
        status: res.status,
      };
    }
    return { channel: "whatsapp", ok: true };
  } catch (e) {
    return { channel: "whatsapp", ok: false, error: e instanceof Error ? e.message : "Infobip template send failed" };
  }
}

/** Send SMS through Infobip as a fallback when WhatsApp is unavailable. */
async function sendInfobipSms(
  to: string,
  from: string,
  text: string,
  creds: Record<string, string>
): Promise<NotifyResult> {
  const apiKey = creds["infobip_api_key"];
  const baseUrl = creds["infobip_base_url"];
  if (!apiKey || !baseUrl) return { channel: "none", ok: false, error: "Infobip credentials missing" };

  try {
    const res = await fetch(`https://${baseUrl}/sms/3/messages`, {
      method: "POST",
      headers: {
        Authorization: `App ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages: [{ from, destinations: [{ to: to.replace(/^\+/, "") }], text }],
      }),
    });
    const resText = await res.text();
    if (!res.ok) {
      return {
        channel: "sms",
        ok: false,
        error: `Infobip SMS API ${res.status}: ${extractError(resText, res.status)}`,
        status: res.status,
      };
    }
    return { channel: "sms", ok: true };
  } catch (e) {
    return { channel: "sms", ok: false, error: e instanceof Error ? e.message : "Infobip SMS send failed" };
  }
}

/**
 * Prefer WhatsApp, then use SMS for essential transactional messages. Both
 * channels are independently switchable, so a missing paid plan never blocks
 * order or payment creation.
 */
async function sendClientMessage(
  mobile: string,
  text: string,
  template?: { name?: string; placeholders: string[] }
): Promise<NotifyResult> {
  const to = toE164(mobile);
  if (!to) return { channel: "none", ok: false, error: "Client mobile is not a valid number" };

  const creds = await readMessageSettings();
  const whatsappFrom = creds["infobip_whatsapp_sender"] ?? creds["infobip_whatsapp_from"];
  const whatsappEnabled = (creds["infobip_whatsapp_enabled"] ?? "true") === "true";
  let whatsappError: string | undefined;
  if (whatsappEnabled && whatsappFrom && creds["infobip_api_key"] && creds["infobip_base_url"]) {
    // Templates are required for messages outside the 24-hour customer-service window.
    // When no template is configured, retain free-form delivery for customers who
    // have already contacted the business, then fall back to SMS on rejection.
    const result = template?.name
      ? await sendInfobipWhatsAppTemplate(to, whatsappFrom, template.name, template.placeholders, creds)
      : await sendInfobipWhatsApp(to, whatsappFrom, text, creds);
    if (result.ok) return result;
    whatsappError = result.error;
  }

  const smsFrom = creds["infobip_sms_from"];
  const smsEnabled = (creds["infobip_sms_enabled"] ?? "true") === "true";
  if (smsEnabled && smsFrom && creds["infobip_api_key"] && creds["infobip_base_url"]) {
    const result = await sendInfobipSms(to, smsFrom, text, creds);
    if (result.ok) return result;
    return { ...result, error: whatsappError ? `WhatsApp failed (${whatsappError}); SMS failed (${result.error})` : result.error };
  }

  return {
    channel: "none",
    ok: false,
    error: whatsappError ?? "Messaging not configured: set Infobip WhatsApp or SMS credentials",
  };
}

export async function sendOrderNotification(input: OrderMessageInput): Promise<NotifyResult> {
  const due = Math.max(0, input.totalPaise - input.paidPaise);
  const templateKey = input.type === "delivered"
    ? "infobip_whatsapp_template_delivered"
    : "infobip_whatsapp_template_order";
  return sendClientMessage(input.mobile, buildOrderMessage(input), {
    name: (await readMessageSettings())[templateKey],
    placeholders: [
      input.fullName?.trim() || "Customer",
      input.orderNumber,
      formatINR(input.totalPaise),
      formatINR(due),
    ],
  });
}

/** Send a welcome message once a new client has been registered. */
export async function notifyClientWelcome(clientId: string): Promise<NotifyResult> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { fullName: true, mobile: true },
    });
    if (!client) return { channel: "none", ok: false, error: "Client not found" };
    const name = client.fullName.trim() || "Customer";
    return sendClientMessage(
      client.mobile,
      `Welcome to ${BRAND_NAME}, ${name}. We have saved your profile and measurements. We will keep you updated about your orders. Thank you for choosing us.`,
      {
        name: (await readMessageSettings())["infobip_whatsapp_template_welcome"],
        placeholders: [name],
      }
    );
  } catch (e) {
    return { channel: "none", ok: false, error: e instanceof Error ? e.message : "Welcome notification failed" };
  }
}

/** Send a payment receipt after a new payment is saved. */
export async function notifyPaymentRecorded(paymentId: string): Promise<NotifyResult> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        amountPaise: true,
        order: {
          select: {
            orderNumber: true,
            totalPaise: true,
            payments: { select: { amountPaise: true } },
            client: { select: { fullName: true, mobile: true } },
          },
        },
      },
    });
    if (!payment) return { channel: "none", ok: false, error: "Payment not found" };
    const paid = payment.order.payments.reduce((sum, item) => sum + item.amountPaise, 0);
    const due = Math.max(0, payment.order.totalPaise - paid);
    const name = payment.order.client.fullName.trim() || "Customer";
    return sendClientMessage(
      payment.order.client.mobile,
      `Dear ${name}, we received ${formatINR(payment.amountPaise)} for order ${payment.order.orderNumber} at ${BRAND_NAME}. Total paid: ${formatINR(paid)}${due > 0 ? `. Balance due: ${formatINR(due)}.` : ". Your order is fully paid."} Thank you.`,
      {
        name: (await readMessageSettings())["infobip_whatsapp_template_payment"],
        placeholders: [name, payment.order.orderNumber, formatINR(payment.amountPaise), formatINR(paid), formatINR(due)],
      }
    );
  } catch (e) {
    return { channel: "none", ok: false, error: e instanceof Error ? e.message : "Payment notification failed" };
  }
}

/**
 * Authenticated, explicit demo send for the shop owner. This does not create
 * client/order/payment data and is useful for verifying a newly funded sender.
 */
export async function sendNotificationTest(
  mobile: string,
  event: "welcome" | "order" | "payment" | "delivered"
): Promise<NotifyResult> {
  const configs = await readMessageSettings();
  const templates = {
    welcome: {
      key: "infobip_whatsapp_template_welcome",
      text: `Welcome to ${BRAND_NAME}, Demo Client. This is a test message from your tailor shop.`,
      placeholders: ["Demo Client"],
    },
    order: {
      key: "infobip_whatsapp_template_order",
      text: `Dear Demo Client, your order DEMO-0001 has been confirmed. Total: ₹1,000.00. Balance due: ₹500.00.`,
      placeholders: ["Demo Client", "DEMO-0001", "₹1,000.00", "₹500.00"],
    },
    payment: {
      key: "infobip_whatsapp_template_payment",
      text: `Dear Demo Client, we received ₹500.00 for order DEMO-0001. Total paid: ₹500.00. Balance due: ₹500.00.`,
      placeholders: ["Demo Client", "DEMO-0001", "₹500.00", "₹500.00", "₹500.00"],
    },
    delivered: {
      key: "infobip_whatsapp_template_delivered",
      text: `Dear Demo Client, order DEMO-0001 is ready for pickup. Total: ₹1,000.00. Balance: ₹0.00.`,
      placeholders: ["Demo Client", "DEMO-0001", "₹1,000.00", "₹0.00"],
    },
  } as const;
  const message = templates[event];
  return sendClientMessage(mobile, message.text, {
    name: configs[message.key],
    placeholders: [...message.placeholders],
  });
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
