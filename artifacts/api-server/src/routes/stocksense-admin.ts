import { desc, eq, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import {
  db,
  deliveryProfiles,
  inventoryWorkspaces,
  operations,
  stocksenseAdminAccounts,
} from "@workspace/db";
import {
  GetStocksenseAdminAccessResponse,
  ListStocksenseAdminAccountsResponse,
  RequestStocksenseAdminAccessBody,
  RequestStocksenseAdminAccessResponse,
  ReviewStocksenseAdminAccountBody,
  ReviewStocksenseAdminAccountParams,
  ReviewStocksenseAdminAccountResponse,
  SetStocksenseAdminAccountStatusBody,
  SetStocksenseAdminAccountStatusParams,
  SetStocksenseAdminAccountStatusResponse,
  TerminateStocksenseAdminAccountParams,
  TerminateStocksenseAdminAccountResponse,
} from "@workspace/api-zod";
import { isDeliverySupportStaff, requireDeliveryUser } from "../lib/delivery-access";
import { InventoryError } from "../lib/inventory-error";
import { stocksenseAdminAccountCounts, stocksenseAdminAccountStatus } from "../lib/stocksense-admin-state";
import {
  isConfiguredStocksenseMainAdmin,
  requireStocksenseMainAdmin,
  verifiedStocksenseAdminEmail,
} from "../lib/stocksense-admin";

const router: IRouter = Router();
router.use(requireDeliveryUser);

function accountView(row: typeof stocksenseAdminAccounts.$inferSelect) {
  return {
    userId: row.userId,
    requestedAt: row.requestedAt,
    requestStatus: row.requestStatus,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    accessStatus: row.accessStatus,
    accessChangedAt: row.accessChangedAt,
    accessChangedByUserId: row.accessChangedByUserId,
    terminatedAt: row.terminatedAt,
    terminatedByUserId: row.terminatedByUserId,
    displayName: row.displayName,
    verifiedEmail: row.verifiedEmail,
    phone: row.phone,
  };
}

async function accessView(userId: string) {
  if (await isConfiguredStocksenseMainAdmin(userId)) {
    return {
      isMainAdmin: true,
      status: "main_admin" as const,
      requestStatus: null,
      accessStatus: null,
      displayName: null,
      requestCreatedAt: null,
    };
  }
  const [row] = await db.select().from(stocksenseAdminAccounts)
    .where(eq(stocksenseAdminAccounts.userId, userId)).limit(1);
  return {
    isMainAdmin: false,
    status: row ? stocksenseAdminAccountStatus(row.requestStatus, row.accessStatus) : "none",
    requestStatus: row?.requestStatus ?? null,
    accessStatus: row?.accessStatus ?? null,
    displayName: row?.displayName ?? null,
    requestCreatedAt: row?.requestedAt ?? null,
  };
}

router.get("/admin/access", async (_req, res): Promise<void> => {
  const userId = res.locals.deliveryUserId as string;
  res.json(GetStocksenseAdminAccessResponse.parse(await accessView(userId)));
});

router.post("/admin/access-request", async (req, res): Promise<void> => {
  const parsed = RequestStocksenseAdminAccessBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError(parsed.error.message);

  const userId = res.locals.deliveryUserId as string;
  if (await isConfiguredStocksenseMainAdmin(userId)) {
    throw new InventoryError("The main administrator already has Admin access.", 409);
  }
  if (await isDeliverySupportStaff(userId)) {
    throw new InventoryError("Support staff accounts cannot request Admin workspace access.", 409);
  }

  const email = await verifiedStocksenseAdminEmail(userId);
  const name = parsed.data.name.trim();
  if (name.length < 2) throw new InventoryError("Enter your name.");
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [profile] = await tx.select({ userId: deliveryProfiles.userId }).from(deliveryProfiles)
      .where(eq(deliveryProfiles.userId, userId)).limit(1);
    if (profile) {
      throw new InventoryError("This account already has a StockSense role. Use a separate account to request Admin access.", 409);
    }
    const [assignment] = await tx.select({ id: operations.id }).from(operations)
      .where(eq(operations.courierUserId, userId)).limit(1);
    if (assignment) {
      throw new InventoryError("This account already has courier assignments. Use a separate account to request Admin access.", 409);
    }
    const [workspace] = await tx.select({ deletedAt: inventoryWorkspaces.deletedAt })
      .from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, userId)).limit(1);
    if (workspace?.deletedAt) {
      throw new InventoryError("This StockSense workspace was permanently deleted and cannot be reactivated through Admin signup.", 410);
    }

    const [existing] = await tx.select().from(stocksenseAdminAccounts)
      .where(eq(stocksenseAdminAccounts.userId, userId)).limit(1).for("update");
    if (existing?.requestStatus === "pending") return existing;
    if (existing && existing.requestStatus !== "denied") {
      throw new InventoryError("This account already has an Admin access decision.", 409);
    }
    if (existing) {
      const [resubmitted] = await tx.update(stocksenseAdminAccounts).set({
        requestedAt: new Date(),
        requestStatus: "pending",
        reviewedAt: null,
        reviewedByUserId: null,
        accessStatus: null,
        accessChangedAt: null,
        accessChangedByUserId: null,
        terminatedAt: null,
        terminatedByUserId: null,
        displayName: name,
        verifiedEmail: email,
        phone: parsed.data.phone,
      }).where(eq(stocksenseAdminAccounts.userId, userId)).returning();
      return resubmitted;
    }
    const [created] = await tx.insert(stocksenseAdminAccounts).values({
      userId,
      displayName: name,
      verifiedEmail: email,
      phone: parsed.data.phone,
    }).returning();
    return created;
  });

  res.json(RequestStocksenseAdminAccessResponse.parse({
    isMainAdmin: false,
    status: stocksenseAdminAccountStatus(updated.requestStatus, updated.accessStatus),
    requestStatus: updated.requestStatus,
    accessStatus: updated.accessStatus,
    displayName: updated.displayName,
    requestCreatedAt: updated.requestedAt,
  }));
});

