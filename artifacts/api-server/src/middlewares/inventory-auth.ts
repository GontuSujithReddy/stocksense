import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { ensureInventoryWorkspace } from "../lib/inventory-workspace";
import { deliveryRole } from "../lib/delivery-access";
import { stocksenseAdminAccessUnavailableStatus } from "../lib/stocksense-admin-state";
import { db, inventoryWorkspaces, stocksenseAdminAccounts } from "@workspace/db";
import { eq } from "drizzle-orm";

export const requireInventoryAuth: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Please sign in to access your inventory." });
    return;
  }

  res.locals.ownerId = userId;
  try {
    const role = await deliveryRole(userId);
    if (role === null) {
      const [adminAccount] = await db.select({
        requestStatus: stocksenseAdminAccounts.requestStatus,
        accessStatus: stocksenseAdminAccounts.accessStatus,
      }).from(stocksenseAdminAccounts).where(eq(stocksenseAdminAccounts.userId, userId)).limit(1);
      if (adminAccount) {
        const unavailableStatus = stocksenseAdminAccessUnavailableStatus(adminAccount.requestStatus, adminAccount.accessStatus);
        if (unavailableStatus) {
          res.status(403).json({ error: `Your StockSense Admin access is ${unavailableStatus}.` });
          return;
        }
      }
    }
    if (role === "support_staff") {
      res.status(403).json({ error: "Support staff cannot access owner workspaces." });
      return;
    }
    if (role === "courier") {
      if (/^\/operations\/\d+\/delivery\/(start|reach|complete)$/.test(req.path) && req.method === "POST") {
        next();
        return;
      }
      res.status(403).json({ error: "Courier accounts can access only their assigned deliveries." });
      return;
    }
    await ensureInventoryWorkspace(userId);
    const [workspace] = await db
      .select({ deletedAt: inventoryWorkspaces.deletedAt })
      .from(inventoryWorkspaces)
      .where(eq(inventoryWorkspaces.ownerId, userId))
      .limit(1);
    if (workspace?.deletedAt) {
      res.status(410).json({ error: "Your StockSense workspace has been permanently deleted." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};