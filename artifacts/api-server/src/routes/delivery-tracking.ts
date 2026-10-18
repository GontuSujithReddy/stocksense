import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, operations, deliveryConfirmations, deliveryVoiceSettings } from "@workspace/db";
import {
  ListDeliveryTrackingResponse, GetDeliveryTrackingParams, GetDeliveryTrackingResponse,
  SaveDeliveryRecipientBody, SaveDeliveryRecipientResponse, CallDeliveryCustomerBody,
  CallDeliveryCustomerResponse,
} from "@workspace/api-zod";
import { accessibleDelivery, deliveryRole } from "../lib/delivery-access";
import { InventoryError } from "../lib/inventory-error";
import { trackingView } from "../lib/delivery-tracking";
import { createRetellDeliveryCall } from "../lib/delivery-retell";

const router: IRouter = Router();
router.use(async (_req, res, next) => {
  if (await deliveryRole(res.locals.deliveryUserId as string) === "support_staff") {
    next(new InventoryError("Support staff cannot access owner or courier delivery tracking.", 403));
    return;
  }
  next();
});
router.get("/tracking", async (_req, res) => {
  const userId = res.locals.deliveryUserId as string;
  const courier = await deliveryRole(userId) === "courier";
  const rows = await db.select().from(operations).where(and(
    eq(operations.type, "delivery"),
    courier ? eq(operations.courierUserId, userId) : eq(operations.ownerId, userId),
  )).orderBy(operations.id);
  // Lists refresh database state; the selected delivery detail polls provider state.
  res.json(ListDeliveryTrackingResponse.parse(await Promise.all(rows.map(row => trackingView(row)))));
});
router.get("/tracking/:id", async (req, res) => {
  const parsed = GetDeliveryTrackingParams.safeParse(req.params);
  if (!parsed.success) throw new InventoryError(parsed.error.message);
  const operation = await accessibleDelivery(parsed.data.id, res.locals.deliveryUserId);
  res.json(GetDeliveryTrackingResponse.parse(await trackingView(operation, true)));
});
router.put("/tracking/:id", async (req, res) => {
  const parsed = SaveDeliveryRecipientBody.safeParse(req.body);
  const params = GetDeliveryTrackingParams.safeParse(req.params);
  if (!parsed.success || !params.success) throw new InventoryError("Enter a valid customer phone in international format, such as +14155550123.");
  const userId = res.locals.deliveryUserId as string;
  const operation = await accessibleDelivery(params.data.id, userId);
  if (operation.ownerId !== userId || await deliveryRole(userId) === "courier") throw new InventoryError("Only the inventory owner can edit routing.", 403);
  await db.transaction(async tx => {
    const [current] = await tx.select().from(operations).where(eq(operations.id, operation.id)).for("update");
    if (!current || current.deliveryStartedAt || current.deliveryCompletedAt || current.status === "canceled" || current.type !== "delivery") {
      throw new InventoryError("Routing cannot be changed after a delivery starts or is canceled.", 409);
    }
    await tx.insert(deliveryConfirmations).values({
      operationId: operation.id, ownerId: userId, customerPhone: parsed.data.customerPhone,
      deliveryAddress: parsed.data.deliveryAddress.trim(),
    }).onConflictDoUpdate({
      target: deliveryConfirmations.operationId,
      set: { customerPhone: parsed.data.customerPhone, deliveryAddress: parsed.data.deliveryAddress.trim() },
    });
  });
  res.json(SaveDeliveryRecipientResponse.parse(await trackingView(operation)));
});
router.post("/tracking/:id/call", async (req, res) => {
  const params = GetDeliveryTrackingParams.safeParse(req.params);
  const parsed = CallDeliveryCustomerBody.safeParse(req.body);
  if (!params.success || !parsed.success || !parsed.data.consent) {
    throw new InventoryError("Confirm the customer's consent to a real automated receipt-verification call before calling.");
  }
  const operation = await accessibleDelivery(params.data.id, res.locals.deliveryUserId);
  if (operation.ownerId !== res.locals.deliveryUserId || await deliveryRole(res.locals.deliveryUserId) === "courier") {
    throw new InventoryError("Only the inventory owner can initiate customer confirmation calls.", 403);
  }
  const [config] = await db.select().from(deliveryVoiceSettings).where(eq(deliveryVoiceSettings.ownerId, operation.ownerId)).limit(1);
  if (!config) throw new InventoryError("The owner must configure the dedicated Retell receipt-confirmation agent in Settings first.", 409);
  const state = await db.transaction(async tx => {
    // The connector is application-wide: bound spending across workspaces, not just per delivery.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('delivery-app-call-budget'))`);
    const [budget] = await tx.select({
      total: sql<number>`coalesce(sum(${deliveryConfirmations.callAttemptCount}), 0)`,
      owner: sql<number>`coalesce(sum(case when ${deliveryConfirmations.ownerId} = ${operation.ownerId}
        then ${deliveryConfirmations.callAttemptCount} else 0 end), 0)`,
    }).from(deliveryConfirmations).where(sql`${deliveryConfirmations.lastAttemptAt} >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`);
    if (Number(budget?.total ?? 0) >= 100 || Number(budget?.owner ?? 0) >= 20) {
      throw new InventoryError("The daily confirmation-call budget has been reached. Contact the customer directly and retry tomorrow.", 429);
    }
    const [current] = await tx.select().from(operations).where(eq(operations.id, operation.id)).for("update");
    if (!current || current.type !== "delivery" || current.status !== "done" || !current.deliveryStartedAt || current.deliveryCompletedAt || !current.courierUserId) {
      throw new InventoryError("Validate the stock movement and have the assigned courier start the delivery before calling.", 409);
    }
    const [confirmation] = await tx.select().from(deliveryConfirmations).where(eq(deliveryConfirmations.operationId, operation.id)).for("update");
    if (!confirmation || !/^\+[1-9][0-9]{7,14}$/.test(confirmation.customerPhone)) {
      throw new InventoryError("Save a valid international customer phone number in Routing before calling.", 409);
    }
    if (confirmation.approval === "confirmed") throw new InventoryError("The customer already approved this delivery.", 409);
    if (confirmation.approval === "calling") throw new InventoryError("A confirmation call is already in progress. Refresh tracking instead.", 409);
    if (confirmation.callAttemptCount >= 5) throw new InventoryError("The limit of five confirmation attempts has been reached. Contact the customer directly.", 429);
    if (confirmation.lastAttemptAt && Date.now() - confirmation.lastAttemptAt.getTime() < 60_000) throw new InventoryError("Wait at least one minute before retrying a customer call.", 429);
    const [reserved] = await tx.update(deliveryConfirmations).set({
      approval: "calling", callId: null, agentId: config.agentId, callStatus: "starting", callError: null,
      lastAttemptAt: new Date(), lastPolledAt: null, callAttemptCount: sql`${deliveryConfirmations.callAttemptCount} + 1`,
    }).where(eq(deliveryConfirmations.operationId, operation.id)).returning();
    return reserved;
  });
  try {
    const call = await createRetellDeliveryCall({
      fromNumber: config.fromNumber, toNumber: state.customerPhone, agentId: config.agentId,
      operationId: operation.id, customerName: operation.contact?.trim() || "customer", reference: operation.reference,
    });
    await db.update(deliveryConfirmations).set({ callId: call.callId, callStatus: call.status }).where(and(
      eq(deliveryConfirmations.operationId, operation.id), eq(deliveryConfirmations.approval, "calling"),
    ));
  } catch (error) {
    await db.update(deliveryConfirmations).set({
      approval: "failed", callStatus: "error",
      callError: error instanceof Error ? error.message : "Unable to create the confirmation call.",
    }).where(eq(deliveryConfirmations.operationId, operation.id));
    throw error;
  }
  res.json(CallDeliveryCustomerResponse.parse(await trackingView(operation)));
});
export default router;