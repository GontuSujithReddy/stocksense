import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import express from "express";

const bundlePath = new URL("./.inventory-access.test-bundle.mjs", import.meta.url);
await build({
  stdin: {
    contents: 'export { default as courierRouter } from "./routes/courier"; export { requireInventoryAuth } from "./middlewares/inventory-auth";',
    resolveDir: new URL("../", import.meta.url).pathname,
  },
  outfile: bundlePath.pathname, bundle: true, platform: "node", format: "esm",
  packages: "external",
  plugins: [{
    name: "isolated-access-dependencies",
    setup(b) {
      b.onResolve({ filter: /^(?:@clerk\/express|@workspace\/db|@workspace\/api-zod)$|delivery-access$|inventory-workspace$/ }, args => ({ path: args.path, namespace: "access-mock" }));
      b.onLoad({ filter: /.*/, namespace: "access-mock" }, ({ path }) => {
        if (path === "@clerk/express") return { contents: "export const getAuth = req => ({ userId: req.headers['x-test-user'] ?? null });" };
        if (path.endsWith("delivery-access")) return { contents: "export const deliveryRole = async id => id === 'owner' ? 'owner' : id === 'courier' ? 'courier' : id === 'staff' ? 'support_staff' : null;" };
        if (path.endsWith("inventory-workspace")) return { contents: "export const ensureInventoryWorkspace = async () => {};" };
        if (path === "@workspace/api-zod") return { contents: "export const ListCourierDeliveriesResponse = { parse: x => x }; export const GetCourierDeliveryResponse = ListCourierDeliveriesResponse; export const GetCourierDeliveryParams = {safeParse: x => ({success:true,data:{id:Number(x.id)}})}; export const ListCourierDeliveryMessagesParams = GetCourierDeliveryParams; export const ListCourierDeliveryMessagesResponse = ListCourierDeliveriesResponse; export const SendCourierDeliveryMessageParams = GetCourierDeliveryParams; export const SendCourierDeliveryMessageBody = {safeParse: x => ({success:true,data:x})}; export const SendCourierDeliveryMessageResponse = ListCourierDeliveriesResponse;" };
        return { contents: "export const operations = {courierUserId:'courier',type:'type',id:'id'}; export const deliveryConfirmations = {operationId:'operationId',emailOtpSentAt:'emailOtpSentAt',emailOtpExpiresAt:'emailOtpExpiresAt'}; export const deliveryProfiles = {}; export const inventoryWorkspaces = {ownerId:'ownerId',deletedAt:'deletedAt'}; export const stocksenseAdminAccounts = {userId:'userId',requestStatus:'requestStatus',accessStatus:'accessStatus'}; export const deliveryChatMessages = {operationId:'operationId',createdAt:'createdAt',id:'id'}; export const deliveryChatTokens = {}; export const db = {select: () => ({from: () => ({where: () => Object.assign(Promise.resolve([]), {limit: async () => []})})})};" };
      });
    },
  }],
});
after(() => rm(bundlePath, { force: true }));
const { courierRouter, requireInventoryAuth } = await import(bundlePath.href);
const app = express();
// Mirrors the real router order: courier routes precede the inventory guard.
const router = express.Router();
router.use(courierRouter);
router.use(requireInventoryAuth);
router.get("/moves", (_req, res) => res.json({ ownerId: res.locals.ownerId }));
router.post("/operations/1/delivery/start", (_req, res) => res.json({ forwarded: true }));
app.use("/api", router);
app.use("/stocksense-delivery/api", router);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
after(() => new Promise(resolve => server.close(resolve)));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (path, user, method = "GET") => fetch(base + path, { method, headers: user ? { "x-test-user": user } : {} });

test("public storefront routes are mounted before pathless authentication guards", async () => {
  const routes = await readFile(new URL("../routes/index.ts", import.meta.url), "utf8");
  const storefrontMount = routes.indexOf("router.use(publicStorefrontRouter);");
  const firstPathlessAuthMount = Math.min(
    routes.indexOf("router.use(stocksenseAdminRouter);"),
    routes.indexOf("router.use(stocksenseSupportRouter);"),
  );
  assert.ok(storefrontMount >= 0, "public storefront router is mounted");
  assert.ok(firstPathlessAuthMount >= 0, "pathless authenticated routers are mounted");
  assert.ok(storefrontMount < firstPathlessAuthMount, "storefront routes must bypass delivery authentication");
});

for (const prefix of ["/api", "/stocksense-delivery/api"]) {
  test(`${prefix}: owner and unregistered inventory account reach inventory, not courier guard`, async () => {
    for (const user of ["owner", "new-owner"]) {
      const response = await call(`${prefix}/moves`, user);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ownerId: user });
    }
  });
  test(`${prefix}: inventory denies unauthenticated, courier, and staff accounts`, async () => {
    assert.equal((await call(`${prefix}/moves`)).status, 401);
    for (const user of ["courier", "staff"]) assert.equal((await call(`${prefix}/moves`, user)).status, 403);
  });
  test(`${prefix}: courier list denies owners and staff, but empty courier list succeeds`, async () => {
    for (const user of ["owner", "staff", "new-owner"]) assert.equal((await call(`${prefix}/courier/deliveries`, user)).status, 403);
    assert.equal((await call(`${prefix}/courier/deliveries`)).status, 401);
    const response = await call(`${prefix}/courier/deliveries`, "courier");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
  test(`${prefix}: courier delivery action still reaches its existing assignment-aware handler`, async () => {
    assert.equal((await call(`${prefix}/operations/1/delivery/start`, "courier", "POST")).status, 200);
  });
}