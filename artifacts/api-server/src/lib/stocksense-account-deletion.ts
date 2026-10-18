import { and, eq, inArray, ne, or } from "drizzle-orm";
import {
  balances,
  categories,
  db,
  deliveryChatTokens,
  deliveryConfirmations,
  deliveryProfiles,
  deliverySupport,
  deliverySupportStaffMembers,
  deliveryVoiceSettings,
  inventoryWorkspaces,
  locations,
  operationLines,
  operations,
  products,
  stockMoves,
  stocksenseAdminAccounts,
  stocksenseSupportAccessRequests,
  stocksenseSupportProfiles,
  warehouses,
} from "@workspace/db";

/**
 * Permanently removes StockSense data and app-scoped account records while
 * retaining Delivery history and its foreign-key dependencies. The workspace
 * row remains as a tombstone so inventory auth cannot recreate access.
 */
export async function deleteStocksenseAccountData(ownerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(inventoryWorkspaces).values({ ownerId }).onConflictDoNothing();
    const [workspace] = await tx
      .select({ deletedAt: inventoryWorkspaces.deletedAt })
      .from(inventoryWorkspaces)
      .where(eq(inventoryWorkspaces.ownerId, ownerId))
      .for("update");

    const removeAccountRecords = async () => {
      await tx.delete(deliveryProfiles).where(eq(deliveryProfiles.userId, ownerId));
      await tx.delete(deliveryVoiceSettings).where(eq(deliveryVoiceSettings.ownerId, ownerId));
      await tx.delete(deliverySupportStaffMembers).where(eq(deliverySupportStaffMembers.userId, ownerId));
      await tx.delete(stocksenseAdminAccounts).where(eq(stocksenseAdminAccounts.userId, ownerId));
      await tx.delete(stocksenseSupportProfiles).where(eq(stocksenseSupportProfiles.userId, ownerId));
      await tx.delete(stocksenseSupportAccessRequests).where(eq(stocksenseSupportAccessRequests.userId, ownerId));
    };

    if (workspace?.deletedAt) {
      await removeAccountRecords();
      await tx.update(inventoryWorkspaces).set({
        storefrontSlug: null,
        storefrontLocationId: null,
        storefrontDraftDesign: null,
        storefrontPublishedDesign: null,
        storefrontCreatedAt: null,
        demoDataSeededAt: null,
      }).where(eq(inventoryWorkspaces.ownerId, ownerId));
      return;
    }

    const ownedOperations = await tx
      .select({
        id: operations.id,
        type: operations.type,
        courierUserId: operations.courierUserId,
        sourceLocationId: operations.sourceLocationId,
        destinationLocationId: operations.destinationLocationId,
      })
      .from(operations)
      .where(eq(operations.ownerId, ownerId));
    const ownedOperationIds = ownedOperations.map(({ id }) => id);
    const ownedOperationIdSet = new Set(ownedOperationIds);
    const retainedOperationIds = new Set<number>(
      ownedOperations
        .filter(({ type, courierUserId }) => type === "delivery" || courierUserId !== null)
        .map(({ id }) => id),
    );

    if (ownedOperationIds.length > 0) {
      // Delivery records remain available, but any active chat-link tokens must
      // stop granting access after the owner account is removed.
      await tx.delete(deliveryChatTokens)
        .where(inArray(deliveryChatTokens.operationId, ownedOperationIds));

      const confirmations = await tx
        .select({ operationId: deliveryConfirmations.operationId })
        .from(deliveryConfirmations)
        .where(inArray(deliveryConfirmations.operationId, ownedOperationIds));
      confirmations.forEach(({ operationId }) => retainedOperationIds.add(operationId));

      const linkedSupport = await tx
        .select({
          ownerId: deliverySupport.ownerId,
          sourceApp: deliverySupport.sourceApp,
          operationId: deliverySupport.operationId,
        })
        .from(deliverySupport)
        .where(inArray(deliverySupport.operationId, ownedOperationIds));
      linkedSupport.forEach(({ ownerId: ticketOwner, sourceApp, operationId }) => {
        if (operationId !== null && (ticketOwner !== ownerId || sourceApp !== "stocksense")) {
          retainedOperationIds.add(operationId);
        }
      });

      const externalLines = await tx
        .select({ operationId: operationLines.operationId })
        .from(operationLines)
        .where(and(
          inArray(operationLines.operationId, ownedOperationIds),
          ne(operationLines.ownerId, ownerId),
        ));
      externalLines.forEach(({ operationId }) => retainedOperationIds.add(operationId));

      const externalMoves = await tx
        .select({ operationId: stockMoves.operationId })
        .from(stockMoves)
        .where(and(
          inArray(stockMoves.operationId, ownedOperationIds),
          ne(stockMoves.ownerId, ownerId),
        ));
      externalMoves.forEach(({ operationId }) => {
        if (operationId !== null) retainedOperationIds.add(operationId);
      });
    }

    await tx.delete(deliverySupport).where(and(
      eq(deliverySupport.ownerId, ownerId),
      eq(deliverySupport.sourceApp, "stocksense"),
    ));
    await removeAccountRecords();

    if (retainedOperationIds.size > 0) {
      await tx.update(deliveryConfirmations).set({
        emailOtpHash: null,
        emailOtpExpiresAt: null,
        emailOtpSentAt: null,
        emailOtpLastAttemptAt: null,
        emailOtpAttemptCount: 0,
        emailOtpSendCount: 0,
      }).where(inArray(deliveryConfirmations.operationId, [...retainedOperationIds]));
    }

    const retainedBalancePairs = new Set<string>();
    if (retainedOperationIds.size > 0) {
      const retainedIds = [...retainedOperationIds];
      const retainedLines = await tx
        .select({
          operationId: operationLines.operationId,
          productId: operationLines.productId,
        })
        .from(operationLines)
        .where(inArray(operationLines.operationId, retainedIds));
      const retainedMoves = await tx
        .select({
          productId: stockMoves.productId,
          sourceLocationId: stockMoves.sourceLocationId,
          destinationLocationId: stockMoves.destinationLocationId,
        })
        .from(stockMoves)
        .where(inArray(stockMoves.operationId, retainedIds));
      const operationById = new Map(ownedOperations.map((operation) => [operation.id, operation]));
      const addBalancePair = (productId: number, locationId: number | null) => {
        if (locationId !== null) retainedBalancePairs.add(`${productId}:${locationId}`);
      };
      retainedLines.forEach(({ operationId, productId }) => {
        const operation = operationById.get(operationId);
        if (!operation) return;
        addBalancePair(productId, operation.sourceLocationId);
        addBalancePair(productId, operation.destinationLocationId);
      });
      retainedMoves.forEach(({ productId, sourceLocationId, destinationLocationId }) => {
        addBalancePair(productId, sourceLocationId);
        addBalancePair(productId, destinationLocationId);
      });
    }

    const ownedBalances = await tx
      .select({ id: balances.id, productId: balances.productId, locationId: balances.locationId })
      .from(balances)
      .where(eq(balances.ownerId, ownerId));
    const balancesToDelete = ownedBalances
      .filter(({ productId, locationId }) => !retainedBalancePairs.has(`${productId}:${locationId}`))
      .map(({ id }) => id);
    if (balancesToDelete.length > 0) {
      await tx.delete(balances).where(and(
        eq(balances.ownerId, ownerId),
        inArray(balances.id, balancesToDelete),
      ));
    }

    const ownedMoves = await tx
      .select({ id: stockMoves.id, operationId: stockMoves.operationId })
      .from(stockMoves)
      .where(eq(stockMoves.ownerId, ownerId));
    const movesToDelete = ownedMoves
      .filter(({ operationId }) => operationId === null
        || (ownedOperationIdSet.has(operationId) && !retainedOperationIds.has(operationId)))
      .map(({ id }) => id);
    if (movesToDelete.length > 0) {
      await tx.delete(stockMoves).where(and(
        eq(stockMoves.ownerId, ownerId),
        inArray(stockMoves.id, movesToDelete),
      ));
    }

    const operationsToDelete = ownedOperationIds.filter((id) => !retainedOperationIds.has(id));
    if (operationsToDelete.length > 0) {
      await tx.delete(operations).where(and(
        eq(operations.ownerId, ownerId),
        inArray(operations.id, operationsToDelete),
      ));
    }

    const ownedProducts = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.ownerId, ownerId));
    const ownedProductIds = ownedProducts.map(({ id }) => id);
    if (ownedProductIds.length > 0) {
      const referencedLines = await tx
        .select({ productId: operationLines.productId })
        .from(operationLines)
        .where(inArray(operationLines.productId, ownedProductIds));
      const referencedMoves = await tx
        .select({ productId: stockMoves.productId })
        .from(stockMoves)
        .where(inArray(stockMoves.productId, ownedProductIds));
      const referencedBalances = await tx
        .select({ productId: balances.productId })
        .from(balances)
        .where(inArray(balances.productId, ownedProductIds));
      const referencedProductIds = new Set([
        ...referencedLines.map(({ productId }) => productId),
        ...referencedMoves.map(({ productId }) => productId),
        ...referencedBalances.map(({ productId }) => productId),
      ]);
      const productsToDelete = ownedProductIds.filter((id) => !referencedProductIds.has(id));
      if (productsToDelete.length > 0) {
        await tx.delete(products).where(and(
          eq(products.ownerId, ownerId),
          inArray(products.id, productsToDelete),
        ));
      }
    }

    const ownedCategories = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.ownerId, ownerId));
    const ownedCategoryIds = ownedCategories.map(({ id }) => id);
    if (ownedCategoryIds.length > 0) {
      const referencedCategories = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(inArray(products.categoryId, ownedCategoryIds));
      const referencedCategoryIds = new Set(
        referencedCategories.flatMap(({ categoryId }) => categoryId === null ? [] : [categoryId]),
      );
      const categoriesToDelete = ownedCategoryIds.filter((id) => !referencedCategoryIds.has(id));
      if (categoriesToDelete.length > 0) {
        await tx.delete(categories).where(and(
          eq(categories.ownerId, ownerId),
          inArray(categories.id, categoriesToDelete),
        ));
      }
    }

    const ownedLocations = await tx
      .select({ id: locations.id, parentId: locations.parentId })
      .from(locations)
      .where(eq(locations.ownerId, ownerId));
    const ownedLocationIds = ownedLocations.map(({ id }) => id);
    const ownedLocationIdSet = new Set(ownedLocationIds);
    if (ownedLocationIds.length > 0) {
      const remainingOperations = await tx
        .select({
          sourceLocationId: operations.sourceLocationId,
          destinationLocationId: operations.destinationLocationId,
        })
        .from(operations)
        .where(or(
          inArray(operations.sourceLocationId, ownedLocationIds),
          inArray(operations.destinationLocationId, ownedLocationIds),
        ));
      const remainingMoves = await tx
        .select({
          sourceLocationId: stockMoves.sourceLocationId,
          destinationLocationId: stockMoves.destinationLocationId,
        })
        .from(stockMoves)
        .where(or(
          inArray(stockMoves.sourceLocationId, ownedLocationIds),
          inArray(stockMoves.destinationLocationId, ownedLocationIds),
        ));
      const remainingBalances = await tx
        .select({ locationId: balances.locationId })
        .from(balances)
        .where(inArray(balances.locationId, ownedLocationIds));
      const remainingProducts = await tx
        .select({ defaultLocationId: products.defaultLocationId })
        .from(products)
        .where(inArray(products.defaultLocationId, ownedLocationIds));
      const foreignChildren = await tx
        .select({ ownerId: locations.ownerId, parentId: locations.parentId })
        .from(locations)
        .where(and(
          inArray(locations.parentId, ownedLocationIds),
          ne(locations.ownerId, ownerId),
        ));

      const retainedLocationIds = new Set<number>();
      const addOwnedLocation = (id: number | null) => {
        if (id !== null && ownedLocationIdSet.has(id)) retainedLocationIds.add(id);
      };
      for (const row of remainingOperations) {
        addOwnedLocation(row.sourceLocationId);
        addOwnedLocation(row.destinationLocationId);
      }
      for (const row of remainingMoves) {
        addOwnedLocation(row.sourceLocationId);
        addOwnedLocation(row.destinationLocationId);
      }
      remainingBalances.forEach(({ locationId }) => addOwnedLocation(locationId));
      remainingProducts.forEach(({ defaultLocationId }) => addOwnedLocation(defaultLocationId));
      foreignChildren.forEach(({ parentId }) => addOwnedLocation(parentId));

      let addedParent = true;
      while (addedParent) {
        addedParent = false;
        for (const location of ownedLocations) {
          if (
            retainedLocationIds.has(location.id)
            && location.parentId !== null
            && ownedLocationIdSet.has(location.parentId)
            && !retainedLocationIds.has(location.parentId)
          ) {
            retainedLocationIds.add(location.parentId);
            addedParent = true;
          }
        }
      }

      const locationsToDelete = ownedLocationIds.filter((id) => !retainedLocationIds.has(id));
      if (locationsToDelete.length > 0) {
        await tx.delete(locations).where(and(
          eq(locations.ownerId, ownerId),
          inArray(locations.id, locationsToDelete),
        ));
      }
    }

    const ownedWarehouses = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.ownerId, ownerId));
    const ownedWarehouseIds = ownedWarehouses.map(({ id }) => id);
    if (ownedWarehouseIds.length > 0) {
      const referencedWarehouses = await tx
        .select({ warehouseId: locations.warehouseId })
        .from(locations)
        .where(inArray(locations.warehouseId, ownedWarehouseIds));
      const referencedWarehouseIds = new Set(referencedWarehouses.map(({ warehouseId }) => warehouseId));
      const warehousesToDelete = ownedWarehouseIds.filter((id) => !referencedWarehouseIds.has(id));
      if (warehousesToDelete.length > 0) {
        await tx.delete(warehouses).where(and(
          eq(warehouses.ownerId, ownerId),
          inArray(warehouses.id, warehousesToDelete),
        ));
      }
    }

    await tx
      .update(inventoryWorkspaces)
      .set({
        storefrontSlug: null,
        storefrontLocationId: null,
        storefrontDraftDesign: null,
        storefrontPublishedDesign: null,
        storefrontCreatedAt: null,
        demoDataSeededAt: null,
        deletedAt: new Date(),
      })
      .where(eq(inventoryWorkspaces.ownerId, ownerId));
  });
}