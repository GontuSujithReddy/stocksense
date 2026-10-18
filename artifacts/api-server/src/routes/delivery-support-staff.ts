import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, deliverySupport, deliverySupportMessages } from "@workspace/db";
import {
  ListDeliveryStaffSupportResponse,
  UpdateDeliveryStaffSupportBody,
  UpdateDeliveryStaffSupportParams,
  UpdateDeliveryStaffSupportResponse,
} from "@workspace/api-zod";
import { requireDeliverySupportStaff } from "../lib/delivery-access";
import { InventoryError } from "../lib/inventory-error";
import { buildSupportConversation } from "../lib/delivery-support-conversation";
import { resolutionAttributionForUpdate } from "../lib/delivery-support-resolution";

const router: IRouter = Router();
router.use(requireDeliverySupportStaff);

function staffTicketView(row: typeof deliverySupport.$inferSelect, messages: typeof deliverySupportMessages.$inferSelect[]) {
  return {
    id: row.id,
    customerId: row.ownerId,
    operationId: row.operationId,
    subject: row.subject,
    message: row.message,
    status: row.status,
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    messages: buildSupportConversation(row, messages),
  };
}

async function supportStaffDisplayName(userId: string): Promise<string> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.fullName?.trim()
      || [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
      || "Support staff";
  } catch {
    throw new InventoryError("Couldn't verify your support profile. The ticket wasn't changed; please try again.", 503);
  }
}

async function staffTicketViews(rows: typeof deliverySupport.$inferSelect[]) {
  if (!rows.length) return [];
  const messages = await db.select().from(deliverySupportMessages)
    .where(inArray(deliverySupportMessages.ticketId, rows.map(row => row.id)));
  const grouped = new Map<number, typeof messages>();
  for (const message of messages) grouped.set(message.ticketId, [...(grouped.get(message.ticketId) ?? []), message]);
  return rows.map(row => staffTicketView(row, grouped.get(row.id) ?? []));
}

router.get("/", async (_req, res): Promise<void> => {
  const rows = await db.select().from(deliverySupport)
    .where(eq(deliverySupport.sourceApp, "delivery"))
    .orderBy(desc(deliverySupport.createdAt));
  res.json(ListDeliveryStaffSupportResponse.parse(await staffTicketViews(rows)));
});

router.patch("/:id", async (req, res): Promise<void> => {
  const params = UpdateDeliveryStaffSupportParams.safeParse(req.params);
  const parsed = UpdateDeliveryStaffSupportBody.safeParse(req.body);
  if (!params.success || !parsed.success) throw new InventoryError("Enter a valid support reply and status.");
  const resolution = parsed.data.resolution.trim();
  if (!resolution) throw new InventoryError("Write a reply before updating this ticket.");

  const ownerId = res.locals.deliveryUserId as string;
  let closingStaffName: string | null = null;
  if (parsed.data.status === "closed") {
    const [current] = await db.select({ status: deliverySupport.status }).from(deliverySupport)
      .where(and(
        eq(deliverySupport.id, params.data.id),
        eq(deliverySupport.sourceApp, "delivery"),
      )).limit(1);
    if (!current) throw new InventoryError("Support ticket not found.", 404);
    if (current.status !== "closed") closingStaffName = await supportStaffDisplayName(ownerId);
  }
  const result = await db.transaction(async tx => {
    const [ticket] = await tx.select().from(deliverySupport)
      .where(and(
        eq(deliverySupport.id, params.data.id),
        eq(deliverySupport.sourceApp, "delivery"),
      )).limit(1).for("update");
    if (!ticket) throw new InventoryError("Support ticket not found.", 404);

    if (parsed.data.status === "closed" && ticket.status !== "closed" && !closingStaffName) {
      // A concurrent reopen can occur after the optimistic identity check above.
      closingStaffName = await supportStaffDisplayName(ownerId);
    }
    const resolutionAttribution = resolutionAttributionForUpdate(
      ticket,
      parsed.data.status,
      ownerId,
      closingStaffName ?? "",
      new Date(),
    );
    const previousMessages = await tx.select().from(deliverySupportMessages)
      .where(eq(deliverySupportMessages.ticketId, ticket.id));
    const previousReplyIsRecorded = previousMessages.some(item =>
      item.senderRole === "staff" && item.message === ticket.resolution,
    );
    if (ticket.resolution.trim() && !previousReplyIsRecorded && !previousMessages.some(item => item.isLegacy)) {
      await tx.insert(deliverySupportMessages).values({
        ticketId: ticket.id,
        senderRole: "staff",
        senderId: null,
        message: ticket.resolution,
        createdAt: null,
        isLegacy: true,
      }).returning();
    }
    const [reply] = await tx.insert(deliverySupportMessages).values({
      ticketId: ticket.id,
      senderRole: "staff",
      senderId: ownerId,
      message: resolution,
    }).returning();
    const [updated] = await tx.update(deliverySupport).set({
      resolution,
      status: parsed.data.status,
      ...resolutionAttribution,
    }).where(eq(deliverySupport.id, ticket.id)).returning();
    const history = await tx.select().from(deliverySupportMessages)
      .where(eq(deliverySupportMessages.ticketId, ticket.id));
    return { ticket: updated, history };
  });
  res.json(UpdateDeliveryStaffSupportResponse.parse(staffTicketView(result.ticket, result.history)));
});

export default router;