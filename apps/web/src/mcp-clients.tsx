import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { formatDate } from './time';
import { Check, Dialog, Empty, ErrorNotice, Icon, Loading, useI18n } from './ui';
import type { Display, Person } from './types';
import { mcpScopeTranslationKey, saveMcpPolicy, type McpAuthorization } from './mcp-client-policy';

type McpAuthorizations = { authorizations: McpAuthorization[] };

export function McpClients({ householdId, timezone, people, displays }: { householdId: string; timezone: string; people: Person[]; displays: Display[] }) {
  const { t, locale } = useI18n();
  const base = `/households/${householdId}/mcp/authorizations`;
  const [authorizations, setAuthorizations] = useState<McpAuthorization[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<McpAuthorization | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint = typeof window === 'undefined' ? '/mcp' : new URL('/mcp', window.location.origin).toString();

  const refresh = useCallback(async () => {
    setLoadError(undefined);
    try {
      const value = await api<McpAuthorizations>(base);
      setAuthorizations(value.authorizations);
    } catch (error) {
      setLoadError(error);
    }
  }, [base]);

  useEffect(() => { void refresh(); }, [refresh]);

  const copyEndpoint = async () => {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
    } catch {
      setActionError(new Error('clipboard_unavailable'));
    }
  };

  const revoke = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api(`${base}/${encodeURIComponent(selected.id)}/revoke`, 'POST');
      setSelected(null);
      await refresh();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  };

  return <section className="mcp-clients" aria-labelledby="mcp-clients-title">
    <header className="mcp-clients-heading">
      <div><p className="eyebrow">{t('mcpEyebrow')}</p><h2 id="mcp-clients-title">{t('mcpClientsTitle')}</h2><p>{t('mcpClientsIntro')}</p></div>
    </header>
    <section className="mcp-endpoint surface-card" aria-labelledby="mcp-endpoint-title">
      <div><h3 id="mcp-endpoint-title">{t('mcpEndpointTitle')}</h3><p>{t('mcpEndpointHelp')}</p></div>
      <div className="mcp-endpoint-copy"><code>{endpoint}</code><button className="button" type="button" onClick={()=>void copyEndpoint()}>{t('mcpCopyEndpoint')}</button></div>
      <p className="mcp-copy-status" role="status" aria-live="polite">{copied?t('mcpEndpointCopied'):''}</p>
    </section>
    <div className="mcp-consent-note"><Icon name="shield"/><p>{t('mcpConsentHelp')}</p></div>
    <ErrorNotice error={loadError}/><ErrorNotice error={actionError}/>
    {authorizations === null ? <Loading/> : authorizations.length === 0 ? <Empty title={t('mcpNoClientsTitle')} body={t('mcpNoClientsBody')}/> : <div className="mcp-authorization-list">
      {authorizations.map(authorization => <McpAuthorizationCard key={authorization.id} authorization={authorization} base={base} timezone={timezone} people={people} displays={displays} onSaved={refresh} onRevoke={()=>{setActionError(undefined);setSelected(authorization)}}/>)}
    </div>}
    {selected && <Dialog title={t('mcpRevokeTitle')} onClose={()=>{if (!busy) setSelected(null)}}><p>{t('mcpRevokeBody', { client: selected.client_name })}</p><p className="field-hint">{t('mcpConsentAgain')}</p><ErrorNotice error={actionError}/><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={()=>setSelected(null)}>{t('cancel')}</button><button type="button" className="button danger" disabled={busy} onClick={()=>void revoke()}>{busy?t('saving'):t('mcpRevokeConfirm')}</button></div></Dialog>}
  </section>;
}

