import assert from 'node:assert/strict';
import { constants, promises as fs } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';
import { OpenAiProvider } from './openai-provider.ts';
import { AiProviderFailure, validateAiResult, validateAiTask } from './provider.ts';
import { AiCredentialVault } from './credential-vault.ts';

const task = {
  operation: 'extract' as const,
  purpose: 'source_summary',
  input: 'Synthetic source text',
  modelTier: 'routine' as const,
  sources: [{ url: 'https://example.invalid/source', observedAt: '2026-09-08T10:00:00.000Z', uncertainty: 'medium' as const }]
};

test('provider-neutral task and result contracts are strict and preserve evidence', async () => {
  assert.deepEqual(validateAiTask(task), task);
  assert.throws(() => validateAiTask({ ...task, provider: 'openai' }));
  assert.throws(() => validateAiTask({ ...task, model: 'a-concrete-model' }));
  assert.throws(() => validateAiResult({ output: 'x', generatedAt: new Date().toISOString(), uncertainty: 'low', sources: [], unexpected: true }));

  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const provider = new OpenAiProvider(async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic normalized result' }] }],
      usage: { input_tokens: 12, output_tokens: 4 }
    }), { status: 200 });
  });
  const result = await provider.execute(task, { provider: 'openai', model: 'configured-routine', apiKey: 'synthetic-api-key-for-tests' });
  assert.equal(seenUrl, 'https://api.openai.com/v1/responses');
  assert.equal((seenInit?.headers as Record<string, string>).authorization, 'Bearer synthetic-api-key-for-tests');
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    model: 'configured-routine', input: task.input, max_output_tokens: 64, store: false
  });
  assert.equal(result.output, 'Synthetic normalized result');
  assert.deepEqual(result.sources, task.sources);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
});

test('OpenAI adapter rejects incomplete, refusal and upstream responses with normalized failures', async () => {
  const cases: Array<{ response: Response; code: string; usage?: unknown }> = [
    { response: new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 3, output_tokens: 64 } }), { status: 200 }), code: 'AI_RESPONSE_INVALID', usage: { inputTokens: 3, outputTokens: 64 } },
    { response: new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'not returned' }] }] }), { status: 200 }), code: 'AI_RESPONSE_INVALID' },
    { response: new Response(JSON.stringify({ error: { message: 'must never escape' }, usage: { input_tokens: 2 } }), { status: 429 }), code: 'AI_UPSTREAM_ERROR', usage: { inputTokens: 2 } }
  ];
  for (const item of cases) {
    const provider = new OpenAiProvider(async () => item.response);
    await assert.rejects(
      provider.execute(task, { provider: 'openai', model: 'configured-routine', apiKey: 'synthetic-api-key-for-tests' }),
      (error: unknown) => error instanceof AiProviderFailure && error.code === item.code && assert.deepEqual(error.usage, item.usage) === undefined
    );
  }
});

test('OpenAI adapter bounds stalled response bodies and rejects non-object JSON', async () => {
  const stalled = new OpenAiProvider(async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
    }
  })), 20);
  await assert.rejects(
    stalled.execute(task, { provider: 'openai', model: 'configured-routine', apiKey: 'synthetic-api-key-for-tests' }),
    (error: unknown) => error instanceof AiProviderFailure && error.code === 'AI_TIMEOUT'
  );
  const nonObject = new OpenAiProvider(async () => new Response('null', { status: 200 }));
  await assert.rejects(
    nonObject.execute(task, { provider: 'openai', model: 'configured-routine', apiKey: 'synthetic-api-key-for-tests' }),
    (error: unknown) => error instanceof AiProviderFailure && error.code === 'AI_RESPONSE_INVALID'
  );
});

test('credential vault encrypts at rest, binds ciphertext to household and creates a private persistent key', async () => {
  const keyFile = resolve(process.cwd(), '.local/m21-provider-test/master-key');
  await fs.rm(resolve(process.cwd(), '.local/m21-provider-test'), { recursive: true, force: true });
  try {
    const vault = new AiCredentialVault(keyFile);
    const ciphertext = await vault.encrypt('11111111-1111-4111-8111-111111111111', 'synthetic-secret-value');
    assert.equal(ciphertext.includes('synthetic-secret-value'), false);
    assert.equal(await vault.decrypt('11111111-1111-4111-8111-111111111111', ciphertext), 'synthetic-secret-value');
    await assert.rejects(vault.decrypt('22222222-2222-4222-8222-222222222222', ciphertext));
    const mode = (await fs.stat(keyFile)).mode & 0o777;
    assert.equal(mode, 0o600);
    await fs.access(keyFile, constants.R_OK | constants.W_OK);
    const restarted = new AiCredentialVault(keyFile);
    assert.equal(await restarted.decrypt('11111111-1111-4111-8111-111111111111', ciphertext), 'synthetic-secret-value');
  } finally {
    await fs.rm(resolve(process.cwd(), '.local/m21-provider-test'), { recursive: true, force: true });
  }
});
