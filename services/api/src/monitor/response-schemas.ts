import type { AiTask } from '@samvev/contracts';

type ResponseSchema=NonNullable<AiTask['responseSchema']>;

const stringArray=(maxItems:number,maxLength:number)=>({type:'array',items:{type:'string',minLength:1,maxLength},maxItems});
const locale={type:'string',enum:['nb','en']};
const confidence={type:'number',minimum:0,maximum:1};
const uncertainty={type:['string','null'],maxLength:500};

export const monitorInterpretationResponseSchema:ResponseSchema={
  name:'monitor_interpretation',
  schema:{type:'object',additionalProperties:false,properties:{
    version:{type:'integer',const:1},resultKind:{type:'string',enum:['events','answer']},summary:{type:'string',minLength:1,maxLength:500},
    eventTypes:stringArray(20,80),keywords:stringArray(50,80),people:stringArray(20,80),noticeDaysBefore:{type:'integer',minimum:0,maximum:30},
    noticeLocalTime:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$'},checkIntervalMinutes:{type:'integer',minimum:15,maximum:10080},
    conditionalNotification:{type:'boolean'},tools:{type:'array',items:{type:'string',enum:['web.open','weather.forecast']},minItems:1,maxItems:6,uniqueItems:true},
    location:{type:'object',additionalProperties:false,properties:{query:{type:'string',minLength:1,maxLength:200},canonicalName:{type:'string',minLength:1,maxLength:200},municipality:{type:'string',minLength:1,maxLength:120},region:{type:'string',minLength:1,maxLength:120},country:{type:'string',minLength:1,maxLength:120}},required:['query']}
  },required:['version','resultKind','summary','eventTypes','keywords','people','noticeDaysBefore','noticeLocalTime','checkIntervalMinutes','conditionalNotification','tools']}
};

export const monitorAnswerResponseSchema:ResponseSchema={
  name:'monitor_answer',
  schema:{type:'object',additionalProperties:false,properties:{
    version:{type:'integer',const:1},outputLocale:locale,answer:{type:'string',minLength:1,maxLength:4000},
    evidence:{type:'object',additionalProperties:false,properties:{quote:{type:'string',minLength:1,maxLength:1000},sourceUrl:{type:'string',format:'uri',maxLength:2048},claims:stringArray(20,500)},required:['quote']},
    confidence,uncertainty
  },required:['version','outputLocale','answer','evidence','confidence','uncertainty']}
};

const evidenceSource={type:'object',additionalProperties:false,properties:{
  quote:{type:'string',minLength:1,maxLength:1000},sourceUrl:{type:'string',format:'uri',maxLength:2048},claims:stringArray(20,500)
},required:['quote','claims']};
const eventEvidence={anyOf:[
  {type:'object',additionalProperties:false,properties:{quote:{type:'string',minLength:1,maxLength:500},sourceUrl:{type:'string',format:'uri',maxLength:2048},claims:stringArray(20,500)},required:['quote','claims']},
  {type:'object',additionalProperties:false,properties:{quote:{type:'string',minLength:1,maxLength:500},sourceUrl:{type:'string',format:'uri',maxLength:2048},claims:stringArray(20,500),sources:{type:'array',items:evidenceSource,minItems:1,maxItems:6}},required:['quote','claims','sources']}
]};

export const monitorEventsResponseSchema:ResponseSchema={
  name:'monitor_events',
  schema:{type:'object',additionalProperties:false,properties:{
    version:{type:'integer',const:1},outputLocale:locale,events:{type:'array',maxItems:200,items:{type:'object',additionalProperties:false,properties:{
      date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},time:{type:['string','null'],pattern:'^([01]\\d|2[0-3]):[0-5]\\d$'},type:{type:'string',minLength:1,maxLength:80},
      description:{type:'string',minLength:1,maxLength:500},actions:stringArray(20,200),who:stringArray(20,80),evidence:eventEvidence,confidence,uncertainty
    },required:['date','time','type','description','actions','who','evidence','confidence','uncertainty']}}
  },required:['version','outputLocale','events']}
};

/** A compact semantic decision. Samvev resolves URLs and presentation from
 * exact server-held excerpts, so a provider never creates provenance data. */
export const monitorCompositeDecisionResponseSchema:ResponseSchema={
  name:'monitor_composite_decision',
  schema:{type:'object',additionalProperties:false,properties:{
    version:{type:'integer',const:1},outputLocale:locale,events:{type:'array',maxItems:200,items:{type:'object',additionalProperties:false,properties:{
      date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},time:{type:['string','null'],pattern:'^([01]\\d|2[0-3]):[0-5]\\d$'},activityQuote:{type:'string',minLength:1,maxLength:500},weatherQuote:{type:'string',minLength:1,maxLength:1000},confidence,uncertainty
    },required:['date','time','activityQuote','weatherQuote','confidence','uncertainty']}}
  },required:['version','outputLocale','events']}
};
