import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import {
  db,
  balances,
  categories,
  locations,
  operationLines,
  operations,
  products,
  stockMoves,
  warehouses,
  deliveryConfirmations,
  deliveryChatMessages,
  deliveryChatTokens,
  deliveryProfiles,
} from "@workspace/db";
import {
  ListOperationsQueryParams,
  ListOperationsResponse,
  CreateOperationBody,
  CreateOperationResponse,
  GetOperationParams,
  GetOperationResponse,
  UpdateOperationParams,
  UpdateOperationBody,
  UpdateOperationResponse,
  DeleteOperationParams,
  ValidateOperationParams,
  ValidateOperationResponse,
  CancelOperationParams,
  CancelOperationResponse,
  StartDeliveryParams,
  StartDeliveryResponse,
  ReachDeliveryParams,
  ReachDeliveryResponse,
  CompleteDeliveryParams,
  CompleteDeliveryBody,
  CompleteDeliveryResponse,
  AssignDeliveryCourierParams,
  AssignDeliveryCourierBody,
  AssignDeliveryCourierResponse,
} from "@workspace/api-zod";
import { enrichedOperations } from "../lib/inventory-queries";
import { InventoryError } from "../lib/inventory-error";
import { courierDelivery } from "./courier";
import { deliveryRole } from "../lib/delivery-access";
import {
  createDeliveryOtp,
  deliveryOtpMatches,
  DELIVERY_OTP_MAX_ATTEMPTS,
  DELIVERY_OTP_MAX_SENDS,
  DELIVERY_OTP_RESEND_COOLDOWN_MS,
  DELIVERY_OTP_TTL_MS,
  hashDeliveryOtp,
} from "../lib/delivery-otp";
import { sendDeliveryOtpEmail } from "../lib/delivery-email";

const router: IRouter = Router();
type OperationType = "receipt" | "delivery" | "transfer" | "adjustment";
type LineInput = { productId: number; quantity?: number; countedQuantity?: number | null };
const openStatuses = ["draft", "waiting", "ready"] as const;
type OperationShape = {
  type: OperationType;
  sourceLocationId?: number | null;
  destinationLocationId?: number | null;
  lines: LineInput[];
};

async function checkOperationShape(ownerId: string, shape: OperationShape): Promise<void> {
  const { type, sourceLocationId, destinationLocationId, lines } = shape;
  if (!lines.length) throw new InventoryError("Add at least one product.");
  if (type === "receipt" && !destinationLocationId) {
    throw new InventoryError("Choose where the incoming goods will be stored.");
  }
  if (type === "delivery" && !sourceLocationId) {
    throw new InventoryError("Choose a picking location.");
  }
  if (type === "transfer" && (!sourceLocationId || !destinationLocationId || sourceLocationId === destinationLocationId)) {
    throw new InventoryError("Choose two different locations for the transfer.");
  }
  if (type === "adjustment" && !(sourceLocationId || destinationLocationId)) {
    throw new InventoryError("Choose the location you counted.");
  }
  const selectedLocationIds = [sourceLocationId, destinationLocationId].filter((id): id is number => id != null);
  if (selectedLocationIds.length) {
    const found = await db.select({ id: locations.id }).from(locations)
      .where(and(eq(locations.ownerId, ownerId), inArray(locations.id, selectedLocationIds)));
    if (new Set(found.map((location) => location.id)).size !== new Set(selectedLocationIds).size) {
      throw new InventoryError("Choose locations in your inventory.");
    }
  }
  const productIds = [...new Set(lines.map((line) => line.productId))];
  if (productIds.length !== lines.length) {
    throw new InventoryError("Add each product only once per operation.");
  }
  const foundProducts = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.ownerId, ownerId), eq(products.active, true), inArray(products.id, productIds)));
  if (foundProducts.length !== productIds.length) {
    throw new InventoryError("One or more selected products are no longer available.");
  }
  for (const line of lines) {
    if (type === "adjustment") {
      if (line.countedQuantity == null || !Number.isFinite(line.countedQuantity) || line.countedQuantity < 0) {
        throw new InventoryError("Enter the counted quantity for every adjusted product.");
      }
    } else if (line.quantity == null || !Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new InventoryError("Enter a quantity greater than zero for every product.");
    }
  }
}

