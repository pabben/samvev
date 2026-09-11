import assert from 'node:assert/strict';
import test from 'node:test';
import { MonitorSourceFetcher, isBlockedMonitorAddress, normalizeMonitorUrl, selectRelevantSource, sourceUrlFromInstruction } from './source-fetcher.ts';

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
  await assert.rejects(()=>fetcher.fetch('https://example.com/slow'),(error:any)=>error.code==='MONITOR_SOURCE_TIMEOUT');
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

test('agent link fetches reject cross-origin redirects before following them',async()=>{
  let calls=0;const fetcher=new MonitorSourceFetcher(resolver,async()=>{calls++;return response('', 'text/html',302,'https://other.example/path');});
  await assert.rejects(()=>fetcher.fetch('https://example.com/news',{followLinkedPdf:false,redirectOrigin:'https://example.com'}),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');assert.equal(calls,1);
});
