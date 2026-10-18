import { ReplitConnectors } from "@replit/connectors-sdk";

export type StocksenseSupportAccessNotice = {
  userId: string;
  displayName: string;
  verifiedEmail: string;
};

export async function sendStocksenseSupportAccessNotice(notice: StocksenseSupportAccessNotice): Promise<void> {
  const adminEmail = process.env.STOCKSENSE_SUPPORT_ADMIN_EMAIL?.trim();
  const fromEmail = process.env.STOCKSENSE_SUPPORT_FROM_EMAIL?.trim();
  if (!adminEmail) {
    throw new Error("The StockSense support administrator email is not configured.");
  }
  if (!fromEmail) {
    throw new Error("The StockSense support sender email is not configured.");
  }

  const connectors = new ReplitConnectors();
  let response: Response;
  try {
    response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `StockSense <${fromEmail}>`,
        to: [adminEmail],
        reply_to: notice.verifiedEmail,
        subject: "StockSense support access request",
        text: [
          "A new StockSense customer-service access request is waiting for review.",
          "",
          `Name: ${notice.displayName}`,
          `Verified email: ${notice.verifiedEmail}`,
          `Clerk user ID: ${notice.userId}`,
          "",
          "Staff access is granted separately by an administrator.",
        ].join("\n"),
      }),
    });
  } catch {
    throw new Error("Resend could not accept the StockSense support notification.");
  }

  if (!response.ok) {
    throw new Error(`Resend rejected the StockSense support notification (HTTP ${response.status}).`);
  }
}