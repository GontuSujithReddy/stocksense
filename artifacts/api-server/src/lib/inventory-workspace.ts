import { eq, isNull } from "drizzle-orm";
import { db, inventoryWorkspaces } from "@workspace/db";
import { seedInventoryDemoData } from "./demo-data";

/** Ensure an active owner workspace has its one-time, additive demo dataset. */
export async function ensureInventoryWorkspace(ownerId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.insert(inventoryWorkspaces).values({ ownerId }).onConflictDoNothing();
    const [workspace] = await tx.select({
      deletedAt: inventoryWorkspaces.deletedAt,
      demoDataSeededAt: inventoryWorkspaces.demoDataSeededAt,
      storefrontSlug: inventoryWorkspaces.storefrontSlug,
      storefrontLocationId: inventoryWorkspaces.storefrontLocationId,
      storefrontDraftDesign: inventoryWorkspaces.storefrontDraftDesign,
      storefrontPublishedDesign: inventoryWorkspaces.storefrontPublishedDesign,
    }).from(inventoryWorkspaces)
      .where(eq(inventoryWorkspaces.ownerId, ownerId))
      .for("update");

    if (!workspace || workspace.deletedAt || workspace.demoDataSeededAt) return false;

    await seedInventoryDemoData(tx, ownerId, workspace);
    await tx.update(inventoryWorkspaces)
      .set({ demoDataSeededAt: new Date() })
      .where(eq(inventoryWorkspaces.ownerId, ownerId));
    return true;
  });
}

/** Backfill active workspaces; repeated calls only seed accounts still missing the marker. */
export async function seedExistingInventoryWorkspaces(): Promise<{ checked: number; seeded: number; failed: number }> {
  const existing = await db.select({ ownerId: inventoryWorkspaces.ownerId })
    .from(inventoryWorkspaces)
    .where(isNull(inventoryWorkspaces.deletedAt));
  let seeded = 0;
  let failed = 0;

  for (const { ownerId } of existing) {
    try {
      if (await ensureInventoryWorkspace(ownerId)) seeded += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked: existing.length, seeded, failed };
}