function referenceFor(type: OperationType, id: number): string {
  const prefix = { receipt: "REC", delivery: "DLV", transfer: "INT", adjustment: "ADJ" }[type];
  return `${prefix}-${id.toString().padStart(4, "0")}`;
}

function normalizedCustomerEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() || null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

router.get("/operations", async (req, res): Promise<void> => {
  const parsed = ListOperationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const { type, status, warehouseId, categoryId } = parsed.data;
  const [all, locationRows, productRows] = await Promise.all([
    enrichedOperations(ownerId),
    db.select({ id: locations.id, warehouseId: locations.warehouseId }).from(locations).where(eq(locations.ownerId, ownerId)),
    db.select({ id: products.id, categoryId: products.categoryId }).from(products).where(eq(products.ownerId, ownerId)),
  ]);
  const scopedLocations = new Set(locationRows.filter((location) => location.warehouseId === warehouseId).map((location) => location.id));
  const scopedProducts = new Set(productRows.filter((product) => product.categoryId === categoryId).map((product) => product.id));
  res.json(ListOperationsResponse.parse(all.filter((operation) =>
    (!type || operation.type === type) &&
    (!status || operation.status === status) &&
    (!warehouseId || (operation.sourceLocationId != null && scopedLocations.has(operation.sourceLocationId)) ||
      (operation.destinationLocationId != null && scopedLocations.has(operation.destinationLocationId))) &&
    (!categoryId || operation.lines.some((line) => scopedProducts.has(line.productId))),
  )));
});

router.post("/operations", async (req, res): Promise<void> => {
  const parsed = CreateOperationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const data = parsed.data;
  if (data.status === "done" || data.status === "canceled") {
    throw new InventoryError("Validate or cancel an operation using its action buttons.");
  }
  const customerEmail = normalizedCustomerEmail(data.customerEmail);
  if (data.type === "delivery" && !customerEmail) {
    throw new InventoryError("Add a valid customer email for delivery OTP confirmation.", 400);
  }
  await checkOperationShape(ownerId, data);
  const id = await db.transaction(async (tx) => {
    const [operation] = await tx.insert(operations).values({
      ownerId,
      type: data.type,
      origin: "inventory",
      status: data.status ?? "draft",
      contact: data.contact ?? null,
      customerEmail,
      sourceLocationId: data.sourceLocationId ?? null,
      destinationLocationId: data.destinationLocationId ?? null,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    }).returning();
    await tx.update(operations)
      .set({ reference: referenceFor(data.type, operation.id) })
      .where(eq(operations.id, operation.id));
    await tx.insert(operationLines).values(data.lines.map((line) => ({
      ownerId,
      operationId: operation.id,
      productId: line.productId,
      quantity: line.quantity ?? 0,
      countedQuantity: line.countedQuantity ?? null,
    })));
    if (data.type === "delivery" && data.contactPhone !== undefined) {
      await tx.insert(deliveryConfirmations).values({
        operationId: operation.id, ownerId,
        customerPhone: data.contactPhone ?? "", deliveryAddress: data.deliveryAddress?.trim() ?? "",
      });
    }
    return operation.id;
  });
  const operation = (await enrichedOperations(ownerId)).find((item) => item.id === id);
  res.status(201).json(CreateOperationResponse.parse(operation));
});

router.get("/operations/:id", async (req, res): Promise<void> => {
  const params = GetOperationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const operation = (await enrichedOperations(res.locals.ownerId)).find((item) => item.id === params.data.id);
  if (!operation) {
    res.status(404).json({ error: "Operation not found." });
    return;
  }
  res.json(GetOperationResponse.parse(operation));
});

