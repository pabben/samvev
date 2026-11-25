import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { formatDate } from './time';
import { Check, Dialog, Empty, ErrorNotice, Icon, Loading, useI18n } from './ui';
import type { Display, Person } from './types';
import { hasMcpDisplayPolicyScope, hasMcpSchoolScope, isValidMcpScopeNarrowing, mcpActivityTranslationKey, mcpScopeTranslationKey, saveMcpPolicy, schoolResourcesForPolicy, unlistedSchoolResources, type McpAuthorization, type SchoolPlanSource } from './mcp-client-policy';

type McpAuthorizations = { authorizations: McpAuthorization[] };
type McpActivity = { occurredAt:string; action:string; subjectType:string; subjectId:string };

export function McpClients({ householdId, timezone, people, displays, sourceVersion=0 }: { householdId: string; timezone: string; people: Person[]; displays: Display[]; sourceVersion?:number }) {
  const { t, locale } = useI18n();
  const base = `/households/${householdId}/mcp/authorizations`;
  const [authorizations, setAuthorizations] = useState<McpAuthorization[] | null>(null);
  const [schoolSources, setSchoolSources] = useState<SchoolPlanSource[]>([]);
  const [sourceLoadError,setSourceLoadError]=useState<unknown>();
  const [sourceListReady,setSourceListReady]=useState(false);
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
  useEffect(()=>{let active=true;setSourceLoadError(undefined);setSourceListReady(false);void api<{sources:SchoolPlanSource[]}>(`/households/${encodeURIComponent(householdId)}/school-plan-sources`).then(value=>{if(active){setSchoolSources(value.sources);setSourceListReady(true)}}).catch(error=>{if(active){setSchoolSources([]);setSourceLoadError(error)}});return()=>{active=false}},[householdId,sourceVersion]);

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
    <ErrorNotice error={loadError}/><ErrorNotice error={sourceLoadError}/><ErrorNotice error={actionError}/>
    {authorizations === null ? <Loading/> : authorizations.length === 0 ? <Empty title={t('mcpNoClientsTitle')} body={t('mcpNoClientsBody')}/> : <div className="mcp-authorization-list">
      {authorizations.map(authorization => <McpAuthorizationCard key={`${authorization.id}:${authorization.revision}`} authorization={authorization} base={base} timezone={timezone} people={people} displays={displays} schoolSources={schoolSources} schoolSourcesAvailable={sourceListReady} onSaved={refresh} onRevoke={()=>{setActionError(undefined);setSelected(authorization)}}/>)}
    </div>}
    {selected && <Dialog title={t('mcpRevokeTitle')} onClose={()=>{if (!busy) setSelected(null)}}><p>{t('mcpRevokeBody', { client: selected.client_name })}</p><p className="field-hint">{t('mcpConsentAgain')}</p><ErrorNotice error={actionError}/><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={()=>setSelected(null)}>{t('cancel')}</button><button type="button" className="button danger" disabled={busy} onClick={()=>void revoke()}>{busy?t('saving'):t('mcpRevokeConfirm')}</button></div></Dialog>}
  </section>;
}

export function McpAuthorizationCard({authorization,base,timezone,people,displays,schoolSources,schoolSourcesAvailable,onSaved,onRevoke}:{authorization:McpAuthorization;base:string;timezone:string;people:Person[];displays:Display[];schoolSources:SchoolPlanSource[];schoolSourcesAvailable:boolean;onSaved:()=>Promise<void>;onRevoke:()=>void}) {
  const {t,locale}=useI18n();
  const [personIds,setPersonIds]=useState(authorization.person_ids??[]);
  const [displayIds,setDisplayIds]=useState(authorization.display_ids??[]);
  const [resourceIds,setResourceIds]=useState((authorization.resources??[]).map(resource=>resource.id));
  const [scopeIds,setScopeIds]=useState(authorization.scopes);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>();
  const [saved,setSaved]=useState(false);
  const [activityOpen,setActivityOpen]=useState(false);
  const [activity,setActivity]=useState<McpActivity[]|null>(null);
  const [activityBusy,setActivityBusy]=useState(false);
  const [activityError,setActivityError]=useState<unknown>();
  const revoked=Boolean(authorization.revoked_at);
  const canEdit=Array.isArray(authorization.person_ids)&&Array.isArray(authorization.display_ids)&&Array.isArray(authorization.resources)&&!revoked;
  const changed=JSON.stringify(personIds)!==JSON.stringify(authorization.person_ids??[])||JSON.stringify(displayIds)!==JSON.stringify(authorization.display_ids??[])||JSON.stringify(resourceIds)!==JSON.stringify((authorization.resources??[]).map(resource=>resource.id))||JSON.stringify(scopeIds)!==JSON.stringify(authorization.scopes);
  const hasSchoolScope=hasMcpSchoolScope(scopeIds);
  const hasDisplayScope=hasMcpDisplayPolicyScope(scopeIds);
  const validScopes=isValidMcpScopeNarrowing(authorization.scopes,scopeIds);
  const scopesChanged=JSON.stringify(scopeIds)!==JSON.stringify(authorization.scopes);
  const nonOfflineScopeCount=scopeIds.filter(scope=>scope!=='offline_access').length;
  const resources=authorization.resources??[];
  const unlistedGrants=schoolSourcesAvailable?unlistedSchoolResources(resources,schoolSources):[];
  const unresolvedUnlistedGrants=unlistedGrants.some(resource=>resourceIds.includes(resource.id));
  const savePolicy=async()=>{
    if(!canEdit||busy||!changed)return;
    setBusy(true);setError(undefined);setSaved(false);
    try{
      const selectedResources=hasSchoolScope?(schoolSourcesAvailable?schoolResourcesForPolicy(authorization.resources??[],resourceIds,schoolSources,personIds):authorization.resources??[]):[];
      await saveMcpPolicy(base,authorization,personIds,displayIds,selectedResources,scopesChanged?scopeIds:undefined);
      await onSaved();setSaved(true);
    }catch(cause){setError(cause)}finally{setBusy(false)}
  };
  const toggleActivity=async()=>{
    if(activityOpen){setActivityOpen(false);return;}
    setActivityOpen(true);
    if(activity!==null||activityBusy)return;
    setActivityBusy(true);setActivityError(undefined);
    try{const value=await api<{activity:McpActivity[]}>(`${base}/${encodeURIComponent(authorization.id)}/activity?limit=20`);setActivity(value.activity)}catch(cause){setActivityError(cause)}finally{setActivityBusy(false)}
  };
  return <article className="surface-card mcp-authorization-card">
    <div className="mcp-authorization-title"><div><h3>{authorization.client_name}</h3><p className="field-hint">{t('mcpAuthorizedOn', { date: formatDate(authorization.created_at, locale, timezone) })}</p></div><span className={`mcp-status${revoked?' is-revoked':''}`}>{t(revoked?'mcpStatusRevoked':'mcpStatusActive')}</span></div>
    <div className="mcp-scopes"><h4>{t('mcpGrantedAccess')}</h4><ul>{scopeIds.map(scope => <li key={scope}>{mcpScopeTranslationKey(scope) ? t(mcpScopeTranslationKey(scope)!) : scope}</li>)}</ul></div>
    <p className="mcp-last-used"><strong>{t('mcpLastUsed')}:</strong> {authorization.last_used_at ? formatDate(authorization.last_used_at, locale, timezone) : t('mcpNeverUsed')}</p>
    {hasSchoolScope&&<p className="mcp-policy-pending" role="note">{resourceIds.length?t('mcpSchoolResourceApproved',{count:resourceIds.length}):t('mcpSchoolResourcePending')}</p>}
    {Array.isArray(authorization.person_ids)&&Array.isArray(authorization.display_ids)&&Array.isArray(authorization.resources)&&<section className="mcp-policy" aria-label={t('mcpPolicyTitle')}>
      <h4>{t('mcpPolicyTitle')}</h4>
      <fieldset disabled={!canEdit||busy}>
        <legend>{t('mcpScopesPolicy')}</legend>
        <p className="field-hint">{t('mcpScopesPolicyHelp')}</p>
        <p className="field-hint">{t('mcpScopesNarrowingEffect')}</p>
        {authorization.scopes.map(scope=>{
          const checked=scopeIds.includes(scope);
          const onlyRequiredScope=checked&&scope!=='offline_access'&&nonOfflineScopeCount<=1;
          return <Check key={scope} label={mcpScopeTranslationKey(scope)?t(mcpScopeTranslationKey(scope)!):scope} checked={checked} disabled={onlyRequiredScope} onChange={enabled=>{
            const next=enabled?[...scopeIds,scope]:scopeIds.filter(item=>item!==scope);
            if(!isValidMcpScopeNarrowing(authorization.scopes,next))return;
            setScopeIds(next);
            if(!hasMcpSchoolScope(next))setResourceIds([]);
          }}/>;
        })}
        <p className="field-hint" role="note">{t('mcpScopesWidenConsent')}</p>
      </fieldset>
      <fieldset disabled={!canEdit||busy}><legend>{t('mcpPeoplePolicy')}</legend>{people.map(person=><Check key={person.id} label={person.display_name} checked={personIds.includes(person.id)} onChange={checked=>{setPersonIds(checked?[...personIds,person.id]:personIds.filter(id=>id!==person.id));if(!checked)setResourceIds(current=>current.filter(id=>!schoolSources.some(source=>source.id===id&&source.personId===person.id)))}}/>)}</fieldset>
      <fieldset disabled={!canEdit||busy||!hasDisplayScope}><legend>{t('mcpDisplaysPolicy')}</legend>{!hasDisplayScope&&<p className="field-hint">{t('mcpDisplayScopeRequired')}</p>}{displays.filter(display=>!display.revoked_at).map(display=><Check key={display.id} label={display.name} checked={displayIds.includes(display.id)} onChange={checked=>setDisplayIds(checked?[...displayIds,display.id]:displayIds.filter(id=>id!==display.id))}/>)}</fieldset>
      <fieldset disabled={!canEdit||busy||!schoolSourcesAvailable||!hasSchoolScope}>
        <legend>{t('mcpSchoolSourcesPolicy')}</legend>
        <p className="field-hint">{t(!hasSchoolScope?'mcpSchoolScopeRequired':schoolSourcesAvailable?'mcpSchoolSourcesPolicyHelp':'mcpSchoolSourcesUnavailable')}</p>
        {schoolSourcesAvailable&&schoolSources.length?schoolSources.map(source=>{
          const person=people.find(item=>item.id===source.personId);
          const selected=resourceIds.includes(source.id);
          const personAllowed=personIds.includes(source.personId);
          return <Check key={source.id} label={`${person?.display_name??t('mcpUnknownPerson')} · ${source.classKey} · ${source.sourcePageUrl} · ${!personAllowed?t('mcpSchoolSourcePersonRequired'):source.displayPdfLinksAllowed?t('mcpSchoolSourcePdfAllowed'):t('mcpSchoolSourcePdfNotAllowed')}`} checked={selected} disabled={!personAllowed} onChange={checked=>setResourceIds(checked?[...resourceIds,source.id]:resourceIds.filter(id=>id!==source.id))}/>;
        }):schoolSourcesAvailable?<p className="field-hint">{t('mcpSchoolNoApprovedSources')}</p>:null}
        {hasSchoolScope&&schoolSourcesAvailable&&unlistedGrants.length>0&&<div className="mcp-unlisted-school-grants" role="note">
          <p className="field-hint">{t('mcpSchoolUnlistedGrantAction',{count:unlistedGrants.length})}</p>
          {unlistedGrants.map(resource=><div key={resource.id}>
            <Check label={t('mcpSchoolSourceNoLongerAvailable')} checked={resourceIds.includes(resource.id)} onChange={checked=>setResourceIds(checked?[...resourceIds,resource.id]:resourceIds.filter(id=>id!==resource.id))}/>
            <details><summary>{t('mcpSchoolSourceTechnicalReference')}</summary><code>{resource.id}</code></details>
          </div>)}
        </div>}
      </fieldset>
      {canEdit&&<div className="mcp-policy-actions"><span role="status">{saved?t('mcpPolicySaved'):''}</span><button className="button" type="button" disabled={!changed||busy||unresolvedUnlistedGrants||!validScopes} onClick={()=>void savePolicy()}>{busy?t('saving'):t('mcpSavePolicy')}</button></div>}
      <ErrorNotice error={error}/>
    </section>}
    {!(Array.isArray(authorization.person_ids)&&Array.isArray(authorization.display_ids)&&Array.isArray(authorization.resources))&&!revoked&&<p className="mcp-policy-pending" role="note">{t('mcpPolicyPending')}</p>}
    {revoked && authorization.revoked_at && <p className="field-hint">{t('mcpRevokedOn', { date: formatDate(authorization.revoked_at, locale, timezone) })}</p>}
    {!revoked && <button type="button" className="text-button danger-text mcp-revoke-button" onClick={onRevoke}>{t('mcpRevoke')}</button>}
    <section className="mcp-activity"><button className="text-button mcp-activity-toggle" type="button" aria-expanded={activityOpen} aria-controls={`mcp-activity-${authorization.id}`} onClick={()=>void toggleActivity()}>{t(activityOpen?'mcpActivityHide':'mcpActivityShow')}</button>{activityOpen&&<div id={`mcp-activity-${authorization.id}`} className="mcp-activity-panel"><ErrorNotice error={activityError}/>{activityBusy?<Loading/>:activity===null?null:activity.length?<ol>{activity.map((entry,index)=>{const key=mcpActivityTranslationKey(entry.action);return <li key={`${entry.occurredAt}:${index}`}><time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt,locale,timezone,{dateStyle:'medium',timeStyle:'short'})}</time><span>{key?t(key):t('mcpActivityGeneric',{action:entry.action})}</span><details><summary>{t('mcpActivitySubject')}</summary><code>{entry.subjectType}: {entry.subjectId}</code></details></li>})}</ol>:<p className="field-hint">{t('mcpActivityEmpty')}</p>}</div>}</section>
  </article>;
}
