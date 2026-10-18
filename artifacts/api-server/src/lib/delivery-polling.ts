import { eq, sql } from "drizzle-orm";
import { db, deliveryConfirmations } from "@workspace/db";
import { syncDeliveryConfirmation } from "./delivery-tracking";
import { logger } from "./logger";

// Persist call outcomes independently of whether a user keeps Tracking open.
// This only reads existing calls; it never creates or retries an outbound call.
export function startDeliveryConfirmationPolling() {
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const pending = await db.select({ operationId: deliveryConfirmations.operationId })
        .from(deliveryConfirmations)
        .where(eq(deliveryConfirmations.approval, "calling"))
        .orderBy(sql`${deliveryConfirmations.lastPolledAt} asc nulls first`)
        .limit(20);
      // The shared synchronizer also atomically throttles concurrent UI polls.
      await Promise.all(pending.map(row => syncDeliveryConfirmation(row.operationId)));
    } catch {
      logger.warn("Delivery confirmation polling could not finish; retrying next interval.");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { void poll(); }, 15_000);
  timer.unref();
  void poll();
  return () => clearInterval(timer);
}