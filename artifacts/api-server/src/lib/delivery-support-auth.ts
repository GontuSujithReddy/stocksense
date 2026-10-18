import { eq } from "drizzle-orm";
import { db, deliverySupportStaffMembers } from "@workspace/db";
import { createDeliverySupportAuth, parseUserIdAllowlist } from "./delivery-support-auth-core";

export function isDeliverySupportAdmin(userId: string): boolean {
  return parseUserIdAllowlist(process.env.DELIVERY_SUPPORT_ADMIN_USER_IDS).includes(userId);
}

const supportAuth = createDeliverySupportAuth({
  isAdministrator: isDeliverySupportAdmin,
  hasStaffMembership: async (userId) => {
    const [member] = await db.select({ userId: deliverySupportStaffMembers.userId })
      .from(deliverySupportStaffMembers)
      .where(eq(deliverySupportStaffMembers.userId, userId))
      .limit(1);
    return Boolean(member);
  },
});

export const isDeliverySupportStaff = supportAuth.isStaff;
export const requireDeliverySupportStaff = supportAuth.requireStaff;
export const requireDeliverySupportAdmin = supportAuth.requireAdministrator;