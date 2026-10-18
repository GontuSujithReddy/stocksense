import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, deliveryProfiles, operations, stocksenseAdminAccounts } from "@workspace/db";
import { InventoryError } from "./inventory-error";
import { isDeliverySupportStaff } from "./delivery-support-auth";
import { stocksenseAdminRole } from "./stocksense-admin-state";
export { isDeliverySupportAdmin, isDeliverySupportStaff, requireDeliverySupportAdmin, requireDeliverySupportStaff } from "./delivery-support-auth";

export type DeliveryRole = "owner" | "courier" | "support_staff" | null;

export const requireDeliveryUser: RequestHandler = (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Please sign in to access deliveries." });
    return;
  }
  res.locals.deliveryUserId = userId;
  next();
};

export async function deliveryRole(userId: string): Promise<DeliveryRole> {
  const [adminAccount] = await db.select({
    requestStatus: stocksenseAdminAccounts.requestStatus,
    accessStatus: stocksenseAdminAccounts.accessStatus,
  }).from(stocksenseAdminAccounts).where(eq(stocksenseAdminAccounts.userId, userId)).limit(1);
  if (adminAccount) {
    const role = stocksenseAdminRole(adminAccount.requestStatus, adminAccount.accessStatus);
    if (role !== undefined) return role;
  }
  if (await isDeliverySupportStaff(userId)) return "support_staff";
  const [profile] = await db.select().from(deliveryProfiles).where(eq(deliveryProfiles.userId, userId)).limit(1);
  if (profile) return profile.role as "owner" | "courier";
  const [assignment] = await db.select({ id: operations.id }).from(operations)
    .where(eq(operations.courierUserId, userId)).limit(1);
  return assignment ? "courier" : null;
}

export const requireDeliveryOwner: RequestHandler = async (_req, res, next) => {
  try {
    const role = await deliveryRole(res.locals.deliveryUserId);
    if (role === "courier") throw new InventoryError("Courier accounts can access only their assigned deliveries.", 403);
    if (role === "support_staff") throw new InventoryError("Support staff cannot access owner workspaces.", 403);
    next();
  } catch (error) {
    next(error);
  }
};

export async function accessibleDelivery(id: number, userId: string) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new InventoryError("Delivery not found.", 404);
  const [operation] = await db.select().from(operations).where(and(
    eq(operations.id, id),
    eq(operations.type, "delivery"),
    or(eq(operations.ownerId, userId), eq(operations.courierUserId, userId)),
  )).limit(1);
  if (!operation) throw new InventoryError("Delivery not found.", 404);
  return operation;
}