export function McpAuthorizationCard({authorization,base,timezone,people,displays,onSaved,onRevoke}:{authorization:McpAuthorization;base:string;timezone:string;people:Person[];displays:Display[];onSaved:()=>Promise<void>;onRevoke:()=>void}) {
  const {t,locale}=useI18n();
  const [personIds,setPersonIds]=useState(authorization.person_ids??[]);
  const [displayIds,setDisplayIds]=useState(authorization.display_ids??[]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>();
  const [saved,setSaved]=useState(false);
  const revoked=Boolean(authorization.revoked_at);
  const canEdit=Array.isArray(authorization.person_ids)&&Array.isArray(authorization.display_ids)&&Array.isArray(authorization.resources)&&!revoked;
  const changed=JSON.stringify(personIds)!==JSON.stringify(authorization.person_ids??[])||JSON.stringify(displayIds)!==JSON.stringify(authorization.display_ids??[]);
  const hasSchoolScope=authorization.scopes.some(scope=>scope==='school-plans:read'||scope==='school-plans:write'||scope==='mcp:school-plans:read'||scope==='mcp:school-plans:write');
  const resources=authorization.resources??[];
  const savePolicy=async()=>{
    if(!canEdit||busy||!changed)return;
    setBusy(true);setError(undefined);setSaved(false);
    try{
      await saveMcpPolicy(base,authorization,personIds,displayIds);
      await onSaved();setSaved(true);
    }catch(cause){setError(cause)}finally{setBusy(false)}
  };
  return <article className="surface-card mcp-authorization-card">
    <div className="mcp-authorization-title"><div><h3>{authorization.client_name}</h3><p className="field-hint">{t('mcpAuthorizedOn', { date: formatDate(authorization.created_at, locale, timezone) })}</p></div><span className={`mcp-status${revoked?' is-revoked':''}`}>{t(revoked?'mcpStatusRevoked':'mcpStatusActive')}</span></div>
    <div className="mcp-scopes"><h4>{t('mcpGrantedAccess')}</h4><ul>{authorization.scopes.map(scope => <li key={scope}>{mcpScopeTranslationKey(scope) ? t(mcpScopeTranslationKey(scope)!) : scope}</li>)}</ul></div>
    <p className="mcp-last-used"><strong>{t('mcpLastUsed')}:</strong> {authorization.last_used_at ? formatDate(authorization.last_used_at, locale, timezone) : t('mcpNeverUsed')}</p>
    {hasSchoolScope&&<p className="mcp-policy-pending" role="note">{resources.length?t('mcpSchoolResourceApproved',{count:resources.length}):t('mcpSchoolResourcePending')}</p>}
    {Array.isArray(authorization.person_ids)&&Array.isArray(authorization.display_ids)&&Array.isArray(authorization.resources)&&<section className="mcp-policy" aria-label={t('mcpPolicyTitle')}>
      <h4>{t('mcpPolicyTitle')}</h4>
      <fieldset disabled={!canEdit||busy}><legend>{t('mcpPeoplePolicy')}</legend>{people.map(person=><Check key={person.id} label={person.display_name} checked={personIds.includes(person.id)} onChange={checked=>setPersonIds(checked?[...personIds,person.id]:personIds.filter(id=>id!==person.id))}/>)}</fieldset>
      <fieldset disabled={!canEdit||busy}><legend>{t('mcpDisplaysPolicy')}</legend>{displays.filter(display=>!display.revoked_at).map(display=><Check key={display.id} label={display.name} checked={displayIds.includes(display.id)} onChange={checked=>setDisplayIds(checked?[...displayIds,display.id]:displayIds.filter(id=>id!==display.id))}/>)}</fieldset>
      {canEdit&&<div className="mcp-policy-actions"><span role="status">{saved?t('mcpPolicySaved'):''}</span><button className="button" type="button" disabled={!changed||busy} onClick={()=>void savePolicy()}>{busy?t('saving'):t('mcpSavePolicy')}</button></div>}
      <ErrorNotice error={error}/>
    </section>}
    {!(Array.isArray(authorization.person_ids)&&Array.isArray(authorization.display_ids)&&Array.isArray(authorization.resources))&&!revoked&&<p className="mcp-policy-pending" role="note">{t('mcpPolicyPending')}</p>}
    {revoked && authorization.revoked_at && <p className="field-hint">{t('mcpRevokedOn', { date: formatDate(authorization.revoked_at, locale, timezone) })}</p>}
    {!revoked && <button type="button" className="text-button danger-text mcp-revoke-button" onClick={onRevoke}>{t('mcpRevoke')}</button>}
  </article>;
}