router.patch("/operations/:id", async (req, res): Promise<void> => {
  const params = UpdateOperationParams.safeParse(req.params);
  const parsed = UpdateOperationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request." });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const [existing] = await db.select().from(operations)
    .where(and(eq(operations.ownerId, ownerId), eq(operations.id, params.data.id))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Operation not found." });
    return;
  }
  const data = parsed.data;
  if (existing.origin === "storefront") {
    if (data.type !== undefined && data.type !== "delivery") {
      throw new InventoryError("Storefront orders must remain delivery operations.", 409);
    }
    if (data.sourceLocationId !== undefined && data.sourceLocationId !== existing.sourceLocationId) {
      throw new InventoryError("The fulfillment location cannot be changed on a storefront order.", 409);
    }
    if (data.destinationLocationId !== undefined && data.destinationLocationId !== null) {
      throw new InventoryError("The destination is fixed for a storefront delivery.", 409);
    }
    if (data.lines !== undefined) {
      throw new InventoryError("Storefront order items cannot be edited. Cancel the order and create a new one instead.", 409);
    }
  }
  if (existing.status === "done" || existing.status === "canceled") {
    const emailOnlyUpdate = existing.status === "done"
      && existing.type === "delivery"
      && !existing.deliveryStartedAt
      && !existing.deliveryCompletedAt
      && data.customerEmail !== undefined
      && Object.keys(data).every(key => key === "customerEmail");
    if (emailOnlyUpdate) {
      const customerEmail = normalizedCustomerEmail(data.customerEmail);
      if (!customerEmail) {
        throw new InventoryError("Add a valid customer email for delivery OTP confirmation.", 400);
      }
      const [updated] = await db.update(operations).set({ customerEmail })
        .where(and(
          eq(operations.ownerId, ownerId),
          eq(operations.id, existing.id),
          eq(operations.type, "delivery"),
          isNull(operations.deliveryStartedAt),
          isNull(operations.deliveryCompletedAt),
        )).returning({ id: operations.id });
      if (!updated) throw new InventoryError("The delivery has already started and its customer email can no longer be changed.", 409);
      const operation = (await enrichedOperations(ownerId)).find((item) => item.id === existing.id);
      res.json(UpdateOperationResponse.parse(operation));
      return;
    }
    throw new InventoryError("Completed or canceled operations cannot be edited.", 409);
  }
  if (data.status === "done" || data.status === "canceled") {
    throw new InventoryError("Use Validate or Cancel to finish an operation.");
  }
  const currentLines = await db.select().from(operationLines)
    .where(and(eq(operationLines.ownerId, ownerId), eq(operationLines.operationId, existing.id)));
  const nextType = (data.type ?? existing.type) as OperationType;
  const typeChanged = nextType !== existing.type;
  const customerEmail = normalizedCustomerEmail(data.customerEmail === undefined ? existing.customerEmail : data.customerEmail);
  if (nextType === "delivery" && !customerEmail) {
    throw new InventoryError("Add a valid customer email for delivery OTP confirmation.", 400);
  }
  const sourceLocationId = typeChanged && nextType === "receipt"
    ? null
    : data.sourceLocationId !== undefined ? data.sourceLocationId : existing.sourceLocationId;
  const destinationLocationId = typeChanged && (nextType === "delivery" || nextType === "adjustment")
    ? null
    : data.destinationLocationId !== undefined ? data.destinationLocationId : existing.destinationLocationId;
  await checkOperationShape(ownerId, {
    type: nextType,
    sourceLocationId,
    destinationLocationId,
    lines: data.lines ?? currentLines,
  });
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(operations)
      .where(and(eq(operations.ownerId, ownerId), eq(operations.id, existing.id))).for("update");
    if (!current || current.status === "done" || current.status === "canceled") {
      throw new InventoryError("This operation can no longer be edited.", 409);
    }
    if (current.type !== existing.type) {
      throw new InventoryError("This operation changed while you were editing it. Reload and try again.", 409);
    }
    await tx.update(operations).set({
      ...(typeChanged ? {
        type: nextType,
        reference: referenceFor(nextType, existing.id),
        status: "draft" as const,
        courierUserId: null,
        courierEmail: null,
        deliveryStartedAt: null,
        deliveryReachedAt: null,
        deliveryCompletedAt: null,
        customerEmail: nextType === "delivery" ? customerEmail : null,
      } : data.status !== undefined ? { status: data.status } : {}),
      ...(data.contact !== undefined ? { contact: data.contact } : {}),
      ...(!typeChanged && data.customerEmail !== undefined ? { customerEmail } : {}),
      ...(typeChanged || data.sourceLocationId !== undefined ? { sourceLocationId } : {}),
      ...(typeChanged || data.destinationLocationId !== undefined ? { destinationLocationId } : {}),
      ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null } : {}),
    }).where(and(eq(operations.ownerId, ownerId), eq(operations.id, existing.id)));
    if (data.lines) {
      await tx.delete(operationLines).where(and(eq(operationLines.ownerId, ownerId), eq(operationLines.operationId, existing.id)));
      await tx.insert(operationLines).values(data.lines.map((line) => ({
        ownerId,
        operationId: existing.id,
        productId: line.productId,
        quantity: line.quantity ?? 0,
        countedQuantity: line.countedQuantity ?? null,
      })));
    }
    if (typeChanged) {
      await tx.delete(deliveryConfirmations).where(eq(deliveryConfirmations.operationId, existing.id));
      await tx.delete(deliveryChatMessages).where(eq(deliveryChatMessages.operationId, existing.id));
      await tx.delete(deliveryChatTokens).where(eq(deliveryChatTokens.operationId, existing.id));
    }
    if (nextType === "delivery" && (data.contactPhone !== undefined || data.deliveryAddress !== undefined)) {
      await tx.insert(deliveryConfirmations).values({
        operationId: existing.id, ownerId,
        customerPhone: data.contactPhone ?? "", deliveryAddress: data.deliveryAddress?.trim() ?? "",
      }).onConflictDoUpdate({
        target: deliveryConfirmations.operationId,
        set: {
          ...(data.contactPhone !== undefined ? { customerPhone: data.contactPhone ?? "" } : {}),
          ...(data.deliveryAddress !== undefined ? { deliveryAddress: data.deliveryAddress.trim() } : {}),
        },
      });
    }
  });
  const operation = (await enrichedOperations(ownerId)).find((item) => item.id === existing.id);
  res.json(UpdateOperationResponse.parse(operation));
});