router.get("/admin/accounts", requireStocksenseMainAdmin, async (_req, res): Promise<void> => {
  const userId = res.locals.deliveryUserId as string;
  const accounts = await db.select().from(stocksenseAdminAccounts)
    .where(ne(stocksenseAdminAccounts.userId, userId))
    .orderBy(desc(stocksenseAdminAccounts.requestedAt));
  res.json(ListStocksenseAdminAccountsResponse.parse({
    counts: stocksenseAdminAccountCounts(accounts),
    accounts: accounts.map(accountView),
  }));
});

router.patch("/admin/accounts/:userId/review", requireStocksenseMainAdmin, async (req, res): Promise<void> => {
  const params = ReviewStocksenseAdminAccountParams.safeParse(req.params);
  const parsed = ReviewStocksenseAdminAccountBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    throw new InventoryError("Choose whether to accept or deny this Admin request.");
  }
  const reviewerId = res.locals.deliveryUserId as string;
  if (params.data.userId === reviewerId) {
    throw new InventoryError("The main administrator cannot review or change their own Admin account.", 409);
  }
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.data.userId}))`);
    const [account] = await tx.select().from(stocksenseAdminAccounts)
      .where(eq(stocksenseAdminAccounts.userId, params.data.userId)).limit(1).for("update");
    if (!account) throw new InventoryError("Admin access request not found.", 404);
    if (account.requestStatus !== "pending") {
      throw new InventoryError("This Admin request has already been reviewed.", 409);
    }

    let accessStatus: "active" | null = null;
    if (parsed.data.status === "accepted") {
      const [profile] = await tx.select().from(deliveryProfiles)
        .where(eq(deliveryProfiles.userId, account.userId)).limit(1);
      const [assignment] = await tx.select({ id: operations.id }).from(operations)
        .where(eq(operations.courierUserId, account.userId)).limit(1);
      const [workspace] = await tx.select({ deletedAt: inventoryWorkspaces.deletedAt })
        .from(inventoryWorkspaces).where(eq(inventoryWorkspaces.ownerId, account.userId)).limit(1);
      if (profile || assignment || workspace?.deletedAt) {
        throw new InventoryError("This account can no longer be safely provisioned as an Admin workspace.", 409);
      }

      await tx.insert(deliveryProfiles).values({
        userId: account.userId,
        role: "owner",
        name: account.displayName,
        email: account.verifiedEmail,
        phone: account.phone,
      });
      await tx.insert(inventoryWorkspaces).values({ ownerId: account.userId }).onConflictDoNothing();
      accessStatus = "active";
    }

    const now = new Date();
    const [reviewed] = await tx.update(stocksenseAdminAccounts).set({
      requestStatus: parsed.data.status,
      reviewedAt: now,
      reviewedByUserId: reviewerId,
      accessStatus,
      accessChangedAt: accessStatus ? now : null,
      accessChangedByUserId: accessStatus ? reviewerId : null,
    }).where(eq(stocksenseAdminAccounts.userId, account.userId)).returning();
    return reviewed;
  });
  res.json(ReviewStocksenseAdminAccountResponse.parse(accountView(updated)));
});

router.patch("/admin/accounts/:userId/status", requireStocksenseMainAdmin, async (req, res): Promise<void> => {
  const params = SetStocksenseAdminAccountStatusParams.safeParse(req.params);
  const parsed = SetStocksenseAdminAccountStatusBody.safeParse(req.body);
  if (!params.success || !parsed.success) throw new InventoryError("Choose Active or Inactive.");
  const changedBy = res.locals.deliveryUserId as string;
  if (params.data.userId === changedBy) {
    throw new InventoryError("The main administrator cannot change their own Admin account.", 409);
  }
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.data.userId}))`);
    const [account] = await tx.select().from(stocksenseAdminAccounts)
      .where(eq(stocksenseAdminAccounts.userId, params.data.userId)).limit(1).for("update");
    if (!account) throw new InventoryError("Admin account not found.", 404);
    if (account.requestStatus !== "accepted" || account.accessStatus === "terminated" || !account.accessStatus) {
      throw new InventoryError("Only accepted, non-terminated Admin accounts can change status.", 409);
    }
    if (account.accessStatus === parsed.data.status) return account;
    const [saved] = await tx.update(stocksenseAdminAccounts).set({
      accessStatus: parsed.data.status,
      accessChangedAt: new Date(),
      accessChangedByUserId: changedBy,
    }).where(eq(stocksenseAdminAccounts.userId, account.userId)).returning();
    return saved;
  });
  res.json(SetStocksenseAdminAccountStatusResponse.parse(accountView(updated)));
});

