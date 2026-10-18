import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { operations } from "./movements";

export const deliveryConfirmations = pgTable("delivery_app_confirmations", {
  operationId: integer("operation_id").primaryKey().references(() => operations.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  customerPhone: text("customer_phone").notNull().default(""),
  deliveryAddress: text("delivery_address").notNull().default(""),
  approval: text("approval").notNull().default("pending"),
  callId: text("call_id"),
  agentId: text("agent_id"),
  callStatus: text("call_status"),
  callError: text("call_error"),
  callAttemptCount: integer("call_attempt_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  emailOtpHash: text("email_otp_hash"),
  emailOtpExpiresAt: timestamp("email_otp_expires_at", { withTimezone: true }),
  emailOtpSentAt: timestamp("email_otp_sent_at", { withTimezone: true }),
  emailOtpLastAttemptAt: timestamp("email_otp_last_attempt_at", { withTimezone: true }),
  emailOtpVerifiedAt: timestamp("email_otp_verified_at", { withTimezone: true }),
  emailOtpAttemptCount: integer("email_otp_attempt_count").notNull().default(0),
  emailOtpSendCount: integer("email_otp_send_count").notNull().default(0),
});
export const insertDeliveryConfirmationSchema = createInsertSchema(deliveryConfirmations);
export type DeliveryConfirmationRow = typeof deliveryConfirmations.$inferSelect;