router.delete("/operations/:id", async (req, res): Promise<void> => {
  const params = DeleteOperationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(operations)
    .where(and(eq(operations.ownerId, res.locals.ownerId), eq(operations.id, params.data.id), eq(operations.status, "draft")))
    .returning({ id: operations.id });
  if (!deleted) {
    res.status(409).json({ error: "Only draft operations can be deleted." });
    return;
  }
  res.sendStatus(204);
});

router.post("/operations/:id/validate", async (req, res): Promise<void> => {
  const params = ValidateOperationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const [existing] = await db.select().from(operations)
    .where(and(eq(operations.ownerId, ownerId), eq(operations.id, params.data.id))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Operation not found." });
    return;
  }
  const existingLines = await db.select().from(operationLines)
    .where(and(eq(operationLines.ownerId, ownerId), eq(operationLines.operationId, existing.id)));
  await checkOperationShape(ownerId, {
    type: existing.type as OperationType,
    sourceLocationId: existing.sourceLocationId,
    destinationLocationId: existing.destinationLocationId,
    lines: existingLines,
  });

  await db.transaction(async (tx) => {
    const [operation] = await tx.select().from(operations)
      .where(and(eq(operations.ownerId, ownerId), eq(operations.id, existing.id))).for("update");
    if (!operation || operation.status === "done" || operation.status === "canceled") {
      throw new InventoryError("This operation cannot be validated again.", 409);
    }
    const lines = await tx.select().from(operationLines)
      .where(and(eq(operationLines.ownerId, ownerId), eq(operationLines.operationId, operation.id)));
    // Serialize validation with archive so a pending receipt cannot restore stock after it is cleared.
    const productIds = [...new Set(lines.map((line) => line.productId))].sort((a, b) => a - b);
    const activeProducts = await tx.select({ id: products.id }).from(products)
      .where(and(eq(products.ownerId, ownerId), eq(products.active, true), inArray(products.id, productIds)))
      .orderBy(products.id)
      .for("share");
    if (activeProducts.length !== productIds.length) {
      throw new InventoryError("One or more selected products have been archived.", 409);
    }

    const addStock = async (productId: number, locationId: number, amount: number) => {
      await tx.insert(balances).values({ ownerId, productId, locationId, quantity: amount })
        .onConflictDoUpdate({
          target: [balances.ownerId, balances.productId, balances.locationId],
          set: { quantity: sql`${balances.quantity} + ${amount}` },
        });
    };
    const takeStock = async (productId: number, locationId: number, amount: number) => {
      const [currentBalance] = await tx.select({ quantity: balances.quantity }).from(balances)
        .where(and(
          eq(balances.ownerId, ownerId),
          eq(balances.productId, productId),
          eq(balances.locationId, locationId),
        )).for("update");
      const [reservation] = await tx.select({
        quantity: sql<number>`coalesce(sum(${operationLines.quantity}), 0)`,
      }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
        .where(and(
          eq(operationLines.ownerId, ownerId),
          eq(operations.ownerId, ownerId),
          eq(operations.origin, "storefront"),
          eq(operations.sourceLocationId, locationId),
          eq(operationLines.productId, productId),
          inArray(operations.status, [...openStatuses]),
          ...(operation.origin === "storefront" ? [ne(operations.id, operation.id)] : []),
        ));
      const availableAfterReservations = (currentBalance?.quantity ?? 0) - Number(reservation?.quantity ?? 0);
      if (availableAfterReservations < amount) {
        throw new InventoryError("Some of this stock is reserved for an open storefront order. Cancel that order or review the available quantity.", 409);
      }
      const [updated] = await tx.update(balances)
        .set({ quantity: sql`${balances.quantity} - ${amount}` })
        .where(and(
          eq(balances.ownerId, ownerId),
          eq(balances.productId, productId),
          eq(balances.locationId, locationId),
          gte(balances.quantity, amount),
        ))
        .returning({ id: balances.id });
      if (!updated) throw new InventoryError("Not enough stock at the selected location.", 409);
    };

    for (const line of lines) {
      let movedQuantity = line.quantity;
      let sourceLocationId = operation.sourceLocationId;
      let destinationLocationId = operation.destinationLocationId;
      if (operation.type === "receipt") {
        await addStock(line.productId, destinationLocationId!, line.quantity);
      } else if (operation.type === "delivery") {
        await takeStock(line.productId, sourceLocationId!, line.quantity);
        movedQuantity = -line.quantity;
      } else if (operation.type === "transfer") {
        await takeStock(line.productId, sourceLocationId!, line.quantity);
        await addStock(line.productId, destinationLocationId!, line.quantity);
      } else {
        const locationId = sourceLocationId ?? destinationLocationId!;
        const [current] = await tx.select().from(balances)
          .where(and(eq(balances.ownerId, ownerId), eq(balances.productId, line.productId), eq(balances.locationId, locationId)))
          .for("update");
        const [reservation] = await tx.select({
          quantity: sql<number>`coalesce(sum(${operationLines.quantity}), 0)`,
        }).from(operationLines).innerJoin(operations, eq(operations.id, operationLines.operationId))
          .where(and(
            eq(operationLines.ownerId, ownerId),
            eq(operations.ownerId, ownerId),
            eq(operations.origin, "storefront"),
            eq(operations.sourceLocationId, locationId),
            eq(operationLines.productId, line.productId),
            inArray(operations.status, [...openStatuses]),
          ));
        if ((line.countedQuantity ?? 0) < Number(reservation?.quantity ?? 0)) {
          throw new InventoryError("This count would reduce stock below the quantity reserved for an open storefront order.", 409);
        }
        movedQuantity = (line.countedQuantity ?? 0) - (current?.quantity ?? 0);
        await tx.insert(balances).values({
          ownerId,
          productId: line.productId,
          locationId,
          quantity: line.countedQuantity ?? 0,
        }).onConflictDoUpdate({
          target: [balances.ownerId, balances.productId, balances.locationId],
          set: { quantity: line.countedQuantity ?? 0 },
        });
        await tx.update(operationLines).set({ quantity: Math.abs(movedQuantity) })
          .where(eq(operationLines.id, line.id));
        sourceLocationId = movedQuantity < 0 ? locationId : null;
        destinationLocationId = movedQuantity >= 0 ? locationId : null;
      }
      await tx.insert(stockMoves).values({
        ownerId,
        operationId: operation.id,
        productId: line.productId,
        type: operation.type,
        reference: operation.reference,
        sourceLocationId,
        destinationLocationId,
        quantity: movedQuantity,
      });
    }
    await tx.update(operations).set({ status: "done" })
      .where(and(eq(operations.ownerId, ownerId), eq(operations.id, operation.id)));
  });
  const operation = (await enrichedOperations(ownerId)).find((item) => item.id === existing.id);
  res.json(ValidateOperationResponse.parse(operation));
});

router.post("/operations/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelOperationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const [updated] = await db.update(operations).set({ status: "canceled" })
    .where(and(eq(operations.ownerId, ownerId), eq(operations.id, params.data.id), inArray(operations.status, ["draft", "waiting", "ready"])))
    .returning({ id: operations.id });
  if (!updated) {
    res.status(409).json({ error: "Only open operations can be canceled." });
    return;
  }
  const operation = (await enrichedOperations(ownerId)).find((item) => item.id === updated.id);
  res.json(CancelOperationResponse.parse(operation));
});

