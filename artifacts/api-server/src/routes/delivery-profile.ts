import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import { db, deliveryProfiles, categories, products, warehouses, operations, stocksenseAdminAccounts } from "@workspace/db";
import {
  GetDeliveryProfileResponse, SaveDeliveryProfileBody, SaveDeliveryProfileResponse,
  LookupRegisteredCourierQueryParams, LookupRegisteredCourierResponse,
} from "@workspace/api-zod";
import { deliveryRole, isDeliverySupportAdmin, isDeliverySupportStaff, requireDeliveryOwner } from "../lib/delivery-access";
import { InventoryError } from "../lib/inventory-error";

const router: IRouter = Router();

async function identity(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId && address.verification?.status === "verified")
    ?? user.emailAddresses.find(address => address.verification?.status === "verified");
  if (!email) throw new InventoryError("Verify your account email before registering your delivery profile.", 403);
  return { name: user.fullName ?? user.firstName ?? "", email: email.emailAddress.toLowerCase() };
}

router.get("/profile", async (_req, res) => {
  const userId = res.locals.deliveryUserId as string;
  const [profile] = await db.select().from(deliveryProfiles)
    .where(eq(deliveryProfiles.userId, userId)).limit(1);
  const account = await identity(userId);
  res.json(GetDeliveryProfileResponse.parse({
    userId, name: profile?.name ?? account.name, email: account.email,
    phone: profile?.phone ?? "", role: await deliveryRole(userId),
    canManageSupportStaff: isDeliverySupportAdmin(userId),
  }));
});

router.put("/profile", async (req, res) => {
  const parsed = SaveDeliveryProfileBody.safeParse(req.body);
  if (!parsed.success) {
    throw new InventoryError(parsed.error.issues.some(issue => issue.path[0] === "phone")
      ? "Enter a phone number with exactly 10 digits, without a country code."
      : parsed.error.message);
  }
  const userId = res.locals.deliveryUserId as string;
  if (await isDeliverySupportStaff(userId)) {
    throw new InventoryError("Support staff access is assigned by an administrator and cannot be changed here.", 403);
  }
  const account = await identity(userId);
  const data = parsed.data;
  const name = data.name.trim();
  if (!name) throw new InventoryError("Enter your name.");
  const profile = await db.transaction(async tx => {
    // Serializes first-time role selection as well as subsequent profile changes.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [adminAccount] = await tx.select({
      requestStatus: stocksenseAdminAccounts.requestStatus,
      accessStatus: stocksenseAdminAccounts.accessStatus,
    }).from(stocksenseAdminAccounts).where(eq(stocksenseAdminAccounts.userId, userId)).limit(1);
    if (adminAccount?.requestStatus === "pending"
      || (adminAccount?.requestStatus === "accepted" && adminAccount.accessStatus !== "active")) {
      throw new InventoryError("This account's Admin access must be active before its Owner profile can be changed.", 403);
    }
    const [existing] = await tx.select().from(deliveryProfiles).where(eq(deliveryProfiles.userId, userId)).limit(1);
    const [assignment] = await tx.select({ id: operations.id }).from(operations).where(eq(operations.courierUserId, userId)).limit(1);
    if ((existing && existing.role !== data.role) || (assignment && data.role !== "courier")) {
      throw new InventoryError("Your registered role cannot be changed. Use a separate account for a different role.", 409);
    }
    if (data.role === "courier" && !existing) {
      const inventory = await Promise.all([categories, products, warehouses, operations].map(table =>
        tx.select({ id: table.id }).from(table).where(eq(table.ownerId, userId)).limit(1),
      ));
      if (inventory.some(rows => rows.length)) {
        throw new InventoryError("This account already owns inventory. Use a separate account to register as a courier.", 409);
      }
    }
    const [saved] = await tx.insert(deliveryProfiles).values({
      userId, name, email: account.email, phone: data.phone, role: data.role,
    }).onConflictDoUpdate({
      target: deliveryProfiles.userId,
      set: { name, email: account.email, phone: data.phone },
    }).returning();
    return saved;
  });
  res.json(SaveDeliveryProfileResponse.parse({ ...profile, canManageSupportStaff: false }));
});

router.get("/courier-lookup", requireDeliveryOwner, async (req, res) => {
  const parsed = LookupRegisteredCourierQueryParams.safeParse(req.query);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const email = parsed.data.email.trim().toLowerCase();
  const { data: users } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
  const user = users.find(user => user.emailAddresses.some(address =>
    address.emailAddress.toLowerCase() === email && address.verification?.status === "verified",
  ));
  const [profile] = user ? await db.select().from(deliveryProfiles).where(and(
    eq(deliveryProfiles.userId, user.id), eq(deliveryProfiles.role, "courier"),
  )).limit(1) : [];
  if (!profile) throw new InventoryError("No registered delivery person has that verified email. Ask them to sign up as a courier first.", 404);
  if (!/^[0-9]{10}$/.test(profile.phone) || await deliveryRole(user!.id) !== "courier") {
    throw new InventoryError("Ask this courier to complete account setup with a 10-digit phone number.", 409);
  }
  res.json(LookupRegisteredCourierResponse.parse({ name: profile.name, email, phone: profile.phone }));
});

export default router;
