import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./workspace-access-policy.ts', import.meta.url), 'utf8');
const compiled = stripTypeScriptTypes(source);
const { getWorkspaceAccessRedirect } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`,
);

const access = (overrides = {}) => ({
  role: 'profile',
  deliveryRole: 'support_staff',
  phone: null,
  accountDeleted: false,
  adminStatus: undefined,
  supportStatus: 'approved',
  ...overrides,
});

test('approved support staff can open their account profile without an owner or courier phone profile', () => {
  assert.equal(getWorkspaceAccessRedirect(access()), null);
});

test('support staff remain blocked from owner workspace routes', () => {
  assert.equal(
    getWorkspaceAccessRedirect(access({ role: 'owner', adminStatus: 'active' })),
    '/onboarding',
  );
});

test('paused support staff do not use the profile exception', () => {
  assert.equal(
    getWorkspaceAccessRedirect(access({ supportStatus: 'paused' })),
    '/customer-service/staff',
  );
  assert.equal(
    getWorkspaceAccessRedirect(access({ supportStatus: 'paused', adminStatus: 'active' })),
    '/customer-service/staff',
  );
});

test('support staff without approval do not use the profile exception', () => {
  assert.equal(
    getWorkspaceAccessRedirect(access({ supportStatus: 'pending', adminStatus: 'active' })),
    '/onboarding',
  );
  assert.equal(
    getWorkspaceAccessRedirect(access({ supportStatus: 'denied', adminStatus: 'active' })),
    '/onboarding',
  );
});

test('deleted accounts cannot use the support profile exception', () => {
  assert.equal(
    getWorkspaceAccessRedirect(access({ accountDeleted: true })),
    '/account-deleted',
  );
});

test('owner and courier profiles remain available with valid workspace profiles', () => {
  assert.equal(
    getWorkspaceAccessRedirect(access({
      deliveryRole: 'owner',
      phone: '1234567890',
      adminStatus: 'active',
    })),
    null,
  );
  assert.equal(
    getWorkspaceAccessRedirect(access({
      deliveryRole: 'courier',
      phone: '1234567890',
      adminStatus: 'active',
    })),
    null,
  );
});

test('owner and courier workspace mismatches retain their existing redirects', () => {
  assert.equal(
    getWorkspaceAccessRedirect(access({
      role: 'owner',
      deliveryRole: 'courier',
      phone: '1234567890',
      adminStatus: 'active',
    })),
    '/courier/deliveries',
  );
  assert.equal(
    getWorkspaceAccessRedirect(access({
      role: 'courier',
      deliveryRole: 'owner',
      phone: '1234567890',
      adminStatus: 'active',
    })),
    '/dashboard',
  );
});
