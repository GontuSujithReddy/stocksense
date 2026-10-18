import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { db, deliverySupport, deliverySupportMessages, inventoryWorkspaces, stocksenseSupportAccessRequests, stocksenseSupportProfiles } from "@workspace/db";
import {
  ClaimStocksenseSupportTicketParams,
  ClaimStocksenseSupportTicketResponse,
  ConfirmStocksenseSupportResolvedParams,
  ConfirmStocksenseSupportResolvedResponse,
  CreateStocksenseSupportOwnerMessageBody,
  CreateStocksenseSupportOwnerMessageParams,
  CreateStocksenseSupportOwnerMessageResponse,
  CreateStocksenseSupportStaffMessageBody,
  CreateStocksenseSupportStaffMessageParams,
  CreateStocksenseSupportStaffMessageResponse,
  CreateStocksenseSupportTicketBody,
  CreateStocksenseSupportTicketResponse,
  GetStocksenseSupportAdminAccessResponse,
  GetStocksenseSupportAccessResponse,
  GetStocksenseSupportStaffSummaryResponse,
  ListStocksenseSupportAccessRequestsResponse,
  ListStocksenseSupportStaffTicketsResponse,
  ListStocksenseSupportTicketsResponse,
  ReviewStocksenseSupportAccessRequestBody,
  ReviewStocksenseSupportAccessRequestParams,
  ReviewStocksenseSupportAccessRequestResponse,
  RequestStocksenseSupportAccessBody,
  RequestStocksenseSupportAccessResponse,
  SetStocksenseSupportAccessPausedBody,
  SetStocksenseSupportAccessPausedParams,
  SetStocksenseSupportAccessPausedResponse,
} from "@workspace/api-zod";
import { deliveryRole, isDeliverySupportStaff, requireDeliveryUser } from "../lib/delivery-access";
import { InventoryError } from "../lib/inventory-error";
import {
  isCompleteSupportProfile,
  canReviewStocksenseSupportAccess,
  isStocksenseSupportStaff,
  isOpenSupportTicket,
  isSupportTicketOwnedBy,
  ownerSupportTickets,
  ownerTicketViews,
  requireCompleteSupportProfile,
  sendAccessNoticeOnce,
  staffSolvedCount,
  staffSupportTickets,
  staffTicketViews,
  supportAccessState,
  supportContact,
  verifiedIdentity,
} from "../lib/stocksense-support";
import { STOCKSENSE_SUPPORT_APP } from "../lib/stocksense-support";

const router: IRouter = Router();
router.use(requireDeliveryUser);

const requireStockSenseOwner: RequestHandler = async (_req, res, next) => {
  try {
    const userId = res.locals.deliveryUserId as string;
    if (await deliveryRole(userId) !== "owner") {
      throw new InventoryError("Customer service tickets are available to owner accounts only.", 403);
    }
    const [workspace] = await db
      .select({ deletedAt: inventoryWorkspaces.deletedAt })
      .from(inventoryWorkspaces)
      .where(eq(inventoryWorkspaces.ownerId, userId))
      .limit(1);
    if (workspace?.deletedAt) {
      throw new InventoryError("Your StockSense workspace has been permanently deleted.", 410);
    }
    next();
  } catch (error) {
    next(error);
  }
};

