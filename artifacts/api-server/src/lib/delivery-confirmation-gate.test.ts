import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, operations, deliveryConfirmations } from "@workspace/db";

// These are isolated, rolled-back PostgreSQL fixtures, never real customer responses.
class RollbackFixture extends Error {}
after(async () => { await db.$client.end(); });

test("PostgreSQL completion gate rejects every unapproved state and preserves legacy behavior", async () => {
  const ownerId = `delivery-gate-fixture-${randomUUID()}`;
  const courierId = `courier-fixture-${randomUUID()}`;
  let checked = false;
  try {
    await db.transaction(async tx => {
      const [operation] = await tx.insert(operations).values({
        ownerId, type: "delivery", status: "done", courierUserId: courierId, deliveryStartedAt: new Date(),
      }).returning();
      await tx.insert(deliveryConfirmations).values({ ownerId, operationId: operation.id, customerPhone: "+12025550123" });
      const complete = async (actor = courierId) => tx.update(operations).set({ deliveryCompletedAt: new Date() }).where(and(
        eq(operations.id, operation.id), eq(operations.courierUserId, actor), eq(operations.type, "delivery"),
        eq(operations.status, "done"), isNotNull(operations.deliveryStartedAt), isNull(operations.deliveryCompletedAt),
        sql`not exists (
          select 1 from ${deliveryConfirmations}
          where ${deliveryConfirmations.operationId} = ${operations.id}
            and ${deliveryConfirmations.approval} <> 'confirmed'
        )`,
      )).returning({ id: operations.id });
      for (const approval of ["pending", "calling", "rejected", "support", "unanswered", "failed"]) {
        await tx.update(deliveryConfirmations).set({ approval }).where(eq(deliveryConfirmations.operationId, operation.id));
        assert.equal((await complete()).length, 0, `${approval} must stay locked`);
      }
      await tx.update(deliveryConfirmations).set({ approval: "confirmed" }).where(eq(deliveryConfirmations.operationId, operation.id));
      assert.equal((await complete("another-courier")).length, 0, "another courier cannot complete it");
      await tx.update(operations).set({ deliveryStartedAt: null }).where(eq(operations.id, operation.id));
      assert.equal((await complete()).length, 0, "unstarted delivery stays locked");
      await tx.update(operations).set({ deliveryStartedAt: new Date(), status: "draft" }).where(eq(operations.id, operation.id));
      assert.equal((await complete()).length, 0, "unvalidated stock stays locked");
      await tx.update(operations).set({ status: "done" }).where(eq(operations.id, operation.id));
      assert.equal((await complete()).length, 1, "confirmed, validated, started delivery can complete");
      assert.equal((await complete()).length, 0, "completion is idempotently locked after the first success");
      await tx.update(operations).set({ deliveryCompletedAt: null }).where(eq(operations.id, operation.id));
      await tx.delete(deliveryConfirmations).where(eq(deliveryConfirmations.operationId, operation.id));
      assert.equal((await complete()).length, 1, "legacy operations without new confirmation records retain their old behavior");
      checked = true;
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error;
  }
  assert.ok(checked);
  const leftovers = await db.select({ id: operations.id }).from(operations).where(eq(operations.ownerId, ownerId));
  assert.equal(leftovers.length, 0, "all fixtures are rolled back");
});