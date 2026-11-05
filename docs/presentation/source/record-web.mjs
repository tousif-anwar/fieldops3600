import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root,"apps/web/package.json"));
const {chromium,expect}=require("@playwright/test");
const password=readFileSync(path.join(root,".env"),"utf8").match(/^DEMO_PASSWORD=(.+)$/m)?.[1].trim();
if(!password) throw new Error("Local demo credentials missing");
const base="http://localhost:8088";
const output=path.join(root,"docs/presentation/demos/web");
const assets=path.join(root,"docs/presentation/assets");
mkdirSync(output,{recursive:true});mkdirSync(assets,{recursive:true});
const browser=await chromium.launch();
const audit=[];
const pause=page=>page.waitForTimeout(2200);
for(const role of ["dispatcher","technician","supervisor","manager","analyst","administrator"]){
 const folder=path.join(root,".local/presentation-videos",role);mkdirSync(folder,{recursive:true});
 const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:folder,size:{width:1920,height:1080}},timezoneId:"UTC"});
 const page=await context.newPage();const video=page.video();
 let authorization;page.on("request",r=>{if(r.url().startsWith(base+"/api/"))authorization=r.headers().authorization??authorization;});
 const result={role,steps:[],errors:[]};
 async function shot(name){await pause(page);await page.screenshot({path:path.join(assets,name+".png")});result.steps.push(name);}
 try{
  await page.goto(base);await page.getByRole("button",{name:"Continue to secure sign-in"}).click();
  await page.locator("#username").fill(role);await page.locator("#password").fill(password);await page.locator("#kc-login").click({timeout:60000});
  await page.getByRole("navigation",{name:"Main navigation"}).waitFor({timeout:60000});
  await shot("home-"+role);
  if(role==="dispatcher"){
   await page.getByRole("link",{name:/Create work order/}).first().click();
   const title="Synthetic presentation service request";
   await page.getByLabel("Work order title",{exact:false}).fill(title);
   await page.getByLabel("Customer name",{exact:false}).fill("Synthetic Presentation Customer");
   await page.getByLabel("Service address",{exact:false}).fill("100 Demonstration Avenue");
   await pause(page);await page.getByRole("button",{name:"Create work order",exact:true}).click();
   await page.getByRole("heading",{name:title,exact:true}).waitFor();await shot("work-order-created");
   await page.getByRole("button",{name:"Schedule service",exact:true}).click();
   const start=new Date();start.setUTCDate(start.getUTCDate()+20);
   while([0,6].includes(start.getUTCDay()))start.setUTCDate(start.getUTCDate()+1);
   start.setUTCHours(15,0,0,0);
   await page.getByLabel("Appointment start (your local time)",{exact:false}).fill(start.toISOString().slice(0,16));
   await page.getByRole("button",{name:"Find qualified technicians"}).click();
   await page.getByRole("radio").first().waitFor({timeout:30000});await shot("dispatch-recommendations");
   await page.getByRole("radio").first().check();await pause(page);
   await page.getByRole("button",{name:"Confirm booking"}).click();
   await page.getByText("Booking confirmed. The technician is now assigned.").waitFor();await shot("booking-confirmed");
  }
  const nav=await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link").evaluateAll(xs=>xs.map(x=>({label:x.textContent.trim(),to:x.getAttribute("href")})));
  for(const item of nav){
   if(item.to==="/")continue;
   if(role==="manager"&&item.to?.includes("replay"))continue;
   await page.getByRole("navigation",{name:"Main navigation"}).getByRole("link",{name:item.label,exact:true}).click();
   await shot(role+"-"+item.to.replaceAll("/","-").replace(/^-+/,""));
   if(item.to==="/analytics"){
    for(const tabName of ["SLA trend","Stage duration","Supervisor actions"]){
     const tab=page.getByRole("tab",{name:tabName,exact:false});
     if(await tab.isVisible().catch(()=>false)){await tab.click();await shot(role+"-analytics-"+tabName.toLowerCase().replaceAll(" ","-"));}
    }
    const exportCsv=page.getByRole("button",{name:"Export CSV",exact:true});
    if(await exportCsv.isVisible()){const download=page.waitForEvent("download");await exportCsv.click();await download;result.steps.push("CSV export downloaded");}
   }
   if(item.to?.includes("replay")&&authorization){
    let id;try{id=JSON.parse(readFileSync(path.join(root,".local/demo.json"),"utf8")).workOrderId;}catch{}
    const select=page.getByRole("combobox",{name:"Select work order for investigation"});
    if(id&&await select.locator('option[value="'+id+'"]').count()){
     await select.selectOption(id);await page.getByRole("button",{name:"Investigate",exact:true}).click();
     await page.getByRole("heading",{name:"Event timeline",exact:true}).waitFor();
     await page.getByRole("button",{name:"First breach",exact:true}).click().catch(()=>{});
     await shot("replay-incident");
     await page.getByRole("button",{name:"Play",exact:true}).click();await page.waitForTimeout(5200);
     await page.getByRole("button",{name:"Pause",exact:true}).click();await shot("replay-playback");
     const pdf=page.waitForEvent("download");await page.getByRole("button",{name:"Incident PDF",exact:true}).click();await pdf;
     result.steps.push("Incident PDF downloaded");
    }
   }
  }
  result.ok=true;
 }catch(error){result.ok=false;result.errors.push({type:error.name,phase:result.steps.at(-1)??"login"});}
 await context.close();
 await video.saveAs(path.join(output,role+"-walkthrough.webm"));
 audit.push(result);console.log(JSON.stringify({role,ok:result.ok,recordedSteps:result.steps.length,errors:result.errors}));
}
await browser.close();
writeFileSync(path.join(output,"recording-manifest.json"),JSON.stringify({capturedAtUtc:new Date().toISOString(),synthetic:true,source:"Actual served web, real Keycloak PKCE and live backend",silent:true,roles:audit},null,2)+"\n");