router.put("/operations/:id/courier", async (req, res): Promise<void> => {
  const params = AssignDeliveryCourierParams.safeParse(req.params);
  const parsed = AssignDeliveryCourierBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request." });
    return;
  }
  const ownerId = res.locals.ownerId as string;
  const email = parsed.data.email?.trim().toLowerCase() ?? null;
  let courierUserId: string | null = null;
  if (email) {
    const { data: users } = await clerkClient.users.getUserList({ emailAddress: [email], limit: 10 });
    const courier = users.find(user => user.emailAddresses.some(
      address => address.emailAddress.toLowerCase() === email && address.verification?.status === "verified",
    ));
    if (!courier) {
      res.status(404).json({ error: "No verified account has that email. Ask the courier to sign up and verify their email first." });
      return;
    }
    if (courier.id === ownerId) {
      res.status(400).json({ error: "Choose a courier account other than your own." });
      return;
    }
    const existingInventory = await Promise.all([categories, products, warehouses, operations].map(table =>
      db.select({ id: table.id }).from(table).where(eq(table.ownerId, courier.id)).limit(1),
    ));
    if (existingInventory.some(rows => rows.length)) {
      res.status(409).json({ error: "This account already owns inventory. Ask the courier to use a separate account." });
      return;
    }
    courierUserId = courier.id;
    const [profile] = await db.select().from(deliveryProfiles).where(and(
      eq(deliveryProfiles.userId, courier.id), eq(deliveryProfiles.role, "courier"),
    )).limit(1);
    if (!profile || !/^[0-9]{10}$/.test(profile.phone) || await deliveryRole(courier.id) !== "courier") {
      res.status(409).json({ error: "Ask this account to complete Courier setup with a 10-digit phone number before assigning it." });
      return;
    }
  }
  const [updated] = await db.update(operations).set({ courierUserId, courierEmail: email })
    .where(and(
      eq(operations.ownerId, ownerId),
      eq(operations.id, params.data.id),
      eq(operations.type, "delivery"),
      sql`${operations.status} <> 'canceled'`,
      isNull(operations.deliveryStartedAt),
      isNull(operations.deliveryCompletedAt),
    )).returning({ id: operations.id });
  if (!updated) {
    res.status(409).json({ error: "Only an unstarted delivery in your workspace can be assigned." });
    return;
  }
  const operation = (await enrichedOperations(ownerId)).find(item => item.id === updated.id);
  res.json(AssignDeliveryCourierResponse.parse(operation));
});

