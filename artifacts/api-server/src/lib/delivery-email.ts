import { ReplitConnectors } from "@replit/connectors-sdk";
import type { Request } from "express";

async function sendEmail(input: { to: string; subject: string; text: string }): Promise<void> {
  const fromEmail = process.env.STOCKSENSE_SUPPORT_FROM_EMAIL?.trim();
  if (!fromEmail) throw new Error("The StockSense email sender is not configured.");

  const connectors = new ReplitConnectors();
  let response: Response;
  try {
    response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `StockSense <${fromEmail}>`,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
  } catch {
    throw new Error("Resend could not accept the StockSense delivery email.");
  }

  if (!response.ok) {
    throw new Error(`Resend rejected the StockSense delivery email (HTTP ${response.status}).`);
  }
}

export async function sendDeliveryOtpEmail(input: {
  to: string;
  customerName: string | null;
  reference: string;
  otp: string;
}): Promise<void> {
  await sendEmail({
    to: input.to,
    subject: `Your delivery confirmation code for ${input.reference}`,
    text: [
      `Hello${input.customerName?.trim() ? ` ${input.customerName.trim()}` : ""},`,
      "",
      `Your courier has reached the destination for delivery ${input.reference}.`,
      `Share this six-digit code with the courier to confirm receipt: ${input.otp}`,
      "",
      "This code expires in 10 minutes. If you did not expect this delivery, do not share the code.",
    ].join("\n"),
  });
}

export function deliveryChatLink(req: Request, token: string): string {
  const host = req.get("host");
  if (!host) throw new Error("The delivery chat link could not be created.");
  const origin = req.get("origin") || `${req.protocol}://${host}`;
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The delivery chat link could not be created.");
  }
  if (url.host.toLowerCase() !== host.toLowerCase()) {
    throw new Error("The delivery chat link could not be created.");
  }
  const artifactBasePath = req.baseUrl.replace(/\/api\/?$/, "");
  url.pathname = `${artifactBasePath}/delivery-chat`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = token;
  return url.toString();
}

export async function sendDeliveryChatEmail(input: {
  to: string;
  customerName: string | null;
  reference: string;
  message: string;
  chatUrl: string;
}): Promise<void> {
  await sendEmail({
    to: input.to,
    subject: `Message about your delivery ${input.reference}`,
    text: [
      `Hello${input.customerName?.trim() ? ` ${input.customerName.trim()}` : ""},`,
      "",
      `Your courier sent a message about delivery ${input.reference}:`,
      "",
      input.message,
      "",
      "Reply securely in the delivery chat:",
      input.chatUrl,
      "",
      "This private link expires in 30 days. Do not forward it to anyone else.",
    ].join("\n"),
  });
}
