import {useCallback,useEffect,useState} from 'react';
import {api,ApiError} from './api';
import {ErrorNotice,Field,Loading,Submit,useAction,useI18n} from './ui';

type Contact={operatorName:string;postalAddress:string;contactEmail:string;revision:number};
export function InstallationPublicContact({installationId}:{installationId:string}){
 const {t}=useI18n();const base=`/installations/${installationId}/public-contact`;const {run,busy,error,setError}=useAction();
 const [contact,setContact]=useState<Contact|null>(null);const [ready,setReady]=useState(false);const [saved,setSaved]=useState(false);const [conflict,setConflict]=useState(false);
 const load=useCallback(async()=>{try{const result=await api<{contact:Contact|null}>(base);setContact(result.contact??{operatorName:'',postalAddress:'',contactEmail:'',revision:0});setReady(true)}catch(cause){if(cause instanceof ApiError&&[401,403,404].includes(cause.status)){setContact(null);setReady(true)}throw cause}},[base]);
 useEffect(()=>{void run(load)},[load]);
 if(!ready)return <section className="surface-card public-contact-admin"><Loading/><ErrorNotice error={error}/>{Boolean(error)&&<button type="button" className="button" onClick={()=>void run(load)}>{t('retry')}</button>}</section>;
 if(!contact)return <section className="surface-card public-contact-admin"><ErrorNotice error={error}/></section>;
 return <section className="surface-card public-contact-admin" aria-labelledby="public-contact-admin-title">
  <div className="section-heading"><div><p className="eyebrow">{t('calendarInstallationAdmin')}</p><h2 id="public-contact-admin-title">{t('publicContactAdminTitle')}</h2><p>{t('publicContactAdminBody')}</p></div></div>
  {saved&&<p role="status" className="notice">{t('publicContactSaved')}</p>}{conflict&&<p role="status" className="notice">{t('publicContactConflict')}</p>}
  <form key={contact.revision} className="form-stack" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);setSaved(false);void run(async()=>{try{const result=await api<{contact:Contact}>(base,'PUT',{expectedRevision:contact.revision,operatorName:data.get('operatorName'),postalAddress:data.get('postalAddress'),contactEmail:data.get('contactEmail')});setContact(result.contact);setConflict(false);setSaved(true)}catch(cause){if(!(cause instanceof ApiError)||cause.status!==409)throw cause;const current=await api<{contact:Contact|null}>(base);if(!current.contact)throw cause;setContact(current.contact);setConflict(true);setError(null)}})}}>
   <Field label={t('publicOperator')}><input name="operatorName" required minLength={2} maxLength={160} autoComplete="organization" defaultValue={contact.operatorName}/></Field>
   <Field label={t('publicAddress')}><textarea name="postalAddress" required minLength={5} maxLength={500} autoComplete="street-address" rows={3} defaultValue={contact.postalAddress}/></Field>
   <Field label={t('publicEmail')}><input name="contactEmail" type="email" required maxLength={254} autoComplete="email" defaultValue={contact.contactEmail}/></Field>
   <p className="field-hint">{t('publicContactAdminNotice')}</p><ErrorNotice error={error}/><div className="form-actions"><Submit busy={busy} label={t('save')}/></div>
  </form>
 </section>;
}