router.post("/operations/:id/delivery/start", async (req, res): Promise<void> => {
  const params = StartDeliveryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const courierId = res.locals.ownerId as string;
  const result = await db.transaction(async tx => {
    const [current] = await tx.select().from(operations).where(and(
      eq(operations.courierUserId, courierId),
      eq(operations.id, params.data.id),
      eq(operations.type, "delivery"),
    )).for("update");
    if (!current) return { error: "not-found" as const };
    if (current.status !== "done" || current.deliveryStartedAt || current.deliveryCompletedAt) {
      return { error: "not-ready" as const };
    }
    if (!normalizedCustomerEmail(current.customerEmail)) return { error: "email-missing" as const };
    const [operation] = await tx.update(operations).set({ deliveryStartedAt: new Date() })
      .where(and(
        eq(operations.id, current.id),
        isNull(operations.deliveryStartedAt),
        isNull(operations.deliveryCompletedAt),
      )).returning();
    return operation ? { operation } : { error: "not-ready" as const };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "Delivery not found." });
      return;
    }
    if (result.error === "email-missing") {
      throw new InventoryError("Ask the workspace owner to add the customer's email before starting this delivery.", 409);
    }
    throw new InventoryError("Validate the delivery stock movement before starting, and start it only once.", 409);
  }
  res.json(StartDeliveryResponse.parse(await courierDelivery(result.operation)));
});

