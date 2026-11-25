import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Check, Dialog, Empty, ErrorNotice, Field, Loading, Submit, useI18n } from './ui';
import type { Person } from './types';
import type { IntegrationConnection } from './home-types';
import type { SchoolPlanSource } from './mcp-client-policy';
import { createSchoolPlanSourceBody, schoolPlanSourceDisplayName } from './school-plan-sources-presentation';

type SourceList = { sources: SchoolPlanSource[] };
type ConnectionList = { connections: IntegrationConnection[] };
type Draft = { personId: string; connectionId: string; classKey: string; sourcePageUrl: string; displayPdfLinksAllowed: boolean };
const emptyDraft: Draft = { personId: '', connectionId: '', classKey: '', sourcePageUrl: '', displayPdfLinksAllowed: false };

export function SchoolPlanSourcesAdmin({ householdId, people, onChanged }: { householdId: string; people: Person[]; onChanged: () => void }) {
  const { t } = useI18n();
  const base = `/households/${encodeURIComponent(householdId)}/school-plan-sources`;
  const connectionsPath = `/households/${encodeURIComponent(householdId)}/integrations`;
  const [sources, setSources] = useState<SchoolPlanSource[] | null>(null);
  const [connections, setConnections] = useState<IntegrationConnection[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [editor, setEditor] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [remove, setRemove] = useState<SchoolPlanSource | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(undefined);
    const [sourceResult, connectionResult] = await Promise.allSettled([api<SourceList>(base), api<ConnectionList>(connectionsPath)]);
    if (sourceResult.status === 'fulfilled') setSources(sourceResult.value.sources);
    else { setSources([]); setLoadError(sourceResult.reason); }
    if (connectionResult.status === 'fulfilled') setConnections(connectionResult.value.connections.filter(connection => !connection.revokedAt));
    else { setConnections([]); setLoadError(connectionResult.reason); }
  }, [base, connectionsPath]);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setActionError(undefined);
    try {
      const body = createSchoolPlanSourceBody(draft);
      await api(`${base}`, 'POST', body);
      setEditor(false); setDraft(emptyDraft); onChanged(); await refresh();
    } catch (error) { setActionError(error); }
    finally { setBusy(false); }
  };
  const deleteSource = async () => {
    if (!remove || busy) return;
    setBusy(true); setActionError(undefined);
    try {
      await api(`${base}/${encodeURIComponent(remove.id)}`, 'DELETE');
      setRemove(null); onChanged(); await refresh();
    } catch (error) { setActionError(error); }
    finally { setBusy(false); }
  };
  const activePeople = people.filter(person => person.account_status !== 'disabled');

  return <section className="school-source-admin" aria-labelledby="school-source-admin-title">
    <header className="section-heading"><div><p className="eyebrow">{t('schoolSourceAdminEyebrow')}</p><h2 id="school-source-admin-title">{t('schoolSourceAdminTitle')}</h2><p>{t('schoolSourceAdminIntro')}</p></div><button type="button" className="button" onClick={()=>{setActionError(undefined);setEditor(true)}}>{t('schoolSourceAdd')}</button></header>
    <p className="school-source-policy-separation">{t('schoolSourcePolicySeparation')}</p>
    <ErrorNotice error={loadError}/><ErrorNotice error={actionError}/>
    {sources === null || connections === null ? <Loading/> : sources.length ? <div className="school-source-admin-list">{sources.map(source=>{
      const person=people.find(item=>item.id===source.personId);
      const connection=schoolPlanSourceDisplayName(source,connections.map(item=>({id:item.id,name:item.name})));
      return <article className="surface-card school-source-admin-card" key={source.id}>
        <div className="school-source-admin-title"><div><strong>{person?.display_name??t('mcpUnknownPerson')} · {source.classKey}</strong><span>{connection??t('schoolSourceConnectionUnknown')}</span></div><button type="button" className="text-button danger-text" onClick={()=>{setActionError(undefined);setRemove(source)}}>{t('schoolSourceRemove')}</button></div>
        <a className="school-source-admin-url" href={source.sourcePageUrl} target="_blank" rel="noreferrer">{source.sourcePageUrl}</a>
        <p className="field-hint">{source.displayPdfLinksAllowed?t('schoolSourceDisplayPdfAllowed'):t('schoolSourceDisplayPdfDenied')}</p>
      </article>;
    })}</div> : <Empty title={t('schoolSourceNoSourcesTitle')} body={t('schoolSourceNoSourcesBody')}/>}
    {editor && <Dialog title={t('schoolSourceAdd')} onClose={()=>{if (!busy) setEditor(false)}}>
      <form className="form-stack" onSubmit={event=>void save(event)}>
        <Field label={t('schoolSourcePerson')}><select required value={draft.personId} disabled={busy} onChange={event=>setDraft({...draft,personId:event.target.value})}><option value="">{t('schoolSourceChoosePerson')}</option>{activePeople.map(person=><option key={person.id} value={person.id}>{person.display_name}</option>)}</select></Field>
        <Field label={t('schoolSourceConnection')} hint={t('schoolSourceConnectionHint')}><select required value={draft.connectionId} disabled={busy} onChange={event=>setDraft({...draft,connectionId:event.target.value})}><option value="">{t('schoolSourceChooseConnection')}</option>{connections?.map(connection=><option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></Field>
        <Field label={t('schoolSourceClassKey')} hint={t('schoolSourceClassKeyHint')}><input required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,63}" maxLength={64} value={draft.classKey} autoComplete="off" disabled={busy} onChange={event=>setDraft({...draft,classKey:event.target.value})}/></Field>
        <Field label={t('schoolSourcePageUrl')} hint={t('schoolSourcePageUrlHint')}><input required type="url" value={draft.sourcePageUrl} autoComplete="url" disabled={busy} onChange={event=>setDraft({...draft,sourcePageUrl:event.target.value})}/></Field>
        <Check label={t('schoolSourceDisplayPdfConsent')} checked={draft.displayPdfLinksAllowed} disabled={busy} onChange={checked=>setDraft({...draft,displayPdfLinksAllowed:checked})}/>
        <p className="field-hint">{t('schoolSourceDisplayPdfConsentHint')}</p>
        {!connections?.length&&<p className="field-hint"><a href="#generic-integrations" onClick={()=>setEditor(false)}>{t('schoolSourceCreateConnectionFirst')}</a></p>}
        <ErrorNotice error={actionError}/>
        <div className="form-actions"><button type="button" className="button" disabled={busy} onClick={()=>setEditor(false)}>{t('cancel')}</button><Submit busy={busy} disabled={!connections?.length} label={t('schoolSourceAdd')}/></div>
      </form>
    </Dialog>}
    {remove&&<Dialog title={t('schoolSourceRemoveTitle')} onClose={()=>{if(!busy)setRemove(null)}}><p>{t('schoolSourceRemoveBody',{classKey:remove.classKey})}</p><ErrorNotice error={actionError}/><div className="form-actions"><button className="button" disabled={busy} onClick={()=>setRemove(null)}>{t('cancel')}</button><button className="button danger" disabled={busy} onClick={()=>void deleteSource()}>{busy?t('saving'):t('schoolSourceRemove')}</button></div></Dialog>}
  </section>;
}
