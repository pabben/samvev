import assert from 'node:assert/strict';
import test from 'node:test';
import { createOAuthAttempt,validateOAuthCallback } from './oauth-primitives.ts';

test('OAuth attempt uses fresh state nonce and a correct S256 PKCE challenge',()=>{const a=createOAuthAttempt(),b=createOAuthAttempt();assert.notEqual(a.state,b.state);assert.notEqual(a.nonce,b.nonce);assert.match(a.verifier,/^[A-Za-z0-9_-]{43,}$/);assert.match(a.challenge,/^[A-Za-z0-9_-]{43}$/);assert.deepEqual(validateOAuthCallback(new URL(`http://127.0.0.1/auth/callback?state=${a.state}&code=synthetic`),a.state),{code:'synthetic'});assert.throws(()=>validateOAuthCallback(new URL('http://127.0.0.1/auth/callback?state=wrong&code=x'),a.state));});
