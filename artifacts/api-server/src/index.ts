import app from "./app";
import { logger } from "./lib/logger";
import { startDeliveryConfirmationPolling } from "./lib/delivery-polling";
import { seedExistingInventoryWorkspaces } from "./lib/inventory-workspace";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startDeliveryConfirmationPolling();
  void seedExistingInventoryWorkspaces().then((result) => {
    logger.info(result, "Existing inventory workspaces checked for demo data");
    if (result.failed > 0) {
      logger.error({ failed: result.failed }, "Some inventory workspaces could not be seeded");
    }
  }).catch((err: unknown) => {
    logger.error({ err }, "Could not check existing inventory workspaces for demo data");
  });
});
