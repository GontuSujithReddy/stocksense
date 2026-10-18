import { clerkClient } from "@clerk/express";
import type { RequestHandler } from "express";
import { InventoryError } from "./inventory-error";

export async function verifiedStocksenseAdminEmail(userId: string): Promise<string> {
  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    user = await clerkClient.users.getUser(userId);
  } catch {
    throw new InventoryError("Couldn't verify the signed-in account. Please retry.", 503);
  }

  const address = user.emailAddresses.find(email =>
    email.id === user.primaryEmailAddressId && email.verification?.status === "verified",
  ) ?? user.emailAddresses.find(email => email.verification?.status === "verified");
  if (!address) {
    throw new InventoryError("Verify your account email before requesting Admin access.", 403);
  }
  return address.emailAddress.trim().toLowerCase();
}

export async function isConfiguredStocksenseMainAdmin(userId: string): Promise<boolean> {
  const configuredEmail = process.env.STOCKSENSE_MAIN_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredEmail) {
    throw new InventoryError("The StockSense main administrator is not configured.", 503);
  }

  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    user = await clerkClient.users.getUser(userId);
  } catch {
    throw new InventoryError("Couldn't verify the administrator's sign-in details. Please retry.", 503);
  }
  return user.emailAddresses.some(address =>
    address.verification?.status === "verified"
      && address.emailAddress.trim().toLowerCase() === configuredEmail,
  );
}

export const requireStocksenseMainAdmin: RequestHandler = async (_req, res, next) => {
  try {
    if (!await isConfiguredStocksenseMainAdmin(res.locals.deliveryUserId as string)) {
      throw new InventoryError("Only the configured StockSense main administrator can manage Admin accounts.", 403);
    }
    next();
  } catch (error) {
    next(error);
  }
};