router.post("/operations/:id/delivery/reach", async (req, res): Promise<void> => {
  const params = ReachDeliveryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const courierId = res.locals.ownerId as string;
  const now = new Date();
  const otp = createDeliveryOtp();
  const result = await db.transaction(async tx => {
    const [operation] = await tx.select().from(operations).where(and(
      eq(operations.courierUserId, courierId),
      eq(operations.id, params.data.id),
      eq(operations.type, "delivery"),
    )).for("update");
    if (!operation) return { error: "not-found" as const };
    if (operation.status !== "done" || !operation.deliveryStartedAt || operation.deliveryCompletedAt) {
      return { error: "not-ready" as const };
    }
    const email = normalizedCustomerEmail(operation.customerEmail);
    if (!email) return { error: "email-missing" as const };

    await tx.insert(deliveryConfirmations).values({ operationId: operation.id, ownerId: operation.ownerId })
      .onConflictDoNothing({ target: deliveryConfirmations.operationId });
    const [confirmation] = await tx.select().from(deliveryConfirmations)
      .where(eq(deliveryConfirmations.operationId, operation.id)).for("update");
    if (confirmation?.emailOtpVerifiedAt) return { error: "already-verified" as const };
    if ((confirmation?.emailOtpSendCount ?? 0) >= DELIVERY_OTP_MAX_SENDS) return { error: "send-limit" as const };
    if (confirmation?.emailOtpLastAttemptAt
      && now.getTime() - confirmation.emailOtpLastAttemptAt.getTime() < DELIVERY_OTP_RESEND_COOLDOWN_MS) {
      return { error: "cooldown" as const };
    }

    await tx.update(operations).set({ deliveryReachedAt: operation.deliveryReachedAt ?? now })
      .where(eq(operations.id, operation.id));
    await tx.update(deliveryConfirmations).set({
      emailOtpHash: hashDeliveryOtp(operation.id, otp),
      emailOtpExpiresAt: new Date(now.getTime() + DELIVERY_OTP_TTL_MS),
      emailOtpSentAt: null,
      emailOtpLastAttemptAt: now,
      emailOtpAttemptCount: 0,
      emailOtpSendCount: (confirmation?.emailOtpSendCount ?? 0) + 1,
    }).where(eq(deliveryConfirmations.operationId, operation.id));
    return { operation: { ...operation, deliveryReachedAt: operation.deliveryReachedAt ?? now }, email };
  });

  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "Delivery not found." });
      return;
    }
    if (result.error === "email-missing") throw new InventoryError("Ask the workspace owner to add a valid customer email before sending the OTP.", 409);
    if (result.error === "send-limit") throw new InventoryError("The email code send limit has been reached. Contact the workspace owner.", 429);
    if (result.error === "cooldown") throw new InventoryError("Wait one minute before requesting another customer code.", 429);
    if (result.error === "already-verified") throw new InventoryError("This delivery code was already verified.", 409);
    throw new InventoryError("Start the delivery before recording arrival. Arrival can only be recorded once the stock is validated.", 409);
  }

  try {
    await sendDeliveryOtpEmail({
      to: result.email,
      customerName: result.operation.contact,
      reference: result.operation.reference,
      otp,
    });
  } catch (error) {
    req.log.warn({ operationId: result.operation.id, err: error }, "Delivery OTP email could not be sent");
    throw new InventoryError("The customer code could not be emailed. Check the StockSense sender configuration and retry.", 502);
  }

  const sentAt = new Date();
  await db.update(deliveryConfirmations).set({ emailOtpSentAt: sentAt })
    .where(eq(deliveryConfirmations.operationId, result.operation.id));
  res.json(ReachDeliveryResponse.parse(await courierDelivery(result.operation)));
});

