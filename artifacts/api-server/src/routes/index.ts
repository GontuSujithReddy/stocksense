import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { requireInventoryAuth } from "../middlewares/inventory-auth";
import catalogRouter from "./catalog";
import facilitiesRouter from "./facilities";
import operationsRouter from "./operations";
import overviewRouter from "./overview";
import courierRouter from "./courier";
import deliveryAppRouter from "./delivery-app";
import deliveryCustomerChatRouter from "./delivery-customer-chat";
import stocksenseSupportRouter from "./stocksense-support";
import memoryRouter, { requireMemoryAuth } from "./memory";
import stocksenseAccountRouter from "./stocksense-account";
import stocksenseAdminRouter from "./stocksense-admin";
import { publicStorefrontRouter, storefrontSettingsRouter } from "./storefront";
import { publicStorefrontAssetRouter, publicStorageObjectsRouter } from "./storefront-assets";
import { storefrontBuilderRouter } from "./storefront-builder";

const router: IRouter = Router();

router.use(healthRouter);
// Public catalog and order routes must bypass the pathless authenticated routers below.
router.use(publicStorefrontRouter);
router.use(publicStorefrontAssetRouter);
router.use(publicStorageObjectsRouter);
router.use(deliveryCustomerChatRouter);
router.use("/memory", requireMemoryAuth, memoryRouter);
router.use(stocksenseAccountRouter);
router.use(stocksenseAdminRouter);
router.use(stocksenseSupportRouter);
router.use("/delivery-app", deliveryAppRouter);
router.use(courierRouter);
router.use(requireInventoryAuth);
router.use(storefrontBuilderRouter);
router.use(catalogRouter);
router.use(facilitiesRouter);
router.use(operationsRouter);
router.use(overviewRouter);
router.use(storefrontSettingsRouter);

export default router;
