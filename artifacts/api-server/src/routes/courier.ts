import { and, asc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import { db, deliveryChatMessages, deliveryChatTokens, deliveryConfirmations, deliveryProfiles, operations } from "@workspace/db";
import {
  GetCourierDeliveryParams,
  GetCourierDeliveryResponse,
  ListCourierDeliveriesResponse,
  ListCourierDeliveryMessagesParams,
  ListCourierDeliveryMessagesResponse,
  SendCourierDeliveryMessageParams,
  SendCourierDeliveryMessageBody,
  SendCourierDeliveryMessageResponse,
} from "@workspace/api-zod";
import { deliveryRole } from "../lib/delivery-access";
import {
  createDeliveryChatToken,
  DELIVERY_CHAT_TOKEN_TTL_MS,
  hashDeliveryChatToken,
  maskCustomerEmail,
} from "../lib/delivery-otp";
import { deliveryChatLink, sendDeliveryChatEmail } from "../lib/delivery-email";
import { InventoryError } from "../lib/inventory-error";

const router: IRouter = Router();

export async function courierDelivery(row: typeof operations.$inferSelect) {
  const [confirmation] = await db.select({
    emailOtpSentAt: deliveryConfirmations.emailOtpSentAt,
    emailOtpExpiresAt: deliveryConfirmations.emailOtpExpiresAt,
  }).from(deliveryConfirmations).where(eq(deliveryConfirmations.operationId, row.id)).limit(1);
  return {
    id: row.id,
    reference: row.reference,
    contact: row.contact,
    customerEmailMasked: maskCustomerEmail(row.customerEmail),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    status: row.status,
    deliveryStartedAt: row.deliveryStartedAt?.toISOString() ?? null,
    deliveryReachedAt: row.deliveryReachedAt?.toISOString() ?? null,
    emailOtpSentAt: confirmation?.emailOtpSentAt?.toISOString() ?? null,
    emailOtpExpiresAt: confirmation?.emailOtpExpiresAt?.toISOString() ?? null,
    deliveryCompletedAt: row.deliveryCompletedAt?.toISOString() ?? null,
  };
}

function chatMessage(row: typeof deliveryChatMessages.$inferSelect) {
  return {
    id: row.id,
    sender: row.sender,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

router.use("/courier", (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Please sign in to view your deliveries." });
    return;
  }
  res.locals.courierId = userId;
  next();
});

router.use("/courier", async (_req, res, next) => {
  if (await deliveryRole(res.locals.courierId as string) !== "courier") {
    res.status(403).json({ error: "Courier access is limited to registered courier accounts." });
    return;
  }
  next();
});

router.get("/courier/deliveries", async (_req, res): Promise<void> => {
  const rows = await db.select().from(operations)
    .where(and(eq(operations.courierUserId, res.locals.courierId), eq(operations.type, "delivery")));
  res.json(ListCourierDeliveriesResponse.parse(await Promise.all(rows.map(courierDelivery))));
});

router.get("/courier/deliveries/:id", async (req, res): Promise<void> => {
  const parsed = GetCourierDeliveryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.select().from(operations).where(and(
    eq(operations.id, parsed.data.id),
    eq(operations.type, "delivery"),
    eq(operations.courierUserId, res.locals.courierId),
  )).limit(1);
  if (!row) {
    res.status(404).json({ error: "Delivery not found." });
    return;
  }
  res.json(GetCourierDeliveryResponse.parse(await courierDelivery(row)));
});

router.get("/courier/deliveries/:id/messages", async (req, res): Promise<void> => {
  const parsed = ListCourierDeliveryMessagesParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const courierId = res.locals.courierId as string;
  const [operation] = await db.select({ id: operations.id }).from(operations).where(and(
    eq(operations.id, parsed.data.id),
    eq(operations.type, "delivery"),
    eq(operations.courierUserId, courierId),
  )).limit(1);
  if (!operation) {
    res.status(404).json({ error: "Delivery not found." });
    return;
  }
  const messages = await db.select().from(deliveryChatMessages)
    .where(eq(deliveryChatMessages.operationId, operation.id))
    .orderBy(asc(deliveryChatMessages.createdAt), asc(deliveryChatMessages.id));
  res.json(ListCourierDeliveryMessagesResponse.parse(messages.map(chatMessage)));
});

router.post("/courier/deliveries/:id/messages", async (req, res): Promise<void> => {
  const params = SendCourierDeliveryMessageParams.safeParse(req.params);
  const parsed = SendCourierDeliveryMessageBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : parsed.error?.message ?? "Invalid message." });
    return;
  }
  const courierId = res.locals.courierId as string;
  const message = parsed.data.message.trim();
  if (!message) {
    res.status(400).json({ error: "Enter a message before sending." });
    return;
  }
  const token = createDeliveryChatToken();
  const result = await db.transaction(async tx => {
    const [operation] = await tx.select().from(operations).where(and(
      eq(operations.id, params.data.id),
      eq(operations.type, "delivery"),
      eq(operations.courierUserId, courierId),
    )).for("update");
    if (!operation) return { error: "not-found" as const };
    if (operation.deliveryCompletedAt || operation.status === "canceled") return { error: "closed" as const };
    if (!operation.customerEmail) return { error: "no-email" as const };
    const [saved] = await tx.insert(deliveryChatMessages).values({
      operationId: operation.id,
      sender: "courier",
      message,
    }).returning();
    await tx.insert(deliveryChatTokens).values({
      operationId: operation.id,
      tokenHash: hashDeliveryChatToken(token),
      expiresAt: new Date(Date.now() + DELIVERY_CHAT_TOKEN_TTL_MS),
    });
    return { operation, message: saved };
  });

  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "Delivery not found." });
      return;
    }
    if (result.error === "no-email") throw new InventoryError("Add a customer email to this delivery before starting a chat.", 409);
    throw new InventoryError("The delivery chat is closed.", 409);
  }

  let emailSent = false;
  try {
    await sendDeliveryChatEmail({
      to: result.operation.customerEmail!,
      customerName: result.operation.contact,
      reference: result.operation.reference,
      message,
      chatUrl: deliveryChatLink(req, token),
    });
    emailSent = true;
  } catch (error) {
    req.log.warn({ operationId: result.operation.id, err: error }, "Delivery chat email could not be sent");
  }

  res.json(SendCourierDeliveryMessageResponse.parse({
    message: chatMessage(result.message),
    emailSent,
  }));
});

export default router;