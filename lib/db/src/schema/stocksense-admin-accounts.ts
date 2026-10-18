import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const stocksenseAdminAccounts = pgTable("stocksense_admin_accounts", {
  userId: text("user_id").primaryKey(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  requestStatus: text("request_status").$type<"pending" | "accepted" | "denied">().notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: text("reviewed_by_user_id"),
  accessStatus: text("access_status").$type<"active" | "inactive" | "terminated">(),
  accessChangedAt: timestamp("access_changed_at", { withTimezone: true }),
  accessChangedByUserId: text("access_changed_by_user_id"),
  terminatedAt: timestamp("terminated_at", { withTimezone: true }),
  terminatedByUserId: text("terminated_by_user_id"),
  displayName: text("display_name").notNull(),
  verifiedEmail: text("verified_email").notNull(),
  phone: text("phone").notNull(),
});

export const insertStocksenseAdminAccountSchema = createInsertSchema(stocksenseAdminAccounts)
  .omit({
    requestedAt: true,
    requestStatus: true,
    reviewedAt: true,
    reviewedByUserId: true,
    accessStatus: true,
    accessChangedAt: true,
    accessChangedByUserId: true,
    terminatedAt: true,
    terminatedByUserId: true,
  });

export type StocksenseAdminAccountRow = typeof stocksenseAdminAccounts.$inferSelect;
export type InsertStocksenseAdminAccount = typeof stocksenseAdminAccounts.$inferInsert;