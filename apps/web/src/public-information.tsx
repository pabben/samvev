import {useEffect,useState} from 'react';
import {api} from './api';
import {Brand,LocaleProvider,PrefControls,useI18n,usePreferences} from './ui';
import type {TranslationKey} from './locales/en';

type PublicContact={operatorName:string;postalAddress:string;contactEmail:string};
type PageKind='about'|'privacy'|'terms';
const sectionKeys:Record<PageKind,Array<{title:TranslationKey;body:TranslationKey}>>={
  about:[{title:'publicAboutUse',body:'publicAboutUseBody'}],
  privacy:[
    {title:'publicPrivacyController',body:'publicPrivacyControllerBody'},
    {title:'publicPrivacyStored',body:'publicPrivacyStoredBody'},
    {title:'publicPrivacyCalendars',body:'publicPrivacyCalendarsBody'},
    {title:'publicPrivacyAI',body:'publicPrivacyAIBody'},
    {title:'publicPrivacyMessages',body:'publicPrivacyMessagesBody'},
    {title:'publicPrivacyMedia',body:'publicPrivacyMediaBody'},
    {title:'publicPrivacyHome',body:'publicPrivacyHomeBody'},
    {title:'publicPrivacySecurity',body:'publicPrivacySecurityBody'},
    {title:'publicPrivacyRetention',body:'publicPrivacyRetentionBody'},
  ],
  terms:[
    {title:'publicTermsAccounts',body:'publicTermsAccountsBody'},
    {title:'publicTermsIntegrations',body:'publicTermsIntegrationsBody'},
    {title:'publicTermsSafety',body:'publicTermsSafetyBody'},
    {title:'publicTermsAvailability',body:'publicTermsAvailabilityBody'},
  ],
};
const titleKey:Record<PageKind,TranslationKey>={about:'publicAboutTitle',privacy:'publicPrivacyTitle',terms:'publicTermsTitle'};
const leadKey:Record<PageKind,TranslationKey>={about:'publicAboutLead',privacy:'publicPrivacyLead',terms:'publicTermsLead'};
function kindFromPath(path:string):PageKind{return path==='/personvern'?'privacy':path==='/vilkar'?'terms':'about';}

export function PublicInformation(){
  const [prefs,setPrefs]=usePreferences();
  return <LocaleProvider locale={prefs.locale}><PublicPage prefs={prefs} setPrefs={setPrefs} kind={kindFromPath(location.pathname)}/></LocaleProvider>;
}
function PublicPage({prefs,setPrefs,kind}:{prefs:ReturnType<typeof usePreferences>[0];setPrefs:ReturnType<typeof usePreferences>[1];kind:PageKind}){
  const {t,locale}=useI18n();const [contact,setContact]=useState<PublicContact|null>(null);const [contactUnavailable,setContactUnavailable]=useState(false);
  useEffect(()=>{document.title=`${t(titleKey[kind])} · Samvev`;},[kind,locale,t]);
  useEffect(()=>{let active=true;void api<{contact:PublicContact|null}>('/public/contact').then(result=>{if(active)setContact(result.contact)}).catch(()=>{if(active)setContactUnavailable(true)});return()=>{active=false};},[]);
  const headings:Record<PageKind,TranslationKey>={about:'publicAboutTitle',privacy:'publicPrivacyTitle',terms:'publicTermsTitle'};
  return <div className="public-page public-information-page">
    <header className="public-header public-information-header"><Brand/><PrefControls prefs={prefs} onChange={setPrefs}/></header>
    <main className="public-information-content" id="main">
      <div className="public-information-kicker">Samvev</div>
      <h1>{t(headings[kind])}</h1>
      <p className="public-information-lead">{t(leadKey[kind])}</p>
      {kind==='about'&&<p>{t('publicAboutBody')}</p>}
      {sectionKeys[kind].map(section=><section key={section.title} className="public-information-section"><h2>{t(section.title)}</h2><p>{t(section.body)}</p></section>)}
      {kind==='about'&&<section className="public-information-section" id="contact"><h2>{t('publicAboutOperator')}</h2>{contactUnavailable?<p>{t('publicRefreshContact')}</p>:contact?<dl className="public-contact-list"><dt>{t('publicOperator')}</dt><dd>{contact.operatorName}</dd><dt>{t('publicAddress')}</dt><dd>{contact.postalAddress.split(/\r?\n/).map((line,index,lines)=><span key={`${index}-${line}`}>{line}{index<lines.length-1&&<br/>}</span>)}</dd><dt>{t('publicEmail')}</dt><dd><a href={`mailto:${contact.contactEmail}`}>{contact.contactEmail}</a></dd></dl>:<p>{t('publicContactPending')}</p>}</section>}
      {kind==='privacy'&&<section className="public-information-section" id="contact"><h2>{t('publicPrivacyContact')}</h2>{contactUnavailable?<p>{t('publicRefreshContact')}</p>:contact?<dl className="public-contact-list"><dt>{t('publicOperator')}</dt><dd>{contact.operatorName}</dd><dt>{t('publicAddress')}</dt><dd>{contact.postalAddress.split(/\r?\n/).map((line,index,lines)=><span key={`${index}-${line}`}>{line}{index<lines.length-1&&<br/>}</span>)}</dd><dt>{t('publicEmail')}</dt><dd><a href={`mailto:${contact.contactEmail}`}>{contact.contactEmail}</a></dd></dl>:<p>{t('publicContactPending')}</p>}</section>}
      {kind==='terms'&&<section className="public-information-section" id="contact"><h2>{t('publicTermsContact')}</h2>{contactUnavailable?<p>{t('publicRefreshContact')}</p>:contact?<p><a href={`mailto:${contact.contactEmail}`}>{contact.contactEmail}</a></p>:<p>{t('publicContactPending')}</p>}</section>}
    </main>
    <footer className="public-information-footer" aria-label={t('publicHelp')}>
      <nav aria-label={t('publicHelp')}>
        <a href="/om" aria-current={kind==='about'?'page':undefined}>{t('publicNavAbout')}</a>
        <a href="/personvern" aria-current={kind==='privacy'?'page':undefined}>{t('publicNavPrivacy')}</a>
        <a href="/vilkar" aria-current={kind==='terms'?'page':undefined}>{t('publicNavTerms')}</a>
        <a href="/personvern#contact">{t('publicHelp')}</a>
      </nav>
      <div className="public-information-utility"><a href="/">{t('publicLogin')}</a><a href="/?tab=integrations">{t('publicSettings')}</a></div>
    </footer>
  </div>;
}
