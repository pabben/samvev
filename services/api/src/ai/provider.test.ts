import assert from 'node:assert/strict';
import { constants, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { resolve } from 'node:path';
import { OpenAiProvider } from './openai-provider.ts';
import {
  isBlockedAiTarget,
  normalizeOpenAiCompatibleBaseUrl,
  OpenAiCompatibleProvider,
  resolveOpenAiCompatibleTarget
} from './openai-compatible-provider.ts';
import { AiProviderFailure, validateAiProviderConfiguration, validateAiResult, validateAiTask } from './provider.ts';
import { AiCredentialVault } from './credential-vault.ts';

const task = {
  operation: 'extract' as const,
  purpose: 'source_summary',
  input: 'Synthetic source text',
  modelTier: 'routine' as const,
  sources: [{ url: 'https://example.invalid/source', observedAt: '2026-09-08T10:00:00.000Z', uncertainty: 'medium' as const }]
};

test('provider configuration requires credentials only when the provider contract does',()=>{
  assert.doesNotThrow(()=>validateAiProviderConfiguration({provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}));
  assert.throws(()=>validateAiProviderConfiguration({provider:'openai',model:'remote'}),(error:unknown)=>error instanceof AiProviderFailure&&error.code==='AI_CONFIGURATION_INVALID');
  assert.doesNotThrow(()=>validateAiProviderConfiguration({provider:'openai',model:'remote',apiKey:'synthetic'}));
});

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
  const result = await provider.execute(task, { provider: 'openai', model: 'configured-routine', apiKey: 'synthetic-api-key-for-tests', reasoningEffort: 'high' });
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

test('OpenAI-compatible adapter supports every operation, optional credentials and Chat Completions usage', async () => {
  const seen: Array<{ url: string; init: RequestInit; target?: { address: string; family: 4 | 6 } }> = [];
  const provider = new OpenAiCompatibleProvider(async (url, init, target) => {
    seen.push({ url, init, target });
    return new Response(JSON.stringify({
      reasoning: { summary: 'extra top-level reasoning is ignored' },
      choices: [{ message: { role: 'assistant', content: 'Synthetic local result', reasoning_content: 'extra reasoning is ignored', refusal: 'extra refusal metadata is ignored when content is valid' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 3 }
    }), { status: 200 });
  }, 1_000, async () => [{ address: '192.168.1.40', family: 4 }]);

  for (const operation of ['generate', 'extract', 'classify', 'plan'] as const) {
    const result = await provider.execute({ ...task, operation }, {
      provider: 'openai_compatible', model: 'local-routine', baseUrl: 'http://local-ai.test:11434/v1'
    });
    assert.equal(result.output, 'Synthetic local result');
    assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 3 });
    assert.deepEqual(result.sources, task.sources);
  }
  assert.equal(seen[0]!.url, 'http://local-ai.test:11434/v1/chat/completions');
  assert.equal(new Headers(seen[0]!.init.headers).has('authorization'), false);
  assert.deepEqual(seen[0]!.target, { address: '192.168.1.40', family: 4 });
  assert.deepEqual(JSON.parse(String(seen[0]!.init.body)), {
    model: 'local-routine',
    messages: [{ role: 'user', content: task.input }],
    max_tokens: 64,
    reasoning_effort: 'none',
    stream: false
  });

  await provider.execute(task, {
    provider: 'openai_compatible', model: 'local-routine', baseUrl: 'http://local-ai.test/v1', apiKey: 'short'
  });
  assert.equal(new Headers(seen.at(-1)!.init.headers).get('authorization'), 'Bearer short');

  await provider.execute(task, {
    provider: 'openai_compatible', model: 'local-routine', baseUrl: 'http://local-ai.test/v1', reasoningEffort: 'high'
  });
  assert.equal(JSON.parse(String(seen.at(-1)!.init.body)).reasoning_effort,'high');
  await provider.testConnection({
    provider:'openai_compatible',model:'local-strong',baseUrl:'http://local-ai.test/v1',reasoningEffort:'high'
  });
  const connectionBody=JSON.parse(String(seen.at(-1)!.init.body));
  assert.equal(connectionBody.model,'local-strong');
  assert.equal(connectionBody.reasoning_effort,'none');
});

test('OpenAI-compatible default transport reaches a mocked local endpoint through the validated pinned address', async () => {
  let seenPath = '';
  let seenBody = '';
  const server = createServer((request, response) => {
    seenPath = request.url ?? '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { seenBody += chunk; });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { content: 'Pinned local response' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 }
      }));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await new OpenAiCompatibleProvider().execute(task, {
      provider: 'openai_compatible', model: 'local-test', baseUrl: `http://127.0.0.1:${address.port}/v1`
    });
    assert.equal(result.output, 'Pinned local response');
    assert.equal(seenPath, '/v1/chat/completions');
    assert.equal(JSON.parse(seenBody).model, 'local-test');
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }

  for (const status of [204, 205, 304]) {
    const emptyServer = createServer((_request, response) => {
      response.writeHead(status);
      response.end();
    });
    await new Promise<void>((resolveListen) => emptyServer.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = emptyServer.address();
      assert.ok(address && typeof address === 'object');
      await assert.rejects(
        new OpenAiCompatibleProvider().execute(task, {
          provider: 'openai_compatible', model: 'local-test', baseUrl: `http://127.0.0.1:${address.port}/v1`
        }),
        (error: unknown) => error instanceof AiProviderFailure &&
          error.code === (status === 304 ? 'AI_UPSTREAM_ERROR' : 'AI_RESPONSE_INVALID')
      );
    } finally {
      await new Promise<void>((resolveClose, reject) => emptyServer.close((error) => error ? reject(error) : resolveClose()));
    }
  }
});

