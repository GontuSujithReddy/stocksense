import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, deliverySupport, deliverySupportMessages, stocksenseAdminAccounts, stocksenseSupportAccessRequests, stocksenseSupportProfiles } from "@workspace/db";
import { clerkClient } from "@clerk/express";
import { InventoryError } from "./inventory-error";
import { buildSupportConversation } from "./delivery-support-conversation";
import { isDeliverySupportStaff } from "./delivery-support-auth";
import { stocksenseAdminCanReviewSupportAccess } from "./stocksense-admin-state";

const APP = "stocksense";
const PHONE_PATTERN = /^[0-9]{10}$/;

export type SupportContact = {
  displayName: string;
  email: string;
  phone: string;
};

export function isCompleteSupportProfile(profile: typeof stocksenseSupportProfiles.$inferSelect | undefined): profile is NonNullable<typeof profile> {
  return !!profile
    && profile.displayName.trim().length >= 2
    && profile.verifiedEmail.includes("@")
    && PHONE_PATTERN.test(profile.phone);
}

export async function verifiedIdentity(userId: string, requestedName?: string) {
  let user: Awaited<ReturnType<typeof clerkClient.users.getUser>>;
  try {
    user = await clerkClient.users.getUser(userId);
  } catch {
    throw new InventoryError("Couldn't verify your sign-in details. Please retry.", 503);
  }
  const email = user.emailAddresses.find(address =>
    address.id === user.primaryEmailAddressId && address.verification?.status === "verified",
  ) ?? user.emailAddresses.find(address => address.verification?.status === "verified");
  if (!email) throw new InventoryError("Verify an email address before requesting customer-service access.", 403);
  const displayName = user.fullName?.trim()
    || [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
    || requestedName?.trim()
    || "";
  if (displayName.length < 2) throw new InventoryError("Add your name to your account before requesting support access.", 400);
  return { displayName, email: email.emailAddress };
}

export async function supportProfile(userId: string) {
  const [profile] = await db.select().from(stocksenseSupportProfiles)
    .where(eq(stocksenseSupportProfiles.userId, userId)).limit(1);
  return profile;
}

export async function supportAccessState(userId: string, approved: boolean) {
  const [profile] = await db.select().from(stocksenseSupportProfiles)
    .where(eq(stocksenseSupportProfiles.userId, userId)).limit(1);
  const [request] = await db.select().from(stocksenseSupportAccessRequests)
    .where(eq(stocksenseSupportAccessRequests.userId, userId)).limit(1);
  const complete = isCompleteSupportProfile(profile);
  return {
    status: request?.pausedAt
      ? "paused" as const
      : approved || request?.status === "approved"
        ? "approved" as const
        : request?.status ?? "none" as const,
    profileComplete: complete,
    displayName: profile?.displayName ?? null,
    phone: profile?.phone ?? null,
    requestCreatedAt: request?.requestedAt?.toISOString() ?? null,
  };
}

export async function isStocksenseSupportStaff(userId: string) {
  const [request] = await db.select({
    status: stocksenseSupportAccessRequests.status,
    pausedAt: stocksenseSupportAccessRequests.pausedAt,
  })
    .from(stocksenseSupportAccessRequests)
    .where(eq(stocksenseSupportAccessRequests.userId, userId))
    .limit(1);
  if (request?.pausedAt) return false;
  if (request?.status === "approved") return true;
  return isDeliverySupportStaff(userId);
}

export async function isConfiguredStocksenseSupportAdmin(userId: string) {
  const configuredEmail = process.env.STOCKSENSE_SUPPORT_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredEmail) {
    throw new InventoryError("The StockSense support administrator is not configured.", 503);
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

export async function canReviewStocksenseSupportAccess(userId: string) {
  const [adminAccount] = await db.select({
    requestStatus: stocksenseAdminAccounts.requestStatus,
    accessStatus: stocksenseAdminAccounts.accessStatus,
  }).from(stocksenseAdminAccounts)
    .where(eq(stocksenseAdminAccounts.userId, userId))
    .limit(1);
  if (adminAccount && stocksenseAdminCanReviewSupportAccess(adminAccount.requestStatus, adminAccount.accessStatus)) {
    return true;
  }
  return isConfiguredStocksenseSupportAdmin(userId);
}

export async function requireCompleteSupportProfile(userId: string) {
  const profile = await supportProfile(userId);
  if (!isCompleteSupportProfile(profile)) {
    throw new InventoryError("Complete your customer-service contact details before taking tickets.", 409);
  }
  return profile;
}

export async function supportContact(userId: string): Promise<SupportContact> {
  const profile = await requireCompleteSupportProfile(userId);
  return { displayName: profile.displayName, email: profile.verifiedEmail, phone: profile.phone };
}

export async function ownerTicketViews(rows: typeof deliverySupport.$inferSelect[]) {
  if (!rows.length) return [];
  const messages = await db.select().from(deliverySupportMessages)
    .where(inArray(deliverySupportMessages.ticketId, rows.map(row => row.id)));
  const grouped = new Map<number, typeof messages>();
  for (const message of messages) grouped.set(message.ticketId, [...(grouped.get(message.ticketId) ?? []), message]);
  const assignedIds = [...new Set(rows.map(row => row.assignedStaffUserId).filter((id): id is string => !!id))];
  const contacts = new Map<string, SupportContact>();
  for (const id of assignedIds) contacts.set(id, await supportContact(id));
  return rows.map(row => ({
    id: row.id,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    assignedStaff: row.assignedStaffUserId ? contacts.get(row.assignedStaffUserId) ?? null : null,
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    messages: buildSupportConversation(row, grouped.get(row.id) ?? []),
  }));
}

export async function staffTicketViews(rows: typeof deliverySupport.$inferSelect[]) {
  if (!rows.length) return [];
  const messages = await db.select().from(deliverySupportMessages)
    .where(inArray(deliverySupportMessages.ticketId, rows.map(row => row.id)));
  const grouped = new Map<number, typeof messages>();
  for (const message of messages) grouped.set(message.ticketId, [...(grouped.get(message.ticketId) ?? []), message]);
  const assignedIds = [...new Set(rows.map(row => row.assignedStaffUserId).filter((id): id is string => !!id))];
  const assignees = new Map<string, { displayName: string; email: string }>();
  for (const id of assignedIds) {
    const contact = await supportContact(id);
    assignees.set(id, { displayName: contact.displayName, email: contact.email });
  }
  return rows.map(row => ({
    id: row.id,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    assignee: row.assignedStaffUserId ? assignees.get(row.assignedStaffUserId) ?? null : null,
    messages: buildSupportConversation(row, grouped.get(row.id) ?? []),
  }));
}

export async function ownerSupportTickets(userId: string) {
  const rows = await db.select().from(deliverySupport)
    .where(and(eq(deliverySupport.sourceApp, APP), eq(deliverySupport.ownerId, userId)))
    .orderBy(desc(deliverySupport.createdAt));
  return ownerTicketViews(rows);
}

export async function staffSupportTickets() {
  const rows = await db.select().from(deliverySupport)
    .where(eq(deliverySupport.sourceApp, APP))
    .orderBy(desc(deliverySupport.createdAt));
  return staffTicketViews(rows);
}

export async function staffSolvedCount(userId: string) {
  const [result] = await db.select({ value: sql<number>`count(*)::int` }).from(deliverySupport).where(and(
    eq(deliverySupport.sourceApp, APP),
    eq(deliverySupport.status, "closed"),
    eq(deliverySupport.resolvedByUserId, userId),
    isNotNull(deliverySupport.resolvedConfirmedByOwnerUserId),
  ));
  return result?.value ?? 0;
}

export async function sendAccessNoticeOnce(userId: string, notice: {
  displayName: string;
  verifiedEmail: string;
}) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stocksense-support-notice:${userId}`}))`);
    const [request] = await tx.select().from(stocksenseSupportAccessRequests)
      .where(eq(stocksenseSupportAccessRequests.userId, userId)).limit(1).for("update");
    if (!request) throw new InventoryError("Your access request was not saved. Please retry.", 503);
    if (request.notificationSentAt) return true;
    const { sendStocksenseSupportAccessNotice } = await import("./stocksense-support-email");
    await sendStocksenseSupportAccessNotice({ userId, ...notice });
    await tx.update(stocksenseSupportAccessRequests)
      .set({ notificationSentAt: new Date() })
      .where(eq(stocksenseSupportAccessRequests.userId, userId));
    return true;
  });
}

export function isSupportTicketOwnedBy(userId: string, ticketId: number) {
  return and(
    eq(deliverySupport.id, ticketId),
    eq(deliverySupport.sourceApp, APP),
    eq(deliverySupport.ownerId, userId),
  );
}

export function isOpenSupportTicket(ticket: typeof deliverySupport.$inferSelect) {
  return ticket.status === "open" && ticket.resolvedAt === null;
}

export function ticketHasAssignedStaff(ticket: typeof deliverySupport.$inferSelect) {
  return ticket.assignedStaffUserId !== null && ticket.assignedStaffUserId.length > 0;
}

export function isUnassignedOpenSupportTicket(userId: string, ticketId: number) {
  return and(
    eq(deliverySupport.id, ticketId),
    eq(deliverySupport.sourceApp, APP),
    eq(deliverySupport.status, "open"),
    isNull(deliverySupport.assignedStaffUserId),
    isNull(deliverySupport.resolvedAt),
  );
}

export const STOCKSENSE_SUPPORT_APP = APP;