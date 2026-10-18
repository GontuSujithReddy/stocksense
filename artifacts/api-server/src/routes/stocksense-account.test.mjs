import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import express from "express";

const bundlePath = new URL("./.stocksense-account.test-bundle.mjs", import.meta.url);
await build({
  entryPoints: [new URL("./stocksense-account.ts", import.meta.url).pathname],
  outfile: bundlePath.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [{
    name: "isolated-account-deletion-dependencies",
    setup(b) {
      b.onResolve({
        filter: /^@clerk\/express$|^@vectorize-io\/hindsight-client$|^@workspace\/api-zod$|^@workspace\/db$|^drizzle-orm$|delivery-access$|stocksense-account-deletion$|stocksense-account-storage$|stocksense-memory$/,
      }, args => ({ path: args.path, namespace: "account-deletion-mock" }));
      b.onLoad({ filter: /.*/, namespace: "account-deletion-mock" }, ({ path }) => {
        if (path === "@clerk/express") return { contents: `
          const fixture = () => globalThis.__stocksenseAccountDeletionFixture;
          export const getAuth = req => ({ userId: req.headers["x-test-user"] ?? null });
          export const clerkClient = { users: {
            getUser: async () => {
              fixture().calls.push("admin-check");
              return { emailAddresses: [{
                emailAddress: fixture().mainAdmin ? "admin@example.test" : "owner@example.test",
                verification: { status: "verified" },
              }] };
            },
            deleteUser: async () => {
              fixture().calls.push("clerk");
              if (fixture().clerkFailure) throw Object.assign(new Error("fixture Clerk failure"), { status: 500 });
            },
          } };
        ` };
        if (path === "@vectorize-io/hindsight-client") return { contents: `
          const fixture = () => globalThis.__stocksenseAccountDeletionFixture;
          export class HindsightError extends Error {
            constructor(message, statusCode, details) { super(message); this.statusCode = statusCode; this.details = details; }
          }
          export const createClient = config => config;
          export const createConfig = config => config;
          export const sdk = { deleteBank: async () => {
            fixture().calls.push("memory");
            if (fixture().memoryFailure) throw new HindsightError(
              "fixture Hindsight failure",
              fixture().memoryFailureStatus ?? 500,
              {},
            );
            return { error: null, response: { status: 204 } };
          } };
        ` };
        if (path === "@workspace/api-zod") return { contents: `
          export const GetStocksenseAccountStatusResponse = { parse: value => value };
        ` };
        if (path === "@workspace/db") return { contents: `
          const fixture = () => globalThis.__stocksenseAccountDeletionFixture;
          export const inventoryWorkspaces = { ownerId: "ownerId", deletedAt: "deletedAt" };
          export const db = { select: () => ({ from: () => ({ where: () => ({
            limit: async () => fixture().workspaceDeleted ? [{ deletedAt: new Date(0) }] : [],
          }) }) }) };
        ` };
        if (path === "drizzle-orm") return { contents: "export const eq = (column, value) => ({ column, value });" };
        if (path.endsWith("delivery-access")) return { contents: `
          export const deliveryRole = async () => globalThis.__stocksenseAccountDeletionFixture.role;
        ` };
        if (path.endsWith("stocksense-account-deletion")) return { contents: `
          export const deleteStocksenseAccountData = async () => {
            const fixture = globalThis.__stocksenseAccountDeletionFixture;
            fixture.calls.push("database");
            if (fixture.databaseFailure) throw new Error("fixture database failure");
            fixture.workspaceDeleted = true;
          };
        ` };
        if (path.endsWith("stocksense-account-storage")) return { contents: `
          export const deleteUnusedStocksenseAccountAssets = async () => {
            const fixture = globalThis.__stocksenseAccountDeletionFixture;
            fixture.calls.push("storage");
            if (fixture.storageFailure) throw new Error("fixture storage failure");
          };
        ` };
        return { contents: "export const stocksenseMemoryBankId = ownerId => 'fixture-' + ownerId;" };
      });
    },
  }],
});
after(() => rm(bundlePath, { force: true }));

process.env.HINDSIGHT_URL = "https://hindsight.unit.test";
process.env.HINDSIGHT_API_KEY = "fixture-token";
process.env.STOCKSENSE_MAIN_ADMIN_EMAIL = "admin@example.test";
after(() => {
  delete process.env.HINDSIGHT_URL;
  delete process.env.HINDSIGHT_API_KEY;
  delete process.env.STOCKSENSE_MAIN_ADMIN_EMAIL;
  delete globalThis.__stocksenseAccountDeletionFixture;
});

const { default: accountRouter } = await import(bundlePath.href);
const app = express();
app.use((req, _res, next) => {
  req.log = { error: () => {} };
  next();
});
app.use(accountRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
after(() => new Promise(resolve => server.close(resolve)));

const resetFixture = (overrides = {}) => {
  const fixture = {
    calls: [],
    role: "owner",
    mainAdmin: false,
    memoryFailure: false,
    memoryFailureStatus: 500,
    databaseFailure: false,
    storageFailure: false,
    clerkFailure: false,
    workspaceDeleted: false,
    ...overrides,
  };
  globalThis.__stocksenseAccountDeletionFixture = fixture;
  return fixture;
};
const removeAccount = (userId = "owner-1") => fetch(
  `http://127.0.0.1:${server.address().port}/stocksense/account`,
  { method: "DELETE", headers: userId ? { "x-test-user": userId } : {} },
);

test("a storage or Clerk failure can be retried without deleting memory twice", async () => {
  const fixture = resetFixture({ storageFailure: true });
  const first = await removeAccount();
  assert.equal(first.status, 502);
  assert.deepEqual(fixture.calls, ["admin-check", "memory", "database", "storage"]);
  assert.equal(fixture.workspaceDeleted, true);

  fixture.calls.length = 0;
  fixture.storageFailure = false;
  fixture.clerkFailure = true;
  const second = await removeAccount();
  assert.equal(second.status, 502);
  assert.deepEqual(fixture.calls, ["admin-check", "database", "storage", "clerk"]);

  fixture.calls.length = 0;
  fixture.clerkFailure = false;
  const third = await removeAccount();
  assert.equal(third.status, 204);
  assert.deepEqual(fixture.calls, ["admin-check", "database", "storage", "clerk"]);
});

test("a Hindsight failure stops before local data or identity deletion", async () => {
  const fixture = resetFixture({ memoryFailure: true });
  const response = await removeAccount();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /No account data was deleted/);
  assert.deepEqual(fixture.calls, ["admin-check", "memory"]);
  assert.equal(fixture.workspaceDeleted, false);
});

test("a Hindsight authorization failure explains that an administrator must reconnect access", async () => {
  const fixture = resetFixture({ memoryFailure: true, memoryFailureStatus: 401 });
  const response = await removeAccount();
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.match(body.error, /did not authorize deletion/);
  assert.match(body.error, /administrator must reconnect or grant access/);
  assert.match(body.error, /No account data was deleted/);
  assert.deepEqual(fixture.calls, ["admin-check", "memory"]);
  assert.equal(fixture.workspaceDeleted, false);
});

test("the configured main administrator and non-owner accounts cannot delete through this route", async () => {
  const administrator = resetFixture({ mainAdmin: true });
  assert.equal((await removeAccount()).status, 409);
  assert.deepEqual(administrator.calls, ["admin-check"]);
  assert.equal(administrator.workspaceDeleted, false);

  const courier = resetFixture({ role: "courier" });
  assert.equal((await removeAccount()).status, 403);
  assert.deepEqual(courier.calls, []);
  assert.equal(courier.workspaceDeleted, false);
});
