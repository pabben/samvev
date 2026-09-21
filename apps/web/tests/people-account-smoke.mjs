// Targeted synthetic person/account/birthday smoke. All writes are intercepted.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const baseURL=process.env.BASE_URL??"http://samvev-m1-app-1:4173";
const publicOrigin=process.env.PUBLIC_ORIGIN??new URL(baseURL).origin;
const browser=await chromium.launch({headless:true});
const anonymousContext=await browser.newContext({baseURL,extraHTTPHeaders:{Origin:publicOrigin}});
const anonymousPage=await anonymousContext.newPage();
await anonymousPage.goto("/");
await expect(anonymousPage.getByRole("heading",{name:"Velkommen hjem."})).toBeVisible();
await anonymousPage.goto("/invitation#token=synthetic_ui_invitation_token_abcdefghijklmnopqrstuvwxyz");
await expect(anonymousPage.getByRole("heading",{name:"Aktiver Samvev-kontoen din"})).toBeVisible();
await anonymousContext.close();
const context=await browser.newContext({baseURL,viewport:{width:390,height:844},reducedMotion:"reduce",extraHTTPHeaders:{Origin:publicOrigin}});
const limitedContext=await browser.newContext({baseURL,extraHTTPHeaders:{Origin:publicOrigin}});
const login=async(ctx,email)=>{
  const response=await ctx.request.post("/api/v1/auth/login",{data:{email,password:"Synthetic-pilot-pass-42"}});
  expect(response.ok(),await response.text()).toBeTruthy();
  const cookies=response.headersArray().filter(({name})=>name.toLowerCase()==="set-cookie").map(({value})=>value.split(";")[0]).map((pair)=>{const separator=pair.indexOf("=");return{name:pair.slice(0,separator),value:pair.slice(separator+1),url:baseURL,secure:false,sameSite:"Strict"};});
  await ctx.addCookies(cookies);
  return (await ctx.request.get("/api/v1/me")).json();
};
const owner=await login(context,"owner@pilot.invalid");
await login(limitedContext,"limited@pilot.invalid");
const householdId=owner.memberships[0].household_id;
const ownerHeaders={"X-CSRF-Token":owner.csrfToken};
const originalLocale=owner.account.locale;
await context.request.patch("/api/v1/me/preferences",{headers:ownerHeaders,data:{locale:"en"}});
const syntheticPeople=[
  {id:"10000000-0000-4000-8000-000000000001",display_name:"Synthetic Owner",age_group:"adult",birth_date:"1988-02-29",calculated_age:38,person_revision:1,membership_id:"20000000-0000-4000-8000-000000000001",role_preset:"installation_admin",capabilities:owner.memberships[0].capabilities,revision:1,has_login:true,has_active_login:true,account_status:"active",email:"owner@synthetic-ui.invalid",account_id:"30000000-0000-4000-8000-000000000001",account_revision:1,display_ids:[]},
  {id:"10000000-0000-4000-8000-000000000002",display_name:"Synthetic Profile",age_group:"unspecified",birth_date:null,person_revision:1,membership_id:"20000000-0000-4000-8000-000000000002",role_preset:"member",capabilities:["household.view","message.create.household","message.publish.display","message.schedule"],revision:1,has_login:false,has_active_login:false,account_status:"profile",email:null,account_id:null,account_revision:null,display_ids:[]},
];
let createPayload;
const page=await context.newPage();
const limitedPage=await limitedContext.newPage();
for(const current of [page,limitedPage])current.on("pageerror",(error)=>console.error("PAGE ERROR",error));
try{
  await page.route("**/api/v1/**",async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path.endsWith("/people")&&request.method()==="GET")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({people:syntheticPeople})});
    if(path.endsWith("/dashboard"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({upcomingBirthday:{personId:syntheticPeople[0].id,displayName:"Synthetic Owner",date:"2027-02-28",daysUntil:172,ageTurning:39}})});
    if(path.endsWith("/settings")&&request.method()==="GET")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({show_upcoming_birthday:true,revision:1})});
    if(path.endsWith("/settings")&&request.method()==="PATCH")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({show_upcoming_birthday:false,revision:2})});
    if(path.endsWith("/people")&&request.method()==="POST"){createPayload=request.postDataJSON();return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify({personId:"synthetic",membershipId:"synthetic",hasLogin:true,invitationToken:"synthetic_ui_invitation_token_abcdefghijklmnopqrstuvwxyz"})});}
    return route.continue({headers:{...request.headers(),origin:publicOrigin}});
  });
  await page.goto("/");await expect(page.getByText("NEXT BIRTHDAY")).toBeVisible();await expect(page.getByText("Synthetic Owner")).toBeVisible();
  await page.getByRole("button",{name:"People",exact:true}).click();
  await expect(page.getByText("Born February 29, 1988 · 38 years old")).toBeVisible();
  await page.getByRole("button",{name:"Add person"}).click();
  await page.getByLabel("Display name").fill("Synthetic New Admin");
  await page.getByLabel("Date of birth").fill("1990-09-10");
  await expect(page.getByText("Calculated age: 35",{exact:true})).toBeVisible();
  await page.getByLabel("Role").selectOption("household_admin");
  await expect(page.getByLabel("Give this person a sign-in")).toBeChecked();
  await page.getByLabel("Email").fill("new-admin@synthetic-ui.invalid");
  await expect(page.getByLabel("Manage household")).toBeChecked();
  await expect(page.getByLabel("Manage household")).toBeDisabled();
  const editorAxe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();expect(editorAxe.violations.map((value)=>value.id)).toEqual([]);
  await page.getByRole("button",{name:"Save changes"}).click();
  await expect(page.getByRole("heading",{name:"Invitation ready"})).toBeVisible();
  const invitationAxe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();expect(invitationAxe.violations.map((value)=>value.id)).toEqual([]);
  expect(createPayload.rolePreset).toBe("household_admin");expect(createPayload.login.loginMethod).toBe("invitation");expect(createPayload.birthDate).toBe("1990-09-10");
  await page.getByRole("button",{name:"Done"}).click();
  const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();expect(axe.violations.map((value)=>value.id)).toEqual([]);
  await page.goto("/invitation#token=synthetic_ui_invitation_token_abcdefghijklmnopqrstuvwxyz");
  await expect(page.getByRole("heading",{name:"Activate your Samvev account"})).toBeVisible();
  await limitedPage.goto("/");await limitedPage.getByRole("button",{name:/People|Personer/,exact:true}).click();await expect(limitedPage.getByRole("button",{name:/Add person|Legg til person/})).toHaveCount(0);
  console.log("PASS synthetic admin creation flow, birth date/age, birthday card, capability preview, restricted permissions and axe");
}finally{
  await context.request.patch("/api/v1/me/preferences",{headers:ownerHeaders,data:{locale:originalLocale}});
  await browser.close();
}
