import { Router, type IRouter } from "express";
import { requireDeliveryUser } from "../lib/delivery-access";
import profileRouter from "./delivery-profile";
import trackingRouter from "./delivery-tracking";
import settingsRouter from "./delivery-settings";
import supportStaffRouter from "./delivery-support-staff";
import supportStaffMembersRouter from "./delivery-support-staff-members";

const router: IRouter = Router();
router.use(requireDeliveryUser);
router.use(profileRouter);
router.use("/support/staff", supportStaffRouter);
router.use("/support/staff-members", supportStaffMembersRouter);
router.use(trackingRouter);
router.use(settingsRouter);
export default router;