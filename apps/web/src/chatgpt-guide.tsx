import {useEffect,useState} from 'react';
import {chatGptGuidePresentation} from './chatgpt-guide-presentation';
import {api} from './api';
import {ErrorNotice,Icon,useAction,useI18n} from './ui';
type Helper={status:string;hostId:string;downloads:{name:string;url:string}[];localCommand:string;serverImportCommand:string;transferCommand?:string};
export function ChatGptGuide({householdId,status,onRefresh}:{householdId:string;status?:string;onRefresh:()=>Promise<void>}){
 const {t}=useI18n(),{run,busy,error}=useAction();const [helper,setHelper]=useState<Helper>(),[step,setStep]=useState(0);
 const presentation=chatGptGuidePresentation(status,Boolean(helper),step);
 // A newly required sign-in invalidates earlier self-reported progress. Nothing
 // here initiates consent, imports credentials or contacts a provider.
 useEffect(()=>{if(status==='reauthorization_required'||status==='disconnected')setStep(helper?1:0)},[status]);
 return <section className="chatgpt-wizard" aria-labelledby="chatgpt-wizard-title"><h3 id="chatgpt-wizard-title">{t('chatWizardTitle')}</h3><p>{t('chatWizardIntro')}</p>
 <div className="wizard-readiness"><p><strong>{t('chatReady')}</strong> {t(presentation.ready)}</p><p><strong>{t('chatMissing')}</strong> {t(presentation.next)}</p></div>
 <p className="field-hint">{t('chatAuthNotModel')}</p><ErrorNotice error={error}/>
 {presentation.action==='prepare'&&<button type="button" className="button primary" disabled={busy} onClick={()=>void run(async()=>{setHelper(await api<Helper>(`/households/${householdId}/ai/chatgpt/helper`,'POST',{}));setStep(1)})}><Icon name="arrow"/>{t('chatPrepare')}</button>}
 {helper&&presentation.showSteps&&<><ol className="wizard-progress" aria-label={t('chatProgress')}>{[1,2,3].map(value=><li key={value} aria-current={step===value?'step':undefined}>{t(value===1?'chatLocalStep':value===2?'chatTransferStep':'chatVerifyStep')}</li>)}</ol><p className="field-hint">{t('chatManualProgressHint')}</p>
 {step===1&&<div className="form-stack"><h4>{t('chatLocalStep')}</h4><p>{t('chatLocalInstructions')}</p><div className="ai-source-links">{helper.downloads.map(file=><a key={file.name} href={file.url} download>{t('aiDownloadFile',{name:file.name})}</a>)}</div><pre><code>{helper.localCommand}</code></pre><p>{t('chatConsentInstructions')}</p><button type="button" className="button primary" onClick={()=>setStep(2)}>{t('chatConsentDone')}</button></div>}
 {step===2&&<div className="form-stack"><h4>{t('chatTransferStep')}</h4><p>{t('chatTransferInstructions')}</p>{helper.transferCommand&&<pre><code>{helper.transferCommand}</code></pre>}<p>{t('chatOperatorInstructions')}</p><pre><code>{helper.serverImportCommand}</code></pre><p className="field-hint">{t('chatKeepPrivate')}</p><a href="https://github.com/pabben/samvev/blob/feat/m3-family-hub/docs/CHATGPT_PLAN_CONNECTION.md" target="_blank" rel="noreferrer">{t('aiConnectionGuide')}</a><div className="form-actions"><button type="button" className="button" onClick={()=>setStep(1)}>{t('back')}</button><button type="button" className="button primary" onClick={()=>setStep(3)}>{t('chatImportDone')}</button></div></div>}
 {step===3&&<div className="form-stack"><h4>{t('chatVerifyStep')}</h4><p>{t('chatVerifyInstructions')}</p><p role="status">{t('chatWaitingImport')}</p><button type="button" className="button primary" disabled={busy} onClick={()=>void run(onRefresh)}>{t('aiRefreshConnection')}</button><button type="button" className="button" onClick={()=>setStep(2)}>{t('back')}</button></div>}
 <details><summary>{t('aiStableHost')}</summary><code>{helper.hostId}</code></details></>}
 {presentation.action==='refresh'&&!presentation.showSteps&&<button type="button" className="button" disabled={busy} onClick={()=>void run(onRefresh)}>{t('aiRefreshConnection')}</button>}
 {presentation.action==='configure'&&<p className="notice">{t('chatConnectedNext')}</p>}
 {presentation.showUsage&&<a className="ai-usage-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">{t('aiAccountUsage')}<Icon name="arrow"/></a>}
 <details className="google-ai-assessment"><summary>{t('chatGoogleAlternative')}</summary><p>{t('chatGoogleUnavailable')}</p><p>{t('chatGoogleCredits')}</p><p>{t('chatCalendarSeparate')}</p><a href="https://developers.google.com/program/plans-and-pricing" target="_blank" rel="noreferrer">{t('chatGoogleOfficial')}</a> · <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer">{t('chatGoogleBilling')}</a></details>
 </section>;
}
