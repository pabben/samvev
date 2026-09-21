// Tests the SAME UI driver as e2e:live against the real frontend with synthetic API fixtures.
// No live account, session, household, AI or source calls. No screenshots or traces.
import { chromium } from '@playwright/test';
import { createSetupThroughUi, testThroughUi, assertPopulatedUi, deleteThroughUi, navigateTasks } from './live-runtime-browser.mjs';
import { check, safeCode } from './live-runtime-support.mjs';
const household = '10000000-0000-4000-8000-000000000001';
const person = '20000000-0000-4000-8000-000000000001';
const id = '60000000-0000-4000-8000-000000000001';
const base = `/households/${household}/monitors`;
const caps = ['household.view','household.manage','message.create.household','message.schedule'];
let prefs={locale:'nb',theme:'light'}, task, nextRun=0, mutations=0;
let releasePanel, panelRequested, delayPanel=true;
const panelGate=new Promise((resolve)=>{releasePanel=resolve;});
const panelRequest=new Promise((resolve)=>{panelRequested=resolve;});
const rule={resultKind:'answer',summary:'Sjekk morgendagens vær.',eventTypes:[],keywords:[],people:[],checkIntervalMinutes:1440,noticeDaysBefore:1,noticeLocalTime:'18:00'};
function projected() {
  const status=task.activeExecution?'running':task.interpretedRule?'ready_for_approval':'incomplete';
  const enabled=status==='running'?['refresh']:status==='incomplete'?['interpret','edit','delete']:['test','approve','smarter','edit','delete'];
  return {...task,lifecycle:{status,setupComplete:!!task.interpretedRule,actions:Object.fromEntries(['interpret','test','approve','edit','delete','run','pause','resume','smarter','quality','refresh'].map((name)=>[name,{enabled:enabled.includes(name),reason:enabled.includes(name)?null:'running'}]))}};
}
function terminal() {
  const now=new Date().toISOString();
  const run={...task.activeExecution,status:'succeeded',completedAt:now,errorCode:null};
  if(run.kind==='interpretation')task.interpretedRule=rule;
  else run.resultSummary={outcome:'changed',resultKind:'answer',result:{version:1,answer:'Syntetisk værvarsel: 8 grader.',confidence:1,uncertainty:null,evidence:{quote:'8 grader',sourceUrl:'https://example.com/forecast'}},sourceUrl:'https://example.com/forecast',checkedAt:now,sources:[{sourceUrl:'https://example.com/forecast',kind:'weather',fetchedAt:now}]};
  task.activeExecution=null;task.latestExecution=run;return run;
}
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({baseURL:process.env.BASE_URL??'http://samvev-m1-app-1:4173',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/api/v1/**',async(route)=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');
    let value,status=200;
    const body=request.method()==='GET'?{}:request.postDataJSON()??{};
    if(request.method()!=='GET')mutations++;
    if(path==='/setup/status')value={claimed:true,demo:false,demoAvailable:false,locale:'nb'};
    else if(path==='/setup/progress')value={setupStep:'complete'};
    else if(path==='/me')value={account:{id:'40000000-0000-4000-8000-000000000001',email:'synthetic-browser@test.invalid',...prefs},csrfToken:'synthetic-fixture-only',memberships:[{id:'30000000-0000-4000-8000-000000000001',household_id:household,person_id:person,role_preset:'household_admin',capabilities:caps,revision:1,household_name:'Synthetic browser fixture',timezone:'Europe/Oslo',household_locale:'nb',display_name:'Synthetic operator',display_ids:[]}]};
    else if(path==='/me/preferences'){prefs={...prefs,...body};value=prefs;}
    else if(path===`/households/${household}/people`)value={people:[{id:person,display_name:'Synthetic operator',age_group:'adult',person_revision:1,membership_id:'30000000-0000-4000-8000-000000000001',role_preset:'household_admin',capabilities:caps,revision:1,has_login:true,display_ids:[]}]};
    else if(path===`/households/${household}/displays`)value={displays:[]};
    else if(path===`/households/${household}/messages`)value={messages:[]};
    else if(path===`/households/${household}/dashboard`)value={upcomingBirthday:null};
    else if(path===`/households/${household}/settings`)value={show_upcoming_birthday:false,revision:1};
    else if(path===base&&request.method()==='GET'){
      if(delayPanel){delayPanel=false;panelRequested();await panelGate;}
      value={tasks:task?[projected()]:[]};
    }
    else if(path===base&&request.method()==='POST'){
      check(!Object.hasOwn(body,'sourceUrl'),'MOCK_SOURCE_WAS_MANUALLY_ENTERED');
      check(body.targets.personIds.length===1&&body.targets.personIds[0]===person&&body.targets.displayIds.length===0,'MOCK_TARGET_SCOPE');
      task={...body,id,sourceUrl:null,sourceKinds:['weather'],state:'draft',revision:1,approvedRevision:null,interpretedRule:null,events:[],lastCheckedAt:null,nextCheckAt:null,lastResult:null,lastChangedAt:null,errorCode:null,stats:{checks:0,aiCalls:0,unchanged:0}};
      value=projected();status=201;
    } else if([`${base}/${id}/interpret`,`${base}/${id}/test`].includes(path)){
      const now=new Date().toISOString();
      const run={id:`70000000-0000-4000-8000-${String(++nextRun).padStart(12,'0')}`,taskId:id,taskRevision:1,kind:path.endsWith('/interpret')?'interpretation':'test',status:'running',progress:{stage:'fetching_weather',updatedAt:now},usesLocalAi:true,expectedDurationSeconds:120,queuedAt:now,startedAt:now,completedAt:null,errorCode:null};
      task.activeExecution=run;task.latestExecution=run;value={run};status=202;
    } else if(path.startsWith(`${base}/${id}/runs/`))value={run:task.activeExecution??task.latestExecution};
    else if(path===`${base}/${id}`&&request.method()==='DELETE'){task=undefined;status=204;}
    else {status=404;value={error:{code:'SYNTHETIC_ROUTE_NOT_DEFINED'}};}
    await route.fulfill({status,contentType:'application/json',...(status===204?{}:{body:JSON.stringify(value)})});
  });
  const page=await context.newPage();let errors=0;page.on('pageerror',()=>errors++);
  const navigate=(locale='nb')=>navigateTasks(page,locale);
  const pendingNavigation=navigate().then(()=> 'finished',()=> 'failed');
  await panelRequest;
  check(!await page.getByRole('heading',{name:'Oppdrag',exact:true}).isVisible(),'MOCK_PANEL_NOT_DELAYED');
  check(await Promise.race([pendingNavigation,page.waitForTimeout(100).then(()=> 'waiting')])==='waiting','MOCK_NAVIGATION_DID_NOT_WAIT');
  releasePanel();check(await pendingNavigation==='finished','MOCK_DELAYED_NAVIGATION_FAILED');
  let remembered;
  const created=await createSetupThroughUi(page,base,'Synthetic E2E browser driver','Sjekk været i Testvik i morgen.',async(value)=>{remembered=value.id;});
  check(remembered===id&&created.run.id===task.activeExecution.id,'MOCK_CREATE_NOT_DURABLE');
  await assertPopulatedUi(page,id,'nb','light','running');
  const sameRun=task.activeExecution.id, before=mutations;
  await page.reload();await navigate();
  check(task.activeExecution.id===sameRun&&mutations===before,'MOCK_REFRESH_ENQUEUED');
  await page.setViewportSize({width:390,height:900});await assertPopulatedUi(page,id,'nb','light','running');
  task.activeExecution.progress.stage='analyzing';await navigate();
  check(await page.locator('.monitor-progress-stage strong').textContent()==='Analyserer og sammenstiller kildene','MOCK_PROGRESS_NOT_UPDATED');
  terminal();await navigate();await assertPopulatedUi(page,id,'nb','light','ready');
  const tested=await testThroughUi(page,base,task);check(tested.id!==created.run.id,'MOCK_TEST_ID_REUSED');
  await assertPopulatedUi(page,id,'nb','light','running');
  terminal();await navigate();await assertPopulatedUi(page,id,'nb','light','result');
  prefs={locale:'en',theme:'dark'};await navigate('en');await assertPopulatedUi(page,id,'en','dark','result');
  prefs={locale:'nb',theme:'light'};await page.setViewportSize({width:1440,height:1000});await navigate();await assertPopulatedUi(page,id,'nb','light','result');
  await deleteThroughUi(page,base,task,()=>navigate());check(!task,'MOCK_DELETE_FAILED');check(errors===0,'MOCK_BROWSER_ERROR');
  await context.close();
  console.log('PASS delayed async panel navigation; browser-driven create/setup/Test now/delete; persistent reload/no enqueue; populated running/terminal NB/EN mobile/desktop theme/Axe/focus/reduced-motion; synthetic intercepted APIs only');
} catch(error) {console.error(`FAIL ${safeCode(error)}`);process.exitCode=1;}
finally {await browser.close();}
