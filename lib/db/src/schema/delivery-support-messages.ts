import { createInsertSchema } from "drizzle-zod";
import { boolean, check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { deliverySupport } from "./delivery-support";

export const deliverySupportMessages = pgTable("delivery_app_support_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => deliverySupport.id, { onDelete: "cascade" }),
  senderRole: text("sender_role").$type<"customer" | "staff">().notNull(),
  senderId: text("sender_id"),
  message: text("message").notNull(),
  // Imported legacy replies have no recorded timestamp; leave it unknown rather than inventing one.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  isLegacy: boolean("is_legacy").notNull().default(false),
}, table => [
  check("delivery_app_support_messages_sender_check", sql`${table.senderRole} in ('customer', 'staff')`),
  index("delivery_app_support_messages_ticket_order").on(table.ticketId, table.createdAt, table.id),
  index("delivery_app_support_messages_staff_activity").on(table.senderRole, table.senderId, table.ticketId),
]);

export const insertDeliverySupportMessageSchema = createInsertSchema(deliverySupportMessages)
  .omit({ id: true, createdAt: true });
export type InsertDeliverySupportMessage = typeof deliverySupportMessages.$inferInsert;
export type DeliverySupportMessageRow = typeof deliverySupportMessages.$inferSelect;