router.post("/admin/accounts/:userId/terminate", requireStocksenseMainAdmin, async (req, res): Promise<void> => {
  const params = TerminateStocksenseAdminAccountParams.safeParse(req.params);
  if (!params.success) throw new InventoryError("Choose an Admin account to terminate.");
  const terminatedBy = res.locals.deliveryUserId as string;
  if (params.data.userId === terminatedBy) {
    throw new InventoryError("The main administrator cannot terminate their own account.", 409);
  }
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.data.userId}))`);
    const [account] = await tx.select().from(stocksenseAdminAccounts)
      .where(eq(stocksenseAdminAccounts.userId, params.data.userId)).limit(1).for("update");
    if (!account) throw new InventoryError("Admin account not found.", 404);
    if (account.requestStatus !== "accepted" || account.accessStatus === "terminated" || !account.accessStatus) {
      throw new InventoryError("Only accepted, non-terminated Admin accounts can be terminated.", 409);
    }
    const now = new Date();
    const [saved] = await tx.update(stocksenseAdminAccounts).set({
      accessStatus: "terminated",
      accessChangedAt: now,
      accessChangedByUserId: terminatedBy,
      terminatedAt: now,
      terminatedByUserId: terminatedBy,
    }).where(eq(stocksenseAdminAccounts.userId, account.userId)).returning();
    return saved;
  });
  res.json(TerminateStocksenseAdminAccountResponse.parse(accountView(updated)));
});

export default router;