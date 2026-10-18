// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./catalog";
export * from "./facilities";
export * from "./movements";
export * from "./delivery-profiles";
export * from "./delivery-confirmations";
export * from "./delivery-chat";
export * from "./delivery-voice";
export * from "./delivery-support";
export * from "./delivery-support-messages";
export * from "./stocksense-support-profiles";
export * from "./stocksense-support-access-requests";
export * from "./stocksense-admin-accounts";