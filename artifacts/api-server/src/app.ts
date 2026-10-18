import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { InventoryError } from "./lib/inventory-error";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
app.use("/stocksense-delivery/api", router);

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof InventoryError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const code = typeof error === "object" && error !== null
    ? ("code" in error ? error.code : "cause" in error && typeof error.cause === "object" && error.cause !== null && "code" in error.cause ? error.cause.code : undefined)
    : undefined;
  const databaseError = typeof error === "object" && error !== null && "cause" in error && typeof error.cause === "object" && error.cause !== null
    ? error.cause : error;
  const constraint = typeof databaseError === "object" && databaseError !== null && "constraint" in databaseError
    ? databaseError.constraint : undefined;
  if (code === "23505") {
    res.status(409).json({ error: constraint === "inventory_workspaces_storefront_slug"
      ? "That storefront URL is already in use. Choose another."
      : constraint === "inventory_products_owner_active_sku" || constraint === "inventory_products_owner_sku"
      ? "A product with that SKU already exists in your inventory."
      : "A record with these details already exists in your inventory." });
    return;
  }
  if (code === "23503") {
    res.status(409).json({ error: "The selected category or location no longer exists. Refresh and try again." });
    return;
  }
  req.log.error({ err: error }, "Inventory API error");
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;
