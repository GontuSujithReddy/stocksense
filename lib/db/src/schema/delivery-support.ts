import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { operations } from "./movements";

export const deliverySupport = pgTable("delivery_app_support", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  operationId: integer("operation_id").references(() => operations.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  resolution: text("resolution").notNull().default(""),
  resolvedByUserId: text("resolved_by_user_id"),
  resolvedByName: text("resolved_by_name"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  sourceCallId: text("source_call_id"),
  sourceApp: text("source_app").notNull().default("delivery"),
  assignedStaffUserId: text("assigned_staff_user_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  resolvedConfirmedByOwnerUserId: text("resolved_confirmed_by_owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("delivery_app_support_source_call").on(table.sourceCallId),
  index("delivery_app_support_app_created").on(table.sourceApp, table.createdAt),
  index("delivery_app_support_app_assignee").on(table.sourceApp, table.assignedStaffUserId),
]);

export const deliverySupportStaffMembers = pgTable("delivery_support_staff_members", {
  userId: text("user_id").primaryKey(),
  addedBy: text("added_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertDeliverySupportSchema = createInsertSchema(deliverySupport).omit({ id: true, createdAt: true });

export const insertDeliverySupportStaffMemberSchema = createInsertSchema(deliverySupportStaffMembers).omit({ createdAt: true });
export type DeliverySupportRow = typeof deliverySupport.$inferSelect;

export type DeliverySupportStaffMember = typeof deliverySupportStaffMembers.$inferSelect;