test('OpenAI-compatible endpoint policy permits localhost and LAN while blocking metadata and link-local targets', async () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://192.168.10.8/openai/v1'), 'https://192.168.10.8/openai/v1');
  assert.equal(isBlockedAiTarget('169.254.169.254'), true);
  assert.equal(isBlockedAiTarget('fe80::1'), true);
  assert.equal(isBlockedAiTarget('fd20:ce::254'), true);
  assert.equal(isBlockedAiTarget('::ffff:169.254.169.254'), true);
  assert.equal(isBlockedAiTarget('127.0.0.1'), false);
  assert.equal(isBlockedAiTarget('10.0.0.8'), false);

  for (const blocked of [
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://metadata.goog/computeMetadata/v1',
    'http://[fd20:ce::254]/computeMetadata/v1',
    'http://user:secret@localhost:11434/v1',
    'http://localhost:11434/v1?target=metadata'
  ]) {
    assert.throws(
      () => normalizeOpenAiCompatibleBaseUrl(blocked),
      (error: unknown) => error instanceof AiProviderFailure && error.code === 'AI_ENDPOINT_BLOCKED'
    );
  }
  await assert.rejects(
    resolveOpenAiCompatibleTarget('http://rebind.test/v1', async () => [
      { address: '192.168.1.30', family: 4 },
      { address: '169.254.169.254', family: 4 }
    ]),
    (error: unknown) => error instanceof AiProviderFailure && error.code === 'AI_ENDPOINT_BLOCKED'
  );
});

