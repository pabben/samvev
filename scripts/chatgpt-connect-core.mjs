import { createHash,randomBytes } from 'node:crypto';

export function createOAuthAttempt(){const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');return{state,nonce,verifier,challenge:createHash('sha256').update(verifier).digest('base64url')};}
export function validateOAuthCallback(url,expectedState){if(url.searchParams.get('state')!==expectedState)throw new Error('OAuth state validation failed');const error=url.searchParams.get('error');if(error)return{error};const code=url.searchParams.get('code');if(!code)throw new Error('Authorization callback did not contain a code');return{code};}
export function selectIssuedClientId(previousClientId,callbackClientId){const clientId=previousClientId??callbackClientId;if(!clientId||clientId==='dynamic_agent_client'||(previousClientId&&callbackClientId&&callbackClientId!==previousClientId))throw new Error('Authorization callback is incomplete or changed the issued client ID');return clientId;}
export function normalizeEarliestRefreshAt(value){if(value===undefined||value===null)return undefined;const date=typeof value==='number'&&Number.isFinite(value)?new Date(value*1000):typeof value==='string'?new Date(value):new Date(Number.NaN);if(Number.isNaN(date.getTime()))throw new Error('Invalid earliest refresh time');return date.toISOString();}
export function normalizeHostId(value){if(typeof value!=='string'||!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error('Host ID must be a valid urn:uuid value');return value.toLowerCase();}
export function registrationMetadata(clientId,extAgentHostId,previous={},identity){
  const issued=selectIssuedClientId(previous.clientId,clientId),host=normalizeHostId(extAgentHostId);
  if(previous.extAgentHostId&&normalizeHostId(previous.extAgentHostId)!==host)throw new Error('Registration metadata belongs to a different Samvev host');
  if(identity&&previous.issuer&&(previous.issuer!==identity.issuer||previous.subject!==identity.subject))throw new Error('Authorization returned a different ChatGPT identity');
  const now=new Date().toISOString();
  return{version:1,clientId:issued,extAgentHostId:host,...(identity?{issuer:identity.issuer,subject:identity.subject}:previous.issuer?{issuer:previous.issuer,subject:previous.subject}:{}),createdAt:previous.createdAt??now,updatedAt:now};
}
export function parseRegistrationMetadata(raw){
  const value=typeof raw==='string'?JSON.parse(raw):raw;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid ChatGPT registration metadata');
  const allowed=new Set(['version','clientId','extAgentHostId','issuer','subject','createdAt','updatedAt']);
  if(Object.keys(value).some((key)=>!allowed.has(key))||value.version!==1)throw new Error('Invalid ChatGPT registration metadata');
  const clientId=selectIssuedClientId(undefined,value.clientId),extAgentHostId=normalizeHostId(value.extAgentHostId);
  const bound=value.issuer!==undefined||value.subject!==undefined;
  if(bound&&(value.issuer!=='https://auth.openai.com'||typeof value.subject!=='string'||value.subject.length<1||value.subject.length>500))throw new Error('Invalid ChatGPT registration identity binding');
  for(const key of ['createdAt','updatedAt'])if(typeof value[key]!=='string'||Number.isNaN(new Date(value[key]).getTime()))throw new Error('Invalid ChatGPT registration timestamp');
  return{version:1,clientId,extAgentHostId,...(bound?{issuer:value.issuer,subject:value.subject}:{}),createdAt:new Date(value.createdAt).toISOString(),updatedAt:new Date(value.updatedAt).toISOString()};
}
