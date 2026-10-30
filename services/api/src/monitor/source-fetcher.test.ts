import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SUBSCRIPTION_BYTES, maxIcsSubscriptionBytes, MonitorSourceFetcher, SecretSubscriptionFetcher, isBlockedMonitorAddress, isCalendarSubscriptionUrl, isGoogleCalendarViewUrl, normalizeMonitorUrl, normalizeSecretSubscriptionUrl, selectRelevantSource, sourceUrlFromInstruction } from './source-fetcher.ts';

const resolver=async()=>[{address:'93.184.216.34',family:4 as const}];
const response=(body:string|Buffer,type:string,status=200,location?:string)=>({status,headers:{'content-type':type,location,etag:undefined,'last-modified':undefined},body:Buffer.isBuffer(body)?body:Buffer.from(body)});

function minimalPdf(text:string):Buffer{
  const stream=`BT /F1 12 Tf 20 100 Td (${text}) Tj ET\n`;const objects=[`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,`5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const object of objects){offsets.push(Buffer.byteLength(pdf));pdf+=object;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((value)=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}

test('monitor URL policy permits public HTTP(S) and blocks internal and metadata targets',()=>{
  assert.equal(normalizeMonitorUrl('https://example.com/week#today'),'https://example.com/week');
  assert.equal(normalizeMonitorUrl('https://example.com/week?day=1'),'https://example.com/week?day=1');
  for(const address of ['127.0.0.1','10.0.0.4','192.168.1.10','169.254.169.254','::1','fd00::1','fec0::1','64:ff9b::a9fe:a9fe','2002:a9fe:a9fe::'])assert.equal(isBlockedMonitorAddress(address),true,address);
  assert.throws(()=>normalizeMonitorUrl('http://metadata.google.internal/latest'));
  assert.throws(()=>normalizeMonitorUrl('http://user:password@example.com/'));
  for(const key of ['token','Access_Token','access%2Etoken','refresh-token','id.token','api-key','api%20key','key','AUTH','Authorization','bearer','jwt','credential','pass_word','secret','client.secret','signature','shared-access-signature','sas_token','sig','session','cookie','security_token','sr','st','spr','X-Amz-Signature','x_amz_credential','X-Goog-Security-Token'])assert.throws(()=>normalizeMonitorUrl(`https://example.com/?${key}=must-not-survive`),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED',key);
  for(const key of ['day','page','sort','sv','sp','se'])assert.equal(normalizeMonitorUrl(`https://example.com/?${key}=1`),`https://example.com/?${key}=1`);
});

test('natural instructions yield one explicit, normalized and approved source',()=>{
  assert.equal(sourceUrlFromInstruction('Sjekk nrk.no og presenter toppsaken'),'https://nrk.no/');
  assert.equal(sourceUrlFromInstruction('Read https://example.com/news?day=1#top now'),'https://example.com/news?day=1');
  assert.equal(sourceUrlFromInstruction('Sjekk nrk.no','https://example.com/manual'),'https://example.com/manual');
  assert.throws(()=>sourceUrlFromInstruction('Send resultatet til reader@example.com'),(error:any)=>error.code==='MONITOR_SOURCE_REQUIRED');
  assert.throws(()=>sourceUrlFromInstruction('Finn dagens toppsak'),(error:any)=>error.code==='MONITOR_SOURCE_REQUIRED');
  assert.throws(()=>sourceUrlFromInstruction('Sammenlign nrk.no med example.com'),(error:any)=>error.code==='MONITOR_SOURCE_AMBIGUOUS');
  for(const instruction of ['Sjekk http://127.0.0.1/private','Sjekk 127.0.0.1:8080/private','Sjekk 169.254.169.254/latest','Sjekk http://169.254.169.254/latest','Sjekk metadata.google.internal'])assert.throws(()=>sourceUrlFromInstruction(instruction),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
  for(const instruction of ['Sjekk https://example.com/?access-token=hidden','Read example.com/news?X-Goog-Signature=hidden'])assert.throws(()=>sourceUrlFromInstruction(instruction),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
});

test('HTML is normalized and unchanged relevant content has a stable fingerprint',async()=>{
  let calls=0;const fetcher=new MonitorSourceFetcher(resolver,async()=>{calls++;return response('<html><head><title>Weekly plan</title></head><style>x</style><h1>Plan</h1><p>Trip 2030-09-20</p><a href="/details#today">Details</a></html>','text/html');});
  const first=await fetcher.fetch('https://example.com/plan');const second=await fetcher.fetch('https://example.com/plan');
  assert.equal(first.text,'Weekly plan\nPlan\nTrip 2030-09-20\nDetails');assert.equal(first.title,'Weekly plan');assert.deepEqual(first.headings,['Plan']);assert.deepEqual(first.links,[{url:'https://example.com/details',label:'Details'}]);assert.match(first.fetchedAt!,/^\d{4}-/);assert.equal(first.fingerprint,second.fingerprint);assert.equal(calls,2);
  assert.equal(first.httpStatus,200);assert.ok(first.byteSize&&first.byteSize>0);
});

test('HTML extraction retains meaningful links beyond navigation-heavy page starts',async()=>{
  const navigation=Array.from({length:120},(_,index)=>`<a href="/menu-${index}">Menu ${index}</a>`).join('');
  const article='<article><a href="/2026/09/public-report">Detailed public report about today</a></article>';
  const fetcher=new MonitorSourceFetcher(resolver,async()=>response(`<html><body>${navigation}${article}</body></html>`,'text/html'));
  const source=await fetcher.fetch('https://example.com/');assert.equal(source.links?.length,121);assert.ok(source.links?.some((link)=>link.url==='https://example.com/2026/09/public-report'));
});

test('semantic main content excludes global and nested navigation while retaining editorial content',async()=>{
  const html=`<html><head><title>Public news</title></head><body>
    <header><h1>Global heading</h1><a href="/global">Global link</a></header>
    <main><nav><h2>Main menu</h2><a href="/menu">Menu link</a></nav>
      <article><h1>Editorial headline</h1><p>Editorial lead.</p><a href="/story"><script>hydration payload must disappear</script>Read the full story<style>.hidden{display:none}</style></a></article>
      <footer><a href="/privacy">Privacy</a></footer>
    </main></body></html>`;
  const fetcher=new MonitorSourceFetcher(resolver,async()=>response(html,'text/html'));const source=await fetcher.fetch('https://example.com/');
  assert.equal(source.title,'Public news');assert.deepEqual(source.headings,['Editorial headline']);assert.deepEqual(source.links,[{url:'https://example.com/story',label:'Read the full story'}]);
  assert.equal(source.text,'Editorial headline\nEditorial lead.\nRead the full story');assert.ok(!source.text.includes('Global heading'));assert.ok(!source.text.includes('Main menu'));assert.ok(!source.links?.[0]?.label.includes('hydration'));
});

test('HTML headings retain DOM order for deterministic first-headline semantics',async()=>{
  const fetcher=new MonitorSourceFetcher(resolver,async()=>response('<main><h1>First editorial headline</h1><h2>Second editorial headline</h2></main>','text/html'));
  const source=await fetcher.fetch('https://example.com/');assert.deepEqual(source.headings,['First editorial headline','Second editorial headline']);
});

test('link labels prefer the first semantic heading and plain anchors retain cleaned text',async()=>{
  const html='<main><a href="/card"><h2>First card headline</h2><h3>Secondary heading</h3><p>Card summary</p></a><a href="/plain"><span>Plain anchor label</span></a></main>';
  const fetcher=new MonitorSourceFetcher(resolver,async()=>response(html,'text/html'));const source=await fetcher.fetch('https://example.com/');
  assert.deepEqual(source.links,[{url:'https://example.com/card',label:'First card headline'},{url:'https://example.com/plain',label:'Plain anchor label'}]);
});

test('HTML without a main landmark retains the full-document fallback',async()=>{
  const fetcher=new MonitorSourceFetcher(resolver,async()=>response('<header><h1>Fallback heading</h1></header><p>Fallback body</p><a href="/fallback">Fallback link</a>','text/html'));
  const source=await fetcher.fetch('https://example.com/');assert.deepEqual(source.headings,['Fallback heading']);assert.deepEqual(source.links,[{url:'https://example.com/fallback',label:'Fallback link'}]);assert.match(source.text,/Fallback heading/);assert.match(source.text,/Fallback body/);
});

test('linked PDF discovery follows a link inside main and ignores one outside main',async()=>{
  const pdf=minimalPdf('Main PDF content');let fetchedPath='';
  const fetcher=new MonitorSourceFetcher(resolver,async(url)=>{fetchedPath=url.pathname;return url.pathname==='/main.pdf'?response(pdf,'application/pdf'):response('<a href="/outside.pdf">Outside PDF</a><main><a href="/main.pdf">Main PDF</a></main>','text/html');});
  const source=await fetcher.fetch('https://example.com/');assert.equal(fetchedPath,'/main.pdf');assert.equal(source.finalUrl,'https://example.com/main.pdf');assert.equal(source.contentType,'application/pdf');assert.match(source.text,/Main PDF content/);
});

test('approved rule terms ignore unrelated source chrome changes',()=>{
  const base={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'Header version 1\nNavigation\nTrip day 2030-09-20\nBring boots\nFooter',fingerprint:'raw-one'};
  const rule={eventTypes:['trip day'],keywords:['trip'],people:[]};const first=selectRelevantSource(base,rule);const chrome=selectRelevantSource({...base,text:base.text.replace('Header version 1','Header version 2'),fingerprint:'raw-two'},rule);const relevant=selectRelevantSource({...base,text:base.text.replace('2030-09-20','2030-09-21'),fingerprint:'raw-three'},rule);
  assert.equal(first.text,'Navigation\nTrip day 2030-09-20\nBring boots');assert.equal(first.fingerprint,chrome.fingerprint);assert.notEqual(first.fingerprint,relevant.fingerprint);
});

test('direct and linked text PDFs are extracted without browser automation',async()=>{
  const pdf=minimalPdf('Trip day 2030-09-20');
  const direct=new MonitorSourceFetcher(resolver,async()=>response(pdf,'application/pdf'));
  assert.match((await direct.fetch('https://example.com/plan.pdf')).text,/Trip day 2030-09-20/);
  const linked=new MonitorSourceFetcher(resolver,async(url)=>url.pathname.endsWith('.pdf')?response(pdf,'application/pdf'):response('<a href="/plan.pdf">PDF</a>','text/html'));
  const result=await linked.fetch('https://example.com/index');assert.equal(result.contentType,'application/pdf');assert.equal(result.finalUrl,'https://example.com/plan.pdf');
});

test('redirect destinations are revalidated and response types and sizes are bounded',async()=>{
  const redirect=new MonitorSourceFetcher(resolver,async()=>response('', 'text/html',302,'http://127.0.0.1/private'));
  await assert.rejects(()=>redirect.fetch('https://example.com/start'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
  const unsupported=new MonitorSourceFetcher(resolver,async()=>response('{}','application/json'));
  await assert.rejects(()=>unsupported.fetch('https://example.com/data'),(error:any)=>error.code==='MONITOR_SOURCE_UNSUPPORTED');
  const huge=new MonitorSourceFetcher(resolver,async()=>response(Buffer.alloc(5*1024*1024+1),'text/html'));
  await assert.rejects(()=>huge.fetch('https://example.com/huge'));
});

test('source fetch has a network and DNS deadline',async()=>{
  const fetcher=new MonitorSourceFetcher(resolver,async(_url,_target,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})),20);
  await assert.rejects(()=>fetcher.fetch('https://example.com/slow'),(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='source_deadline'&&error.details.sourceFetchPhase==='request'&&Object.keys(error.details).sort().join(',')==='sourceFetchCause,sourceFetchPhase');
});

test('source fetch timeout diagnostics distinguish caller abort, DNS deadline and redirect phase without URL data',async()=>{
  const caller=new AbortController();const callerFetcher=new MonitorSourceFetcher(resolver,async(_url,_target,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})),200);
  const callerRun=callerFetcher.fetch('https://example.com/private?page=never-report',{signal:caller.signal});setTimeout(()=>caller.abort(),5);
  await assert.rejects(()=>callerRun,(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='caller_abort'&&error.details.sourceFetchPhase==='request'&&!JSON.stringify(error.details).includes('private')&&!JSON.stringify(error.details).includes('token'));

  const dnsFetcher=new MonitorSourceFetcher((_hostname)=>new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('synthetic resolver failure')),80)),async()=>response('unused','text/html'),10);
  await assert.rejects(()=>dnsFetcher.fetch('https://example.com/private'),(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='source_deadline'&&error.details.sourceFetchPhase==='dns'&&Object.keys(error.details).sort().join(',')==='sourceFetchCause,sourceFetchPhase');

  let requests=0;const redirectFetcher=new MonitorSourceFetcher(resolver,async(_url,_target,signal)=>{requests++;if(requests===1)return response('','text/html',302,'/next');return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));},10);
  await assert.rejects(()=>redirectFetcher.fetch('https://example.com/start'),(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='source_deadline'&&error.details.sourceFetchPhase==='redirect'&&requests===2&&Object.keys(error.details).sort().join(',')==='sourceFetchCause,sourceFetchPhase');

  const pdfFetcher=new MonitorSourceFetcher(resolver,async()=>response('%PDF synthetic','application/pdf'),10,async(_bytes,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})));
  await assert.rejects(()=>pdfFetcher.fetch('https://example.com/plan.pdf'),(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='source_deadline'&&error.details.sourceFetchPhase==='pdf'&&Object.keys(error.details).sort().join(',')==='sourceFetchCause,sourceFetchPhase');

  const slowPdfParser=new MonitorSourceFetcher(resolver,async()=>response('%PDF synthetic','application/pdf'),5,async()=>new Promise((resolve)=>setTimeout(()=>resolve('late synthetic extraction'),30)));
  const laterCallerAbort=new AbortController();const slowPdfRun=slowPdfParser.fetch('https://example.com/slow.pdf',{signal:laterCallerAbort.signal});setTimeout(()=>laterCallerAbort.abort(),10);
  await assert.rejects(()=>slowPdfRun,(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='source_deadline'&&error.details.sourceFetchPhase==='pdf');
});

test('DNS answers are all validated and the accepted address is pinned',async()=>{
  let transportCalls=0;const mixed=new MonitorSourceFetcher(async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.9',family:4}],async()=>{transportCalls++;return response('x','text/html');});
  await assert.rejects(()=>mixed.fetch('https://example.com/plan'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');assert.equal(transportCalls,0);
  let pinned='';const publicOnly=new MonitorSourceFetcher(resolver,async(_url,target)=>{pinned=target.address;return response('safe','text/html');});await publicOnly.fetch('https://example.com/plan');assert.equal(pinned,'93.184.216.34');
});

test('linked PDF redirects and redirect exhaustion use the same URL policy',async()=>{
  const linkedPrivate=new MonitorSourceFetcher(resolver,async(url)=>url.pathname==='/index'?response('<a href="/plan.pdf">PDF</a>','text/html'):response('','application/pdf',302,'http://192.168.1.2/private.pdf'));
  await assert.rejects(()=>linkedPrivate.fetch('https://example.com/index'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
  let calls=0;const endless=new MonitorSourceFetcher(resolver,async()=>{calls++;return response('','text/html',302,'/again');});await assert.rejects(()=>endless.fetch('https://example.com/start'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE');assert.equal(calls,4);
});

test('linked PDF redirect timeout keeps redirect phase after destination DNS resolves',async()=>{
  const paths:string[]=[];const fetcher=new MonitorSourceFetcher(resolver,async(url,_target,signal)=>{
    paths.push(url.pathname);
    if(url.pathname==='/index')return response('<main><a href="/plan.pdf">Plan</a></main>','text/html');
    if(url.pathname==='/plan.pdf')return response('','application/pdf',302,'/cdn-plan.pdf');
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  },10);
  await assert.rejects(()=>fetcher.fetch('https://example.com/index'),(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT'&&error.details.sourceFetchCause==='source_deadline'&&error.details.sourceFetchPhase==='redirect'&&paths.join(',')==='/index,/plan.pdf,/cdn-plan.pdf');
});

test('agent link fetches reject cross-origin redirects before following them',async()=>{
  let calls=0;const fetcher=new MonitorSourceFetcher(resolver,async()=>{calls++;return response('', 'text/html',302,'https://other.example/path');});
  await assert.rejects(()=>fetcher.fetch('https://example.com/news',{followLinkedPdf:false,redirectOrigin:'https://example.com'}),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');assert.equal(calls,1);
});

test('secret calendar URLs preserve opaque query credentials but keep the pinned SSRF boundary',async()=>{
  assert.equal(normalizeSecretSubscriptionUrl('https://calendar.example/feed.ics?token=opaque#ignored'),'https://calendar.example/feed.ics?token=opaque');
  assert.equal(normalizeSecretSubscriptionUrl('webcal://calendar.example/feed.ics?token=opaque'),'https://calendar.example/feed.ics?token=opaque');
  for(const url of ['http://calendar.example/feed.ics','https://user:secret@calendar.example/feed.ics','https://127.0.0.1/feed.ics','https://metadata.google.internal/feed.ics'])assert.throws(()=>normalizeSecretSubscriptionUrl(url),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
  let calls=0;const fetcher=new SecretSubscriptionFetcher(resolver,async()=>{calls++;return response('', 'text/calendar',302,'https://10.0.0.8/private.ics');});
  await assert.rejects(()=>fetcher.fetch('https://calendar.example/feed.ics?token=opaque'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');assert.equal(calls,1);
});

test('secret calendar responses require bounded calendar content',async()=>{
  const valid=new SecretSubscriptionFetcher(resolver,async()=>response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n','text/calendar'));
  assert.match(await valid.fetch('https://calendar.example/feed.ics?token=opaque'),/BEGIN:VCALENDAR/);
  const invalid=new SecretSubscriptionFetcher(resolver,async()=>response('<html>not a calendar</html>','text/html'));
  await assert.rejects(()=>invalid.fetch('https://calendar.example/feed.ics'),(error:any)=>error.code==='CALENDAR_ICS_UNSUPPORTED'&&error.details.reason==='calendar_ics_media_type_unsupported');
});

test('ICS fetch admission caps whole downloads across instances and releases successful slots',async()=>{
  const valid=Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');let calls=0,waiting=0,holding=true,release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),fourStarted=new Promise<void>(resolve=>{started=resolve;});
  const transport=async()=>{calls++;if(holding){waiting++;if(waiting===4)started();await gate;}return response(valid,'text/calendar');};
  const first=new SecretSubscriptionFetcher(resolver,transport),second=new SecretSubscriptionFetcher(resolver,transport);
  const pending=Array.from({length:4},()=>first.fetch('https://calendar.example/held.ics'));await fourStarted;
  await assert.rejects(()=>second.fetch('https://calendar.example/overflow.ics'),(error:any)=>error.code==='CALENDAR_ICS_BUSY'&&error.status===503&&error.details.reason==='calendar_ics_fetch_busy'&&error.details.maxConcurrent===4);
  assert.equal(calls,4,'over-cap fetches fail immediately without starting or queueing another transport');
  holding=false;release();await Promise.all(pending);assert.match(await second.fetch('https://calendar.example/released.ics'),/BEGIN:VCALENDAR/);assert.equal(calls,5,'the slot is reusable after successful fetch and conversion');
});

test('ICS fetch admission slots are released on network errors and timeouts',async()=>{
  const valid=()=>response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n','text/calendar');let fail=true;
  const failing=new SecretSubscriptionFetcher(resolver,async()=>{if(fail){fail=false;throw new Error('synthetic fetch failure');}return valid();});
  await assert.rejects(()=>failing.fetch('https://calendar.example/error.ics'),(error:any)=>error.code==='CALENDAR_ICS_NETWORK_ERROR');assert.match(await failing.fetch('https://calendar.example/released-after-error.ics'),/BEGIN:VCALENDAR/);
  let block=true;const timed=new SecretSubscriptionFetcher(resolver,async(_url,_target,signal)=>block?new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})):valid(),20);
  await assert.rejects(()=>timed.fetch('https://calendar.example/timeout.ics'),(error:any)=>error.code==='CALENDAR_ICS_TIMEOUT');block=false;assert.match(await timed.fetch('https://calendar.example/released-after-timeout.ics'),/BEGIN:VCALENDAR/);
});

test('ICS fetch accepts synthetic files above 5 MiB within the configured bounded cap',async()=>{
  const large=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-PADDING:${'x'.repeat(5*1024*1024+128)}\r\nEND:VCALENDAR\r\n`;
  assert.ok(Buffer.byteLength(large)>5*1024*1024);assert.ok(Buffer.byteLength(large)<=MAX_SUBSCRIPTION_BYTES);
  const fetcher=new SecretSubscriptionFetcher(resolver,async()=>response(Buffer.from(large),'text/calendar'));
  const fetched=await fetcher.fetch('https://calendar.example/large-synthetic.ics');assert.equal(Buffer.byteLength(fetched),Buffer.byteLength(large));
});

test('ICS cap can be raised to 10 MiB but values above the hard ceiling fall back to 8 MiB',async()=>{
  const previous=process.env.SAMVEV_ICS_MAX_BYTES;
  try{
    process.env.SAMVEV_ICS_MAX_BYTES=String(10*1024*1024);assert.equal(maxIcsSubscriptionBytes(),10*1024*1024);
    const large=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-PADDING:${'x'.repeat(9*1024*1024)}\r\nEND:VCALENDAR\r\n`;
    let options:any;const within=new SecretSubscriptionFetcher(resolver,async(_url,_target,_signal,limits)=>{options=limits;return response(Buffer.from(large),'text/calendar');});
    assert.equal(Buffer.byteLength(await within.fetch('https://calendar.example/configured-large.ics')),Buffer.byteLength(large));assert.equal(options.maxBytes,10*1024*1024);
    process.env.SAMVEV_ICS_MAX_BYTES=String(16*1024*1024);assert.equal(maxIcsSubscriptionBytes(),16*1024*1024);
    process.env.SAMVEV_ICS_MAX_BYTES=String(17*1024*1024);assert.equal(maxIcsSubscriptionBytes(),8*1024*1024);
    process.env.SAMVEV_ICS_MAX_BYTES=String(4*1024*1024);assert.equal(maxIcsSubscriptionBytes(),8*1024*1024);
    const bounded=new SecretSubscriptionFetcher(resolver,async()=>response(Buffer.from(large),'text/calendar'));
    await assert.rejects(()=>bounded.fetch('https://calendar.example/over-hard-cap.ics'),(error:any)=>error.code==='CALENDAR_ICS_TOO_LARGE'&&error.details.observedBytes===Buffer.byteLength(large)&&error.details.maxBytes===8*1024*1024);
  }finally{if(previous===undefined)delete process.env.SAMVEV_ICS_MAX_BYTES;else process.env.SAMVEV_ICS_MAX_BYTES=previous;}
});

test('ICS fetch selects calendar media types without changing monitor transport defaults',async()=>{
  let icsOptions:unknown,monitorOptions:unknown;
  const ics=new SecretSubscriptionFetcher(resolver,async(_url,_target,_signal,options)=>{icsOptions=options;return response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n','text/calendar');});
  await ics.fetch('https://calendar.example/feed.ics');
  assert.deepEqual(icsOptions,{maxBytes:MAX_SUBSCRIPTION_BYTES,tooLargeCode:'CALENDAR_ICS_TOO_LARGE',accept:'text/calendar, text/plain, application/octet-stream'});
  const monitor=new MonitorSourceFetcher(resolver,async(_url,_target,_signal,options)=>{monitorOptions=options;return response('<main>synthetic page</main>','text/html');});
  await monitor.fetch('https://example.com/page');
  assert.equal(monitorOptions,undefined);
});

test('ICS transport keeps its byte, redirect and request-time limits',async()=>{
  const tooLarge=new SecretSubscriptionFetcher(resolver,async()=>response(Buffer.alloc(MAX_SUBSCRIPTION_BYTES+1),'text/calendar'));
  await assert.rejects(()=>tooLarge.fetch('https://calendar.example/feed.ics'),(error:any)=>error.code==='CALENDAR_ICS_TOO_LARGE'&&error.details.reason==='calendar_ics_response_too_large'&&error.details.maxBytes===MAX_SUBSCRIPTION_BYTES);
  let redirects=0;const redirected=new SecretSubscriptionFetcher(resolver,async(url)=>{redirects++;return response('', 'text/calendar',302,`${url.protocol}//${url.hostname}/next.ics`);});
  await assert.rejects(()=>redirected.fetch('https://calendar.example/feed.ics'),(error:any)=>error.code==='CALENDAR_ICS_HTTP_ERROR'&&error.details.reason==='calendar_ics_redirect_limit');assert.equal(redirects,4);
  const timeout=new SecretSubscriptionFetcher(resolver,async(_url,_target,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})),20);
  await assert.rejects(()=>timeout.fetch('https://calendar.example/feed.ics'),(error:any)=>error.code==='CALENDAR_ICS_TIMEOUT'&&error.details.reason==='calendar_ics_request_timeout');
});

test('webcal subscriptions are fetched over HTTPS and every redirect stays HTTPS and pinned',async()=>{
  const urls:string[]=[];const seenAddresses:string[]=[];let calls=0;
  const fetcher=new SecretSubscriptionFetcher(async(hostname)=>{seenAddresses.push(hostname);return resolver();},async(url)=>{urls.push(url.toString());calls++;return calls===1?response('', 'text/calendar',302,'webcal://cdn.example/feed.ics'):response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n','text/calendar');});
  await fetcher.fetch('webcal://pub.fotmob.com/prod/pub/api/v2/calendar/team/8463.ics');
  assert.deepEqual(urls,['https://pub.fotmob.com/prod/pub/api/v2/calendar/team/8463.ics','https://cdn.example/feed.ics']);
  assert.deepEqual(seenAddresses,['pub.fotmob.com','cdn.example']);
});

test('Google calendar view links get ICS guidance while real ICS and ordinary pages keep their routes',async()=>{
  const view=new URL('https://calendar.google.com/calendar/u/0/r/week');
  const queryView=new URL('https://calendar.google.com/calendar/u/0?cid=synthetic-calendar-id');
  const simpleQueryView=new URL('https://calendar.google.com/calendar?cid=synthetic-calendar-id');
  const ical=new URL('https://calendar.google.com/calendar/ical/public/calendar.ics');
  assert.equal(isGoogleCalendarViewUrl(view),true);assert.equal(isCalendarSubscriptionUrl(view),true);assert.equal(isGoogleCalendarViewUrl(queryView),true);assert.equal(isGoogleCalendarViewUrl(simpleQueryView),true);
  assert.equal(isGoogleCalendarViewUrl(ical),false);assert.equal(isCalendarSubscriptionUrl(ical),true);
  let calls=0;const monitor=new MonitorSourceFetcher(resolver,async()=>{calls++;return response('<main>ordinary page</main>','text/html');});
  await assert.rejects(()=>monitor.fetch(view.toString()),(error:any)=>error.code==='CALENDAR_SOURCE_USE_ICS'&&error.status===422);
  assert.equal((await monitor.fetch('https://www.google.com/search?q=calendar')).contentType,'text/html');
  assert.equal(calls,1);
  const icsFetcher=new SecretSubscriptionFetcher(resolver,async()=>response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n','text/calendar'));
  assert.match(await icsFetcher.fetch(ical.toString()),/BEGIN:VCALENDAR/);
  await assert.rejects(()=>new SecretSubscriptionFetcher(resolver,async()=>response('<html>Google Calendar</html>','text/html')).fetch(view.toString()),(error:any)=>error.code==='CALENDAR_ICS_GOOGLE_VIEW_URL');
});
