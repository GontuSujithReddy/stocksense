import { createInsertSchema } from "drizzle-zod";
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { operations } from "./movements";

export const deliveryChatTokens = pgTable("delivery_chat_tokens", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("delivery_chat_tokens_token_hash").on(table.tokenHash),
  index("delivery_chat_tokens_operation_expiry").on(table.operationId, table.expiresAt),
]);

export const deliveryChatMessages = pgTable("delivery_chat_messages", {
  id: serial("id").primaryKey(),
  operationId: integer("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
  sender: text("sender").$type<"courier" | "customer">().notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("delivery_chat_messages_sender_check", sql`${table.sender} in ('courier', 'customer')`),
  index("delivery_chat_messages_operation_order").on(table.operationId, table.createdAt, table.id),
]);

export const insertDeliveryChatTokenSchema = createInsertSchema(deliveryChatTokens).omit({ id: true, createdAt: true });
export const insertDeliveryChatMessageSchema = createInsertSchema(deliveryChatMessages).omit({ id: true, createdAt: true });
export type DeliveryChatTokenRow = typeof deliveryChatTokens.$inferSelect;
export type DeliveryChatMessageRow = typeof deliveryChatMessages.$inferSelect;