const requireActiveStocksenseOwner: RequestHandler = async (_req, res, next) => {
  try {
    const userId = res.locals.deliveryUserId as string;
    if (await deliveryRole(userId) === "owner") {
      const [workspace] = await db
        .select({ deletedAt: inventoryWorkspaces.deletedAt })
        .from(inventoryWorkspaces)
        .where(eq(inventoryWorkspaces.ownerId, userId))
        .limit(1);
      if (workspace?.deletedAt) {
        throw new InventoryError("Your StockSense workspace has been permanently deleted.", 410);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

const requireSupportStaffProfile: RequestHandler = async (_req, res, next) => {
  try {
    const userId = res.locals.deliveryUserId as string;
    await requireCompleteSupportProfile(userId);
    next();
  } catch (error) {
    next(error);
  }
};

const requireStocksenseSupportStaff: RequestHandler = async (_req, res, next) => {
  try {
    const userId = res.locals.deliveryUserId as string;
    if (!await isStocksenseSupportStaff(userId)) {
      throw new InventoryError("StockSense customer-service access is not active.", 403);
    }
    next();
  } catch (error) {
    next(error);
  }
};

const requireStocksenseSupportAccessReviewer: RequestHandler = async (_req, res, next) => {
  try {
    const userId = res.locals.deliveryUserId as string;
    if (!await canReviewStocksenseSupportAccess(userId)) {
      throw new InventoryError("Review access requires an active, approved Admin account or the configured support reviewer.", 403);
    }
    next();
  } catch (error) {
    next(error);
  }
};

async function stocksenseAccessRequestViews(userIds?: string[]) {
  const selectRows = () => db.select({
    userId: stocksenseSupportAccessRequests.userId,
    requestedAt: stocksenseSupportAccessRequests.requestedAt,
    notificationSentAt: stocksenseSupportAccessRequests.notificationSentAt,
    status: stocksenseSupportAccessRequests.status,
    reviewedAt: stocksenseSupportAccessRequests.reviewedAt,
    reviewedByUserId: stocksenseSupportAccessRequests.reviewedByUserId,
    pausedAt: stocksenseSupportAccessRequests.pausedAt,
    pausedByUserId: stocksenseSupportAccessRequests.pausedByUserId,
    displayName: stocksenseSupportProfiles.displayName,
    verifiedEmail: stocksenseSupportProfiles.verifiedEmail,
    phone: stocksenseSupportProfiles.phone,
  }).from(stocksenseSupportAccessRequests)
    .leftJoin(stocksenseSupportProfiles, eq(stocksenseSupportProfiles.userId, stocksenseSupportAccessRequests.userId));
  const rows = userIds?.length
    ? await selectRows().where(inArray(stocksenseSupportAccessRequests.userId, userIds))
    : await selectRows().orderBy(desc(stocksenseSupportAccessRequests.requestedAt));
  const ticketReviewCounts = rows.length
    ? await db.select({
      userId: deliverySupportMessages.senderId,
      ticketsReviewed: sql<number>`count(distinct ${deliverySupportMessages.ticketId})::int`,
    }).from(deliverySupportMessages)
      .innerJoin(deliverySupport, eq(deliverySupport.id, deliverySupportMessages.ticketId))
      .where(and(
        eq(deliverySupport.sourceApp, STOCKSENSE_SUPPORT_APP),
        eq(deliverySupportMessages.senderRole, "staff"),
        inArray(deliverySupportMessages.senderId, rows.map(row => row.userId)),
      ))
      .groupBy(deliverySupportMessages.senderId)
    : [];
  const reviewedCountByUserId = new Map(ticketReviewCounts.map(row => [row.userId, row.ticketsReviewed]));
  return rows.map(row => ({
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    notificationSentAt: row.notificationSentAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    ticketsReviewed: reviewedCountByUserId.get(row.userId) ?? 0,
  }));
}

router.get("/support/access", requireActiveStocksenseOwner, async (_req, res): Promise<void> => {
  const userId = res.locals.deliveryUserId as string;
  res.json(GetStocksenseSupportAccessResponse.parse(
    await supportAccessState(userId, await isDeliverySupportStaff(userId)),
  ));
});

router.post("/support/access-request", requireActiveStocksenseOwner, async (req, res): Promise<void> => {
  const parsed = RequestStocksenseSupportAccessBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const userId = res.locals.deliveryUserId as string;
  const name = parsed.data.name.trim();
  const phone = parsed.data.phone.trim();
  if (name.length < 2 || !/^[0-9]{10}$/.test(phone)) {
    throw new InventoryError("Enter your name and a valid 10-digit phone number.");
  }
  const identity = await verifiedIdentity(userId, name);
  const displayName = identity.displayName;

  const hasDeliveryStaffAccess = await isDeliverySupportStaff(userId);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`stocksense-support-access:${userId}`}))`);
    await tx.insert(stocksenseSupportProfiles).values({
      userId,
      displayName,
      verifiedEmail: identity.email,
      phone,
    }).onConflictDoUpdate({
      target: stocksenseSupportProfiles.userId,
      set: { displayName, verifiedEmail: identity.email, phone, updatedAt: new Date() },
    });
    if (!hasDeliveryStaffAccess) {
      const [existingRequest] = await tx.select().from(stocksenseSupportAccessRequests)
        .where(eq(stocksenseSupportAccessRequests.userId, userId)).limit(1).for("update");
      if (!existingRequest) {
        await tx.insert(stocksenseSupportAccessRequests).values({ userId });
      } else if (existingRequest.status === "denied") {
        await tx.update(stocksenseSupportAccessRequests).set({
          status: "pending",
          requestedAt: new Date(),
          notificationSentAt: null,
          reviewedAt: null,
          reviewedByUserId: null,
        }).where(eq(stocksenseSupportAccessRequests.userId, userId));
      }
    }
  });

  const approved = await isStocksenseSupportStaff(userId);
  let emailNotificationSent = false;
  if (!approved) {
    try {
      emailNotificationSent = await sendAccessNoticeOnce(userId, {
        displayName: identity.displayName,
        verifiedEmail: identity.email,
      });
    } catch (error) {
      req.log.error({
        errorMessage: error instanceof Error ? error.message : "unknown",
      }, "Could not send the StockSense support access notification");
    }
  }
  const state = await supportAccessState(userId, await isDeliverySupportStaff(userId));
  res.json(RequestStocksenseSupportAccessResponse.parse({ ...state, emailNotificationSent }));
});

router.get("/support/admin/access", async (_req, res): Promise<void> => {
  const userId = res.locals.deliveryUserId as string;
  res.json(GetStocksenseSupportAdminAccessResponse.parse({
    canReview: await canReviewStocksenseSupportAccess(userId),
  }));
});

router.get("/support/admin/access-requests", requireStocksenseSupportAccessReviewer, async (_req, res): Promise<void> => {
  const requests = await stocksenseAccessRequestViews();
  res.json(ListStocksenseSupportAccessRequestsResponse.parse(requests));
});

router.patch("/support/admin/access-requests/:userId", requireStocksenseSupportAccessReviewer, async (req, res): Promise<void> => {
  const params = ReviewStocksenseSupportAccessRequestParams.safeParse(req.params);
  const parsed = ReviewStocksenseSupportAccessRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) throw new InventoryError("Choose whether to approve or deny this access request.");
  const reviewerId = res.locals.deliveryUserId as string;
  const updated = await db.transaction(async tx => {
    const [request] = await tx.select().from(stocksenseSupportAccessRequests)
      .where(eq(stocksenseSupportAccessRequests.userId, params.data.userId))
      .limit(1)
      .for("update");
    if (!request) throw new InventoryError("StockSense access request not found.", 404);
    if (request.status === parsed.data.status) return request;
    if (request.status !== "pending") throw new InventoryError("This request has already been reviewed.", 409);
    if (parsed.data.status === "approved") {
      const [profile] = await tx.select().from(stocksenseSupportProfiles)
        .where(eq(stocksenseSupportProfiles.userId, request.userId)).limit(1);
      if (!isCompleteSupportProfile(profile)) {
        throw new InventoryError("The requester must have a complete, verified support profile before approval.", 409);
      }
    }
    const [reviewed] = await tx.update(stocksenseSupportAccessRequests).set({
      status: parsed.data.status,
      reviewedAt: new Date(),
      reviewedByUserId: reviewerId,
    }).where(eq(stocksenseSupportAccessRequests.userId, request.userId)).returning();
    return reviewed;
  });
  const [response] = await stocksenseAccessRequestViews([updated.userId]);
  res.json(ReviewStocksenseSupportAccessRequestResponse.parse(response));
});

router.patch("/support/admin/access-requests/:userId/pause", requireStocksenseSupportAccessReviewer, async (req, res): Promise<void> => {
  const params = SetStocksenseSupportAccessPausedParams.safeParse(req.params);
  const parsed = SetStocksenseSupportAccessPausedBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    throw new InventoryError("Choose whether to pause or reactivate this support account.");
  }
  const reviewerId = res.locals.deliveryUserId as string;
  const updated = await db.transaction(async tx => {
    const [request] = await tx.select().from(stocksenseSupportAccessRequests)
      .where(eq(stocksenseSupportAccessRequests.userId, params.data.userId))
      .limit(1)
      .for("update");
    if (!request) throw new InventoryError("StockSense access request not found.", 404);
    if (request.status !== "approved") {
      throw new InventoryError("Only accepted support accounts can be paused or reactivated.", 409);
    }
    if ((request.pausedAt !== null) === parsed.data.paused) return request;
    const [saved] = await tx.update(stocksenseSupportAccessRequests).set({
      pausedAt: parsed.data.paused ? new Date() : null,
      pausedByUserId: parsed.data.paused ? reviewerId : null,
    }).where(eq(stocksenseSupportAccessRequests.userId, request.userId)).returning();
    return saved;
  });
  const [response] = await stocksenseAccessRequestViews([updated.userId]);
  res.json(SetStocksenseSupportAccessPausedResponse.parse(response));
});

router.get("/support/tickets", requireStockSenseOwner, async (_req, res): Promise<void> => {
  const userId = res.locals.deliveryUserId as string;
  res.json(ListStocksenseSupportTicketsResponse.parse(await ownerSupportTickets(userId)));
});

router.post("/support/tickets", requireStockSenseOwner, async (req, res): Promise<void> => {
  const parsed = CreateStocksenseSupportTicketBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const subject = parsed.data.subject.trim();
  const message = parsed.data.message.trim();
  if (!subject || !message) throw new InventoryError("Enter both a subject and a description.");
  const [ticket] = await db.insert(deliverySupport).values({
    sourceApp: STOCKSENSE_SUPPORT_APP,
    ownerId: res.locals.deliveryUserId as string,
    operationId: null,
    subject,
    message,
    status: "open",
  }).returning();
  res.status(201).json(CreateStocksenseSupportTicketResponse.parse((await ownerTicketViews([ticket]))[0]));
});

router.post("/support/tickets/:id/messages", requireStockSenseOwner, async (req, res): Promise<void> => {
  const params = CreateStocksenseSupportOwnerMessageParams.safeParse(req.params);
  const parsed = CreateStocksenseSupportOwnerMessageBody.safeParse(req.body);
  if (!params.success || !parsed.success) throw new InventoryError("Write a valid message before sending it.");
  const userId = res.locals.deliveryUserId as string;
  const message = parsed.data.message.trim();
  if (!message) throw new InventoryError("Write a message before sending it.");
  const created = await db.transaction(async tx => {
    const [ticket] = await tx.select().from(deliverySupport)
      .where(isSupportTicketOwnedBy(userId, params.data.id))
      .limit(1).for("update");
    if (!ticket) throw new InventoryError("Support ticket not found.", 404);
    if (!isOpenSupportTicket(ticket)) throw new InventoryError("This ticket is already resolved.", 409);
    const [row] = await tx.insert(deliverySupportMessages).values({
      ticketId: ticket.id,
      senderRole: "customer",
      senderId: userId,
      message,
    }).returning();
    return row;
  });
  res.status(201).json(CreateStocksenseSupportOwnerMessageResponse.parse({
    id: created.id,
    sender: created.senderRole,
    message: created.message,
    createdAt: created.createdAt?.toISOString() ?? null,
  }));
});

router.post("/support/tickets/:id/resolve", requireStockSenseOwner, async (req, res): Promise<void> => {
  const params = ConfirmStocksenseSupportResolvedParams.safeParse(req.params);
  if (!params.success) throw new InventoryError("Support ticket not found.", 404);
  const ownerId = res.locals.deliveryUserId as string;
  const result = await db.transaction(async tx => {
    const [ticket] = await tx.select().from(deliverySupport)
      .where(isSupportTicketOwnedBy(ownerId, params.data.id))
      .limit(1).for("update");
    if (!ticket) return { kind: "not-found" as const };
    if (ticket.status === "closed" && ticket.resolvedConfirmedByOwnerUserId === ownerId) {
      return { kind: "ok" as const, ticket };
    }
    if (!isOpenSupportTicket(ticket) || !ticket.assignedStaffUserId) {
      return { kind: "conflict" as const };
    }
    const assignee = await supportContact(ticket.assignedStaffUserId);
    const [updated] = await tx.update(deliverySupport).set({
      status: "closed",
      resolvedByUserId: ticket.assignedStaffUserId,
      resolvedByName: assignee.displayName,
      resolvedAt: new Date(),
      resolvedConfirmedByOwnerUserId: ownerId,
    }).where(and(
      eq(deliverySupport.id, ticket.id),
      eq(deliverySupport.sourceApp, STOCKSENSE_SUPPORT_APP),
      eq(deliverySupport.ownerId, ownerId),
      eq(deliverySupport.status, "open"),
      isNull(deliverySupport.resolvedAt),
    )).returning();
    return updated
      ? { kind: "ok" as const, ticket: updated }
      : { kind: "conflict" as const };
  });
  if (result.kind === "not-found") throw new InventoryError("Support ticket not found.", 404);
  if (result.kind === "conflict") throw new InventoryError("This ticket must be assigned and unresolved before you can confirm it.", 409);
  res.json(ConfirmStocksenseSupportResolvedResponse.parse((await ownerTicketViews([result.ticket]))[0]));
});

router.get("/support/staff/tickets", requireStocksenseSupportStaff, async (_req, res): Promise<void> => {
  res.json(ListStocksenseSupportStaffTicketsResponse.parse(await staffSupportTickets()));
});

router.post("/support/staff/tickets/:id/claim", requireStocksenseSupportStaff, requireSupportStaffProfile, async (req, res): Promise<void> => {
  const params = ClaimStocksenseSupportTicketParams.safeParse(req.params);
  if (!params.success) throw new InventoryError("Support ticket not found.", 404);
  const userId = res.locals.deliveryUserId as string;
  await supportContact(userId);
  const [claimed] = await db.update(deliverySupport).set({
    assignedStaffUserId: userId,
    assignedAt: new Date(),
  }).where(and(
    eq(deliverySupport.id, params.data.id),
    eq(deliverySupport.sourceApp, STOCKSENSE_SUPPORT_APP),
    eq(deliverySupport.status, "open"),
    isNull(deliverySupport.assignedStaffUserId),
    isNull(deliverySupport.resolvedAt),
  )).returning();
  if (!claimed) {
    const [current] = await db.select().from(deliverySupport).where(and(
      eq(deliverySupport.id, params.data.id),
      eq(deliverySupport.sourceApp, STOCKSENSE_SUPPORT_APP),
    )).limit(1);
    if (!current) throw new InventoryError("Support ticket not found.", 404);
    if (current.assignedStaffUserId !== userId) {
      throw new InventoryError("Another support teammate already took this ticket. Refresh to see the current assignment.", 409);
    }
    if (!isOpenSupportTicket(current)) throw new InventoryError("This ticket is no longer open.", 409);
    res.json(ClaimStocksenseSupportTicketResponse.parse((await staffTicketViews([current]))[0]));
    return;
  }
  res.json(ClaimStocksenseSupportTicketResponse.parse((await staffTicketViews([claimed]))[0]));
});

router.post("/support/staff/tickets/:id/messages", requireStocksenseSupportStaff, requireSupportStaffProfile, async (req, res): Promise<void> => {
  const params = CreateStocksenseSupportStaffMessageParams.safeParse(req.params);
  const parsed = CreateStocksenseSupportStaffMessageBody.safeParse(req.body);
  if (!params.success || !parsed.success) throw new InventoryError("Write a valid reply before sending it.");
  const userId = res.locals.deliveryUserId as string;
  const message = parsed.data.message.trim();
  if (!message) throw new InventoryError("Write a reply before sending it.");
  const result = await db.transaction(async tx => {
    const [ticket] = await tx.select().from(deliverySupport).where(and(
      eq(deliverySupport.id, params.data.id),
      eq(deliverySupport.sourceApp, STOCKSENSE_SUPPORT_APP),
    )).limit(1).for("update");
    if (!ticket) throw new InventoryError("Support ticket not found.", 404);
    if (ticket.assignedStaffUserId !== userId) throw new InventoryError("Only the assigned support person can reply to this ticket.", 403);
    if (!isOpenSupportTicket(ticket)) throw new InventoryError("This ticket is already resolved.", 409);
    const [created] = await tx.insert(deliverySupportMessages).values({
      ticketId: ticket.id,
      senderRole: "staff",
      senderId: userId,
      message,
    }).returning();
    return created;
  });
  res.status(201).json(CreateStocksenseSupportStaffMessageResponse.parse({
    id: result.id,
    sender: result.senderRole,
    message: result.message,
    createdAt: result.createdAt?.toISOString() ?? null,
  }));
});

router.get("/support/staff/summary", requireStocksenseSupportStaff, async (_req, res): Promise<void> => {
  const userId = res.locals.deliveryUserId as string;
  res.json(GetStocksenseSupportStaffSummaryResponse.parse({ solvedCount: await staffSolvedCount(userId) }));
});

export default router;