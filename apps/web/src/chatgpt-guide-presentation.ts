import type {TranslationKey} from './locales/en';
export interface ChatGptGuidePresentation {
 ready:TranslationKey;
 next:TranslationKey;
 action:'prepare'|'local_consent'|'server_import'|'refresh'|'configure';
 showSteps:boolean;
 showUsage:boolean;
}
/** Server registration state takes precedence over manually reported wizard progress. */
export function chatGptGuidePresentation(status:string|undefined,prepared:boolean,step:number):ChatGptGuidePresentation {
 if(status==='connected')return{ready:'chatReadyConnected',next:'chatMissingModel',action:'configure',showSteps:false,showUsage:false};
 if(status==='pending_validation')return{ready:'chatPendingImported',next:'chatPendingValidation',action:'refresh',showSteps:false,showUsage:false};
 if(status==='usage_limited')return{ready:'chatReadyLimited',next:'chatMissingLimit',action:'refresh',showSteps:false,showUsage:true};
 if(status==='not_eligible')return{ready:'chatPendingImported',next:'chatMissingEligibility',action:'refresh',showSteps:false,showUsage:true};
 if(!prepared)return{ready:'chatReadyServer',next:status==='reauthorization_required'?'chatMissingReauth':status==='revocation_unconfirmed'?'chatRevocationNext':'chatMissingHelper',action:'prepare',showSteps:false,showUsage:status==='revocation_unconfirmed'};
 if(step>=3)return{ready:'chatImportReported',next:'chatMissingVerification',action:'refresh',showSteps:true,showUsage:false};
 if(step===2)return{ready:'chatConsentReported',next:'chatMissingImport',action:'server_import',showSteps:true,showUsage:false};
 return{ready:'chatReadyHelper',next:'chatMissingConsent',action:'local_consent',showSteps:true,showUsage:false};
}
