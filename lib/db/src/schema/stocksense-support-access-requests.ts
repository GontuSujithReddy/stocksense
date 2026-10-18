import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const stocksenseSupportAccessRequests = pgTable("stocksense_support_access_requests", {
  userId: text("user_id").primaryKey(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
  status: text("status").$type<"pending" | "approved" | "denied">().notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: text("reviewed_by_user_id"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedByUserId: text("paused_by_user_id"),
});

export const insertStocksenseSupportAccessRequestSchema = createInsertSchema(stocksenseSupportAccessRequests)
  .omit({ requestedAt: true, notificationSentAt: true, status: true, reviewedAt: true, reviewedByUserId: true, pausedAt: true, pausedByUserId: true });

export type StocksenseSupportAccessRequest = typeof stocksenseSupportAccessRequests.$inferSelect;
export type InsertStocksenseSupportAccessRequest = typeof stocksenseSupportAccessRequests.$inferInsert;