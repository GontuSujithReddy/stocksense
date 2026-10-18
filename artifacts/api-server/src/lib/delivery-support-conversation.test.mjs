import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('./delivery-support-conversation.ts', import.meta.url), 'utf8');
const { buildSupportConversation } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`
);
const resolutionSource = await readFile(new URL('./delivery-support-resolution.ts', import.meta.url), 'utf8');
const { resolutionAttributionForUpdate } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(resolutionSource)).toString('base64')}`
);
const ticket = {
  id: 71,
  ownerId: 'owner-71',
  message: 'The first customer message.',
  resolution: '',
  createdAt: new Date('2026-10-02T10:00:00.000Z'),
};
const stored = (id, senderRole, message, createdAt, isLegacy = false, senderId = 'private-user-id') =>
  ({ id, ticketId: 71, senderRole, senderId, message, createdAt: createdAt ? new Date(createdAt) : null, isLegacy });

test('the ticket opener and later customer/staff replies form a chronological conversation', () => {
  const conversation = buildSupportConversation(ticket, [
    stored(4, 'customer', 'Thanks, this is still happening.', '2026-10-02T10:04:00Z'),
    stored(2, 'staff', 'Try refreshing the app.', '2026-10-02T10:02:00Z'),
    stored(3, 'staff', 'Can you confirm the product SKU?', '2026-10-02T10:03:00Z'),
  ]);
  assert.deepEqual(conversation.map(item => [item.sender, item.message]), [
    ['customer', 'The first customer message.'],
    ['staff', 'Try refreshing the app.'],
    ['staff', 'Can you confirm the product SKU?'],
    ['customer', 'Thanks, this is still happening.'],
  ]);
  assert.deepEqual(conversation.map(item => item.id), [0, 2, 3, 4]);
});

test('legacy replies remain visible without fabricating a timestamp or leaking sender ids', () => {
  const conversation = buildSupportConversation(
    { ...ticket, resolution: 'The original support reply.' },
    [stored(7, 'customer', 'I still need help.', '2026-10-02T10:05:00Z')],
  );
  assert.deepEqual(conversation.map(item => item.message), [
    'The first customer message.',
    'The original support reply.',
    'I still need help.',
  ]);
  assert.equal(conversation[1].createdAt, null);
  assert.equal('senderId' in conversation[1], false);
  assert.equal('senderId' in conversation[2], false);
});

test('archived historical replies and repeated new replies are not dropped', () => {
  const conversation = buildSupportConversation(
    { ...ticket, resolution: 'Thanks for the update.' },
    [
      stored(8, 'staff', 'Thanks for the update.', '2026-10-02T10:09:00Z'),
      stored(5, 'staff', 'The earlier answer.', null, true, null),
      stored(9, 'staff', 'Thanks for the update.', '2026-10-02T10:10:00Z'),
    ],
  );
  assert.deepEqual(conversation.map(item => item.message), [
    'The first customer message.',
    'The earlier answer.',
    'Thanks for the update.',
    'Thanks for the update.',
  ]);
  assert.equal(conversation[1].createdAt, null);
});

test('tickets without a previous support reply contain only the opener and stored messages', () => {
  const conversation = buildSupportConversation(ticket, [
    stored(2, 'customer', 'A customer clarification.', '2026-10-02T10:01:00Z'),
  ]);
  assert.equal(conversation.length, 2);
  assert.equal(conversation[1].message, 'A customer clarification.');
});

test('closing an open ticket records the authenticated resolver and time', () => {
  const closedAt = new Date('2026-10-02T11:15:00.000Z');
  assert.deepEqual(resolutionAttributionForUpdate({
    status: 'open', resolvedByUserId: null, resolvedByName: null, resolvedAt: null,
  }, 'closed', 'staff-1', 'Alex Support', closedAt), {
    resolvedByUserId: 'staff-1',
    resolvedByName: 'Alex Support',
    resolvedAt: closedAt,
  });
});

test('editing an already closed ticket does not reassign who resolved it', () => {
  const originalAt = new Date('2026-10-02T11:00:00.000Z');
  const laterEdit = new Date('2026-10-02T11:15:00.000Z');
  assert.deepEqual(resolutionAttributionForUpdate({
    status: 'closed', resolvedByUserId: 'staff-1', resolvedByName: 'Alex Support', resolvedAt: originalAt,
  }, 'closed', 'staff-2', 'Sam Support', laterEdit), {
    resolvedByUserId: 'staff-1',
    resolvedByName: 'Alex Support',
    resolvedAt: originalAt,
  });
});

test('reopening clears old resolver details so a later close records the new resolver', () => {
  assert.deepEqual(resolutionAttributionForUpdate({
    status: 'closed',
    resolvedByUserId: 'staff-1',
    resolvedByName: 'Alex Support',
    resolvedAt: new Date('2026-10-02T11:00:00.000Z'),
  }, 'open', 'staff-2', 'Sam Support', new Date('2026-10-02T11:15:00.000Z')), {
    resolvedByUserId: null,
    resolvedByName: null,
    resolvedAt: null,
  });
});

test('a pre-feature closed ticket does not gain a false resolver when edited', () => {
  assert.deepEqual(resolutionAttributionForUpdate({
    status: 'closed', resolvedByUserId: null, resolvedByName: null, resolvedAt: null,
  }, 'closed', 'staff-2', 'Sam Support', new Date('2026-10-02T11:15:00.000Z')), {
    resolvedByUserId: null,
    resolvedByName: null,
    resolvedAt: null,
  });
});