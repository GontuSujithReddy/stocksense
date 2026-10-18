import type { RequestHandler } from "express";

export function parseUserIdAllowlist(value?: string): string[] {
  return value?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
}

export function createDeliverySupportAuth(dependencies: {
  isAdministrator: (userId: string) => boolean;
  hasStaffMembership: (userId: string) => Promise<boolean>;
}) {
  const isStaff = async (userId: string): Promise<boolean> =>
    dependencies.isAdministrator(userId) || await dependencies.hasStaffMembership(userId);

  const requireStaff: RequestHandler = async (_req, res, next) => {
    try {
      if (!await isStaff(res.locals.deliveryUserId as string)) {
        res.status(403).json({ error: "This action is limited to authorized support staff." });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireAdministrator: RequestHandler = (_req, res, next) => {
    if (!dependencies.isAdministrator(res.locals.deliveryUserId as string)) {
      res.status(403).json({ error: "This action is limited to authorized support administrators." });
      return;
    }
    next();
  };

  return { isStaff, requireStaff, requireAdministrator };
}