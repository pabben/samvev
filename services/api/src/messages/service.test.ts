import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '@samvev/core';
import type { Capability } from '@samvev/contracts';
import type { DbClient } from '../db.ts';
import { MessageService, validateMessageAudience } from './service.ts';

const actor = {
  accountId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  householdId: '33333333-3333-4333-8333-333333333333',
  membershipId: '44444444-4444-4444-8444-444444444444',
  mcpGrantId: '55555555-5555-4555-8555-555555555555'
};
const displayId = '66666666-6666-4666-8666-666666666666';

function displayClient(options: { memberGrant: boolean }) {
  const calls: string[] = [];
  const client = { async query(sql: string) {
    calls.push(sql);
    if (sql.includes('FROM displays')) return { rows: [{ id: displayId }], rowCount: 1 };
    if (sql.includes('FROM mcp_oauth_grant_displays')) return { rows: [{ display_id: displayId }], rowCount: 1 };
    if (sql.includes('FROM membership_display_grants')) return options.memberGrant
      ? { rows: [{ display_id: displayId }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
    throw new Error('Unexpected display authorization query');
  } } as unknown as DbClient;
  return { client, calls };
}

test('MCP display consent does not bypass the delegated member display grant', async () => {
  const fake = displayClient({ memberGrant: false });
  await assert.rejects(
    validateMessageAudience(fake.client, actor, ['message.publish.display'], [], [displayId]),
    (error: unknown) => error instanceof DomainError && error.status === 403
  );
  assert.equal(fake.calls.length, 3);
  assert.match(fake.calls[1]!, /mcp_oauth_grant_displays/);
  assert.match(fake.calls[2]!, /membership_display_grants/);
});

test('MCP display recipient requires both OAuth consent and member permission', async () => {
  const fake = displayClient({ memberGrant: true });
  await validateMessageAudience(fake.client, actor, ['message.publish.display'], [], [displayId]);
  assert.equal(fake.calls.length, 3);
});

test('MCP household broadcast is denied until an explicit broad-audience grant exists', async () => {
  let serviceQueries = 0;
  const service = new MessageService(async (run) => run({ async query() {
    serviceQueries += 1;
    throw new Error('audience denial must happen before persistence');
  } } as unknown as DbClient));
  const input = {
    body: 'Synthetic broad audience request', importance: 'normal',
    audience: { household: true, personIds: [], displayIds: [] },
    expiresAt: '2099-01-01T00:00:00.000Z', idempotencyKey: 'mcp-broadcast-0001'
  };
  await assert.rejects(
    service.create(actor, input, async () => ['message.create.household'] as Capability[]),
    (error: unknown) => error instanceof DomainError && error.status === 403 && error.details?.reason === 'mcp_message_household_audience_not_granted'
  );
  assert.equal(serviceQueries, 0);
});

test('withdrawal by another member requires current message management capability', async () => {
  const queries: string[] = [];
  const recipientId = '88888888-8888-4888-8888-888888888888';
  const service = new MessageService(async (run) => run({ async query(sql: string) {
    queries.push(sql);
    if (sql.includes('FROM messages WHERE')) return { rows: [{ id: 'message-1', author_membership_id: 'different-membership', state: 'published', audience_household: false }], rowCount: 1 };
    if (sql.includes('FROM message_person_audiences audience')) return { rows: [{ person_id: recipientId }], rowCount: 1 };
    if (sql.includes('FROM message_display_targets target')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM persons')) return { rows: [{ id: recipientId }], rowCount: 1 };
    if (sql.includes('FROM mcp_oauth_grant_people')) return { rows: [{ person_id: recipientId }], rowCount: 1 };
    throw new Error(`Unexpected query during withdrawal authorization: ${sql}`);
  } } as unknown as DbClient));
  await assert.rejects(
    service.withdraw(actor, '77777777-7777-4777-8777-777777777777', 1, async () => ['household.view'] as Capability[]),
    (error: unknown) => error instanceof DomainError && error.status === 403
  );
  assert.equal(queries.length, 5, 'after confirming exact recipient visibility, member authorization stops before mutation');
  assert.doesNotMatch(queries[queries.length - 1]!, /UPDATE messages/);
});