test('OpenAI-compatible adapter normalizes upstream, malformed and timeout failures', async () => {
  const resolver = async () => [{ address: '127.0.0.1', family: 4 as const }];
  for (const item of [
    { response: new Response(JSON.stringify({ error: { message: 'must never escape' } }), { status: 401 }), code: 'AI_UPSTREAM_ERROR' },
    { response: new Response('{', { status: 503 }), code: 'AI_UPSTREAM_ERROR' },
    { response: new Response(JSON.stringify({ choices: [] }), { status: 200 }), code: 'AI_RESPONSE_INVALID' },
    { response: new Response('{', { status: 200 }), code: 'AI_RESPONSE_INVALID' }
  ]) {
    const provider = new OpenAiCompatibleProvider(async () => item.response, 1_000, resolver);
    await assert.rejects(
      provider.execute(task, { provider: 'openai_compatible', model: 'local', baseUrl: 'http://localhost:11434/v1' }),
      (error: unknown) => error instanceof AiProviderFailure && error.code === item.code && error.message === item.code
    );
  }
  const timeout = new OpenAiCompatibleProvider(
    async () => new Response('{}'),
    20,
    async () => new Promise(() => undefined)
  );
  await assert.rejects(
    timeout.execute(task, { provider: 'openai_compatible', model: 'local', baseUrl: 'http://localhost:11434/v1' }),
    (error: unknown) => error instanceof AiProviderFailure && error.code === 'AI_TIMEOUT'
  );

  const transportTimeout = new OpenAiCompatibleProvider(
    async () => new Promise((_resolve,reject)=>setTimeout(()=>reject(new AiProviderFailure('AI_RESPONSE_INVALID')),60)),
    20,
    resolver
  );
  await assert.rejects(
    transportTimeout.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}),
    (error:unknown)=>error instanceof AiProviderFailure && error.code==='AI_TIMEOUT'
  );

  const bodyTimeout = new OpenAiCompatibleProvider(async()=>new Response(new ReadableStream({start(){ /* intentionally never closes */ }})),20,resolver);
  await assert.rejects(
    bodyTimeout.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}),
    (error:unknown)=>error instanceof AiProviderFailure && error.code==='AI_TIMEOUT'
  );

  const networkFailure=new OpenAiCompatibleProvider(async()=>{throw new Error('synthetic network failure');},1_000,resolver);
  await assert.rejects(
    networkFailure.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}),
    (error:unknown)=>error instanceof AiProviderFailure && error.code==='AI_UPSTREAM_ERROR'
  );

  const upstreamAbort=new OpenAiCompatibleProvider(async()=>{throw new DOMException('upstream aborted early','AbortError');},1_000,resolver);
  await assert.rejects(
    upstreamAbort.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}),
    (error:unknown)=>error instanceof AiProviderFailure && error.code==='AI_UPSTREAM_ERROR'
  );

  const dnsFailure=new OpenAiCompatibleProvider(async()=>new Response('{}'),1_000,async()=>{throw new Error('synthetic dns failure');});
  await assert.rejects(
    dnsFailure.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}),
    (error:unknown)=>error instanceof AiProviderFailure && error.code==='AI_UPSTREAM_ERROR'
  );

  const reasoningOnly=new OpenAiCompatibleProvider(async()=>new Response(JSON.stringify({choices:[{message:{content:null,reasoning_content:'No final answer'}}]})),1_000,resolver);
  await assert.rejects(
    reasoningOnly.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'}),
    (error:unknown)=>error instanceof AiProviderFailure && error.code==='AI_RESPONSE_INVALID'
  );

  const textParts=new OpenAiCompatibleProvider(async()=>new Response(JSON.stringify({choices:[{message:{content:[{type:'reasoning',text:'ignore'},{type:'text',text:'Final text'}],reasoning_content:'ignore'}}]})),1_000,resolver);
  assert.equal((await textParts.execute(task,{provider:'openai_compatible',model:'local',baseUrl:'http://localhost:11434/v1'})).output,'Final text');

  const oversizedUsage = new OpenAiCompatibleProvider(async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'Valid output without unsafe counters' } }],
    usage: { prompt_tokens: 2_147_483_648, completion_tokens: 2_147_483_648 }
  })), 1_000, resolver);
  const result = await oversizedUsage.execute(task, {
    provider: 'openai_compatible', model: 'local', baseUrl: 'http://localhost:11434/v1'
  });
  assert.equal(result.usage, undefined);
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