router.post("/operations/:id/delivery/complete", async (req, res): Promise<void> => {
  const params = CompleteDeliveryParams.safeParse(req.params);
  const parsed = CompleteDeliveryBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message ?? "Invalid verification code." });
    return;
  }
  const courierId = res.locals.ownerId as string;
  const now = new Date();
  const result = await db.transaction(async tx => {
    const [operation] = await tx.select().from(operations).where(and(
      eq(operations.courierUserId, courierId),
      eq(operations.id, params.data.id),
      eq(operations.type, "delivery"),
    )).for("update");
    if (!operation) return { error: "not-found" as const };
    if (operation.status !== "done" || !operation.deliveryStartedAt || operation.deliveryCompletedAt) {
      return { error: "not-ready" as const };
    }
    if (!operation.deliveryReachedAt) return { error: "not-reached" as const };

    const [confirmation] = await tx.select().from(deliveryConfirmations)
      .where(eq(deliveryConfirmations.operationId, operation.id)).for("update");
    if (!confirmation?.emailOtpHash || !confirmation.emailOtpSentAt || !confirmation.emailOtpExpiresAt) {
      return { error: "code-not-sent" as const };
    }
    if (confirmation.emailOtpVerifiedAt) return { error: "already-completed" as const };
    if (confirmation.emailOtpExpiresAt.getTime() <= now.getTime()) return { error: "code-expired" as const };
    if (confirmation.emailOtpAttemptCount >= DELIVERY_OTP_MAX_ATTEMPTS) return { error: "attempt-limit" as const };
    if (!deliveryOtpMatches(operation.id, parsed.data.otp, confirmation.emailOtpHash)) {
      await tx.update(deliveryConfirmations).set({
        emailOtpAttemptCount: confirmation.emailOtpAttemptCount + 1,
      }).where(eq(deliveryConfirmations.operationId, operation.id));
      return { error: "code-invalid" as const };
    }

    await tx.update(deliveryConfirmations).set({ emailOtpVerifiedAt: now })
      .where(eq(deliveryConfirmations.operationId, operation.id));
    const [completed] = await tx.update(operations).set({ deliveryCompletedAt: now })
      .where(and(
        eq(operations.id, operation.id),
        isNull(operations.deliveryCompletedAt),
      )).returning();
    return completed ? { operation: { ...operation, deliveryCompletedAt: now } } : { error: "not-ready" as const };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "Delivery not found." });
      return;
    }
    if (result.error === "attempt-limit") throw new InventoryError("Too many incorrect codes. Request a new customer code before trying again.", 429);
    if (result.error === "code-invalid") throw new InventoryError("That code is incorrect. Check the customer email and try again.", 400);
    if (result.error === "code-expired") throw new InventoryError("That code has expired. Request a new customer code.", 409);
    if (result.error === "code-not-sent") throw new InventoryError("The customer code has not been sent yet. Send it before marking the delivery done.", 409);
    if (result.error === "not-reached") throw new InventoryError("Record Reached destination and send the customer code before marking the delivery done.", 409);
    if (result.error === "already-completed") throw new InventoryError("This delivery has already been completed.", 409);
    throw new InventoryError("Start and reach the delivery, then enter the current customer code before marking it done.", 409);
  }
  res.json(CompleteDeliveryResponse.parse(await courierDelivery(result.operation)));
});

export default router;