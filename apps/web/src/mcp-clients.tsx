import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { formatDate } from './time';
import { Check, Dialog, Empty, ErrorNotice, Icon, Loading, useI18n } from './ui';
import type { Display, Person } from './types';
import { approvedMcpResourceCount, calendarProviderTranslationKey, calendarResourcesForPolicy, calendarSourcePolicyLabel, calendarSourcesForPolicy, calendarSourceRecords as calendarSourceRecordsForPolicy, hasMcpDisplayPolicyScope, hasMcpMonitorContentScope, hasMcpPeoplePolicyScope, hasMcpSchoolScope, isValidMcpScopeNarrowing, mcpActivityTranslationKey, mcpScopeTranslationKey, saveMcpPolicy, schoolResourcesForPolicy, unlistedCalendarResources, unlistedSchoolResources, type McpAuthorization, type McpCalendarSource, type SchoolPlanSource } from './mcp-client-policy';

type McpAuthorizations = { authorizations: McpAuthorization[] };
type McpActivity = { occurredAt:string; action:string; subjectType:string; subjectId:string };
type CalendarConnections = {connections:Parameters<typeof calendarSourcesForPolicy>[0]};

export function McpClients({ householdId, timezone, people, displays, sourceVersion=0 }: { householdId: string; timezone: string; people: Person[]; displays: Display[]; sourceVersion?:number }) {
  const { t, locale } = useI18n();
  const base = `/households/${householdId}/mcp/authorizations`;
  const [authorizations, setAuthorizations] = useState<McpAuthorization[] | null>(null);
  const [schoolSources, setSchoolSources] = useState<SchoolPlanSource[]>([]);
  const [sourceLoadError,setSourceLoadError]=useState<unknown>();
  const [sourceListReady,setSourceListReady]=useState(false);
  const [calendarSources,setCalendarSources]=useState<McpCalendarSource[]>([]);
  const [calendarSourceDetails,setCalendarSourceDetails]=useState<McpCalendarSource[]>([]);
  const [calendarSourceLoadError,setCalendarSourceLoadError]=useState<unknown>();
  const [calendarSourceListReady,setCalendarSourceListReady]=useState(false);
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
  useEffect(()=>{let active=true;setCalendarSourceLoadError(undefined);setCalendarSourceListReady(false);void api<CalendarConnections>(`/households/${encodeURIComponent(householdId)}/calendar-connections`).then(value=>{if(active){setCalendarSources(calendarSourcesForPolicy(value.connections));setCalendarSourceDetails(calendarSourceRecordsForPolicy(value.connections));setCalendarSourceListReady(true)}}).catch(error=>{if(active){setCalendarSources([]);setCalendarSourceDetails([]);setCalendarSourceLoadError(error)}});return()=>{active=false}},[householdId,sourceVersion]);

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
    <ErrorNotice error={loadError}/><ErrorNotice error={sourceLoadError}/><ErrorNotice error={calendarSourceLoadError}/><ErrorNotice error={actionError}/>
    {authorizations === null ? <Loading/> : authorizations.length === 0 ? <Empty title={t('mcpNoClientsTitle')} body={t('mcpNoClientsBody')}/> : <div className="mcp-authorization-list">
      {authorizations.map(authorization => <McpAuthorizationCard key={`${authorization.id}:${authorization.revision}`} authorization={authorization} base={base} householdId={householdId} timezone={timezone} people={people} displays={displays} schoolSources={schoolSources} schoolSourcesAvailable={sourceListReady} calendarSources={calendarSources} calendarSourceDetails={calendarSourceDetails} calendarSourcesAvailable={calendarSourceListReady} onSaved={refresh} onRevoke={()=>{setActionError(undefined);setSelected(authorization)}}/>)}
    </div>}
    {selected && <Dialog title={t('mcpRevokeTitle')} onClose={()=>{if (!busy) setSelected(null)}}><p>{t('mcpRevokeBody', { client: selected.client_name })}</p><p className="field-hint">{t('mcpConsentAgain')}</p><ErrorNotice error={actionError}/><div className="form-actions"><button type="button" className="button" disabled={busy} onClick={()=>setSelected(null)}>{t('cancel')}</button><button type="button" className="button danger" disabled={busy} onClick={()=>void revoke()}>{busy?t('saving'):t('mcpRevokeConfirm')}</button></div></Dialog>}
  </section>;
}

export function McpAuthorizationCard({authorization,base,householdId,timezone,people,displays,schoolSources,schoolSourcesAvailable,calendarSources,calendarSourceDetails,calendarSourcesAvailable,onSaved,onRevoke}:{authorization:McpAuthorization;base:string;householdId:string;timezone:string;people:Person[];displays:Display[];schoolSources:SchoolPlanSource[];schoolSourcesAvailable:boolean;calendarSources:McpCalendarSource[];calendarSourceDetails:McpCalendarSource[];calendarSourcesAvailable:boolean;onSaved:()=>Promise<void>;onRevoke:()=>void}) {
  const {t,locale}=useI18n();
  const [personIds,setPersonIds]=useState(authorization.person_ids??[]);
  const [displayIds,setDisplayIds]=useState(authorization.display_ids??[]);
  const [schoolResourceIds,setSchoolResourceIds]=useState((authorization.resources??[]).filter(resource=>resource.kind==='school_source').map(resource=>resource.id));
  const [calendarResourceIds,setCalendarResourceIds]=useState((authorization.resources??[]).filter(resource=>resource.kind==='calendar_source').map(resource=>resource.id));
  const nativeGranted=approvedMcpResourceCount(authorization,'native_calendar')>0;
  const [nativeSelected,setNativeSelected]=useState(nativeGranted);
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
  const changed=nativeSelected!==nativeGranted||JSON.stringify(personIds)!==JSON.stringify(authorization.person_ids??[])||JSON.stringify(displayIds)!==JSON.stringify(authorization.display_ids??[])||JSON.stringify(schoolResourceIds)!==JSON.stringify((authorization.resources??[]).filter(resource=>resource.kind==='school_source').map(resource=>resource.id))||JSON.stringify(calendarResourceIds)!==JSON.stringify((authorization.resources??[]).filter(resource=>resource.kind==='calendar_source').map(resource=>resource.id))||JSON.stringify(scopeIds)!==JSON.stringify(authorization.scopes);
  const hasSchoolScope=hasMcpSchoolScope(scopeIds);
  const hasCalendarScope=scopeIds.includes('mcp:calendar:read');
  const hasPeopleScope=hasMcpPeoplePolicyScope(scopeIds);
  const hasDisplayScope=hasMcpDisplayPolicyScope(scopeIds);
  const validScopes=isValidMcpScopeNarrowing(authorization.scopes,scopeIds);
  const scopesChanged=JSON.stringify(scopeIds)!==JSON.stringify(authorization.scopes);
  const nonOfflineScopeCount=scopeIds.filter(scope=>scope!=='offline_access').length;
  const resources=authorization.resources??[];
  const unlistedGrants=schoolSourcesAvailable?unlistedSchoolResources(resources,schoolSources):[];
  const unlistedCalendarGrants=calendarSourcesAvailable?unlistedCalendarResources(resources,calendarSources):[];
  const unresolvedUnlistedGrants=unlistedGrants.some(resource=>schoolResourceIds.includes(resource.id))||unlistedCalendarGrants.some(resource=>calendarResourceIds.includes(resource.id));
  const savePolicy=async()=>{
    if(!canEdit||busy||!changed)return;
    setBusy(true);setError(undefined);setSaved(false);
    try{
      let selectedResources=authorization.resources??[];
      if(hasSchoolScope){if(schoolSourcesAvailable)selectedResources=schoolResourcesForPolicy(selectedResources,schoolResourceIds,schoolSources,personIds)}else selectedResources=selectedResources.filter(resource=>resource.kind!=='school_source');
      if(hasCalendarScope&&personIds.length){if(calendarSourcesAvailable)selectedResources=calendarResourcesForPolicy(selectedResources,calendarResourceIds,calendarSources,personIds)}else selectedResources=selectedResources.filter(resource=>resource.kind!=='calendar_source');
      selectedResources=selectedResources.filter(resource=>resource.kind!=='native_calendar');
      if(hasCalendarScope&&nativeSelected&&personIds.length)selectedResources.push({kind:'native_calendar',id:householdId});
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
    {authorization.scopes.some(scope=>['mcp:school-plans:read','mcp:school-plans:write'].includes(scope))&&<p className="mcp-policy-pending" role="note">{approvedMcpResourceCount(authorization,'school_source')?t('mcpSchoolResourceApproved',{count:approvedMcpResourceCount(authorization,'school_source')}):t('mcpSchoolResourcePending')}</p>}
    {authorization.scopes.includes('mcp:calendar:read')&&<p className="mcp-policy-pending" role="note">{approvedMcpResourceCount(authorization,'calendar_source')?t('mcpCalendarResourceApproved',{count:approvedMcpResourceCount(authorization,'calendar_source')}):t('mcpCalendarResourcePending')}</p>}
    {changed&&<p className="field-hint" role="status">{t('mcpPolicyUnsavedChanges')}</p>}
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
            if(!hasMcpSchoolScope(next))setSchoolResourceIds([]);
            if(!next.includes('mcp:calendar:read')){setCalendarResourceIds([]);setNativeSelected(false)}
            if(!hasMcpDisplayPolicyScope(next))setDisplayIds([]);
            if(!hasMcpPeoplePolicyScope(next))setPersonIds([]);
          }}/>;
        })}
        {hasMcpMonitorContentScope(authorization.scopes)&&<p className="field-hint" role="note">{t('mcpMonitorContentDependency')}</p>}
        {authorization.scopes.includes('mcp:calendar:write')&&<p className="field-hint" role="note">{t('mcpCalendarWriteDependency')}</p>}
        {authorization.scopes.includes('mcp:displays:appearance:write')&&<p className="field-hint" role="note">{t('mcpDisplayAppearanceWriteDependency')}</p>}
        <p className="field-hint" role="note">{t('mcpScopesWidenConsent')}</p>
      </fieldset>
      <fieldset disabled={!canEdit||busy||!hasPeopleScope}><legend>{t('mcpPeoplePolicy')}</legend>{!hasPeopleScope&&<p className="field-hint">{t('mcpPeopleScopeRequired')}</p>}{people.map(person=><Check key={person.id} label={person.display_name} checked={personIds.includes(person.id)} onChange={checked=>{const next=checked?[...personIds,person.id]:personIds.filter(id=>id!==person.id);setPersonIds(next);if(!checked)setSchoolResourceIds(current=>current.filter(id=>!schoolSources.some(source=>source.id===id&&source.personId===person.id)));if(next.length===0){setCalendarResourceIds([]);setNativeSelected(false)}}}/>)}</fieldset>
      <fieldset disabled={!canEdit||busy||!hasDisplayScope}><legend>{t('mcpDisplaysPolicy')}</legend>{!hasDisplayScope&&<p className="field-hint">{t('mcpDisplayScopeRequired')}</p>}{displays.filter(display=>!display.revoked_at).map(display=><Check key={display.id} label={display.name} checked={displayIds.includes(display.id)} onChange={checked=>setDisplayIds(checked?[...displayIds,display.id]:displayIds.filter(id=>id!==display.id))}/>)}</fieldset>
      <fieldset disabled={!canEdit||busy||!schoolSourcesAvailable||!hasSchoolScope}>
        <legend>{t('mcpSchoolSourcesPolicy')}</legend>
        <p className="field-hint">{t(!hasSchoolScope?'mcpSchoolScopeRequired':schoolSourcesAvailable?'mcpSchoolSourcesPolicyHelp':'mcpSchoolSourcesUnavailable')}</p>
        {schoolSourcesAvailable&&schoolSources.length?schoolSources.map(source=>{
          const person=people.find(item=>item.id===source.personId);
          const selected=schoolResourceIds.includes(source.id);
          const personAllowed=personIds.includes(source.personId);
          return <Check key={source.id} label={`${person?.display_name??t('mcpUnknownPerson')} · ${source.classKey} · ${!personAllowed?t('mcpSchoolSourcePersonRequired'):source.displayPdfLinksAllowed?t('mcpSchoolSourcePdfAllowed'):t('mcpSchoolSourcePdfNotAllowed')}`} checked={selected} disabled={!personAllowed} onChange={checked=>setSchoolResourceIds(checked?[...schoolResourceIds,source.id]:schoolResourceIds.filter(id=>id!==source.id))}/>;
        }):schoolSourcesAvailable?<p className="field-hint">{t('mcpSchoolNoApprovedSources')}</p>:null}
        {hasSchoolScope&&schoolSourcesAvailable&&unlistedGrants.length>0&&<div className="mcp-unlisted-school-grants" role="note">
          <p className="field-hint">{t('mcpSchoolUnlistedGrantAction',{count:unlistedGrants.length})}</p>
          {unlistedGrants.map(resource=><div key={resource.id}>
            <Check label={t('mcpSchoolSourceNoLongerAvailable')} checked={schoolResourceIds.includes(resource.id)} onChange={checked=>setSchoolResourceIds(checked?[...schoolResourceIds,resource.id]:schoolResourceIds.filter(id=>id!==resource.id))}/>
            <details><summary>{t('mcpSchoolSourceTechnicalReference')}</summary><code>{resource.id}</code></details>
          </div>)}
        </div>}
      </fieldset>
      {authorization.scopes.includes('mcp:calendar:read')&&<fieldset disabled={!canEdit||busy||!hasCalendarScope||personIds.length===0}>
        <legend>{t('mcpNativeCalendarPolicy')}</legend>
        <Check label={t('mcpNativeCalendarApprove')} checked={nativeSelected} onChange={setNativeSelected}/>
        <p className="field-hint">{t(personIds.length?'mcpNativeCalendarHelp':'mcpCalendarPeopleRequired')}</p>
      </fieldset>}
      <fieldset disabled={!canEdit||busy||!calendarSourcesAvailable||!hasCalendarScope||personIds.length===0}>
        <legend>{t('mcpCalendarSourcesPolicy')}</legend>
        <p className="field-hint">{t(!hasCalendarScope?'mcpCalendarScopeRequired':personIds.length===0?'mcpCalendarPeopleRequired':calendarSourcesAvailable?'mcpCalendarSourcesPolicyHelp':'mcpCalendarSourcesUnavailable')}</p>
        {calendarSourcesAvailable&&calendarSources.length?calendarSources.map(source=><Check key={source.id} label={`${calendarSourcePolicyLabel(source)} · ${t(calendarProviderTranslationKey(source.provider))}`} checked={calendarResourceIds.includes(source.id)} onChange={checked=>setCalendarResourceIds(checked?[...calendarResourceIds,source.id]:calendarResourceIds.filter(id=>id!==source.id))}/>):calendarSourcesAvailable?<p className="field-hint">{t('mcpCalendarNoApprovedSources')}</p>:null}
        {hasCalendarScope&&calendarSourcesAvailable&&unlistedCalendarGrants.length>0&&<div className="mcp-unlisted-calendar-grants" role="note">
          <p className="field-hint">{t('mcpCalendarSourceUnlistedAction',{count:unlistedCalendarGrants.length})}</p>
          {unlistedCalendarGrants.map(resource=>{const detail=calendarSourceDetails.find(source=>source.id===resource.id);return <div key={resource.id}>
            <Check label={`${detail?calendarSourcePolicyLabel(detail):t('mcpCalendarSourceNoLongerAvailable')} · ${detail?t(calendarProviderTranslationKey(detail.provider)):t('mcpCalendarSourceNoLongerAvailable')} · ${detail?t(detail.enabled?'mcpCalendarSourceEnabled':'mcpCalendarSourceDisabled'):''} · ${detail?t(detail.connectionState==='connected'?'mcpCalendarConnectionConnected':'mcpCalendarConnectionDisconnected'):''}`} checked={calendarResourceIds.includes(resource.id)} onChange={checked=>setCalendarResourceIds(checked?[...calendarResourceIds,resource.id]:calendarResourceIds.filter(id=>id!==resource.id))}/>
            <details><summary>{t('mcpCalendarSourceTechnicalReference')}</summary><code>{resource.id}</code></details>
          </div>})}
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
