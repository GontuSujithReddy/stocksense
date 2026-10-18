import { and, eq, lte, or, isNull } from "drizzle-orm";
import { db, deliveryConfirmations, deliveryProfiles, deliverySupport, type OperationRow } from "@workspace/db";
import { getRetellDeliveryCallResult } from "./delivery-retell";

export async function syncDeliveryConfirmation(operationId: number) {
  const [state] = await db.select().from(deliveryConfirmations)
    .where(eq(deliveryConfirmations.operationId, operationId)).limit(1);
  if (!state || state.approval !== "calling") return;
  if (!state.callId || !state.agentId) {
    if (state.lastAttemptAt && Date.now() - state.lastAttemptAt.getTime() > 120_000) {
      await db.update(deliveryConfirmations).set({
        approval: "failed", callStatus: "unknown",
        callError: "Call initiation did not finish. Check Retell before retrying; a call may have been created.",
      }).where(and(eq(deliveryConfirmations.operationId, operationId), isNull(deliveryConfirmations.callId), eq(deliveryConfirmations.approval, "calling")));
    }
    return;
  }
  const [claimed] = await db.update(deliveryConfirmations).set({ lastPolledAt: new Date() }).where(and(
    eq(deliveryConfirmations.operationId, operationId), eq(deliveryConfirmations.callId, state.callId),
    eq(deliveryConfirmations.approval, "calling"),
    or(isNull(deliveryConfirmations.lastPolledAt), lte(deliveryConfirmations.lastPolledAt, new Date(Date.now() - 8_000))),
  )).returning();
  if (!claimed) return;
  try {
    const result = await getRetellDeliveryCallResult({
      callId: state.callId, operationId, toNumber: state.customerPhone, agentId: state.agentId,
    });
    await db.transaction(async tx => {
      const [updated] = await tx.update(deliveryConfirmations).set({
        approval: result.approval, callStatus: result.status, callError: result.error,
      }).where(and(
        eq(deliveryConfirmations.operationId, operationId), eq(deliveryConfirmations.callId, state.callId!),
        eq(deliveryConfirmations.approval, "calling"),
      )).returning();
      if (updated && result.approval === "support") {
        await tx.insert(deliverySupport).values({
          ownerId: state.ownerId, operationId, sourceCallId: state.callId,
          subject: `Customer requested support for delivery ${operationId}`,
          message: "The customer pressed 3 during the verified receipt confirmation call. Contact the customer before retrying confirmation. Delivery completion remains locked.",
        }).onConflictDoNothing({ target: deliverySupport.sourceCallId });
      }
    });
  } catch (error) {
    // Provider access failures do not invent a response or erase a possibly active call.
    await db.update(deliveryConfirmations).set({
      callError: error instanceof Error ? error.message : "Unable to check the customer call. Retry tracking later.",
    }).where(and(eq(deliveryConfirmations.operationId, operationId), eq(deliveryConfirmations.callId, state.callId)));
  }
}

export async function trackingView(operation: OperationRow, sync = false) {
  if (sync) await syncDeliveryConfirmation(operation.id);
  const [state] = await db.select().from(deliveryConfirmations).where(eq(deliveryConfirmations.operationId, operation.id)).limit(1);
  const [courier] = operation.courierUserId ? await db.select().from(deliveryProfiles)
    .where(eq(deliveryProfiles.userId, operation.courierUserId)).limit(1) : [];
  return {
    operationId: operation.id, reference: operation.reference,
    customerPhone: state?.customerPhone ?? "", deliveryAddress: state?.deliveryAddress ?? "",
    stockValidated: operation.status === "done",
    courierEmail: operation.courierEmail, courierName: courier?.name ?? null, courierPhone: courier?.phone ?? null,
    startedAt: operation.deliveryStartedAt?.toISOString() ?? null,
    completedAt: operation.deliveryCompletedAt?.toISOString() ?? null,
    approval: state?.approval ?? "pending", callId: state?.callId ?? null,
    callStatus: state?.callStatus ?? null, callError: state?.callError ?? null, confirmationRequired: !!state,
  };
}