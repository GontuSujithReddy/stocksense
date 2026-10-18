import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, deliverySupportStaffMembers } from "@workspace/db";
import {
  AddDeliverySupportStaffMemberBody,
  AddDeliverySupportStaffMemberResponse,
  ListDeliverySupportStaffMembersResponse,
  RemoveDeliverySupportStaffMemberParams,
} from "@workspace/api-zod";
import { isDeliverySupportAdmin, requireDeliverySupportAdmin } from "../lib/delivery-access";
import { InventoryError } from "../lib/inventory-error";

const router: IRouter = Router();
router.use(requireDeliverySupportAdmin);

router.get("/", async (_req, res): Promise<void> => {
  const members = await db.select().from(deliverySupportStaffMembers).orderBy(desc(deliverySupportStaffMembers.createdAt));
  res.json(ListDeliverySupportStaffMembersResponse.parse(members));
});

router.post("/", async (req, res): Promise<void> => {
  const parsed = AddDeliverySupportStaffMemberBody.safeParse(req.body);
  if (!parsed.success) throw new InventoryError("Enter a valid account ID.");

  const userId = parsed.data.userId.trim();
  if (!userId) throw new InventoryError("Enter a valid account ID.");
  if (isDeliverySupportAdmin(userId)) {
    throw new InventoryError("Administrators already have support access and do not need a staff membership.", 409);
  }
  const { data: users } = await clerkClient.users.getUserList({ userId: [userId], limit: 1 });
  if (!users.some(user => user.id === userId)) throw new InventoryError("No account was found with that ID.", 404);

  const [member] = await db.insert(deliverySupportStaffMembers).values({
    userId,
    addedBy: res.locals.deliveryUserId as string,
  }).onConflictDoNothing().returning();
  if (!member) throw new InventoryError("That account already has support access.", 409);
  res.status(201).json(AddDeliverySupportStaffMemberResponse.parse(member));
});

router.delete("/:userId", async (req, res): Promise<void> => {
  const params = RemoveDeliverySupportStaffMemberParams.safeParse(req.params);
  if (!params.success) throw new InventoryError("Enter a valid account ID.");
  if (isDeliverySupportAdmin(params.data.userId)) {
    throw new InventoryError("Administrator access is controlled separately and cannot be removed here.", 409);
  }
  const [removed] = await db.delete(deliverySupportStaffMembers)
    .where(eq(deliverySupportStaffMembers.userId, params.data.userId))
    .returning({ userId: deliverySupportStaffMembers.userId });
  if (!removed) throw new InventoryError("Support staff account not found.", 404);
  res.sendStatus(204);
});

export default router;