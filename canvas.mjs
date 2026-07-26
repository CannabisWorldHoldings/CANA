import { chromium } from 'playwright';
const b=await chromium.launch({args:['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const g=await ctx.newPage(); await g.goto('http://orderweeddc.localhost:3000/',{waitUntil:'domcontentloaded'});
try{await g.click("text=Yes, I'm 21 or older",{timeout:6000});}catch{} await g.waitForTimeout(900); await g.close();
const p=await ctx.newPage(); await p.goto('http://orderweeddc.localhost:3000/',{waitUntil:'load'}); await p.waitForTimeout(1500);
const r=await p.evaluate(()=>{
  const out={html:getComputedStyle(document.documentElement).backgroundColor, body:getComputedStyle(document.body).backgroundColor};
  // what actually paints behind the hero?
  const hero=document.querySelector('h1')?.closest('section,div');
  const chain=[]; let el=hero;
  while(el&&chain.length<6){const cs=getComputedStyle(el);chain.push({tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,60),bg:cs.backgroundColor,bgImage:cs.backgroundImage.slice(0,70)});el=el.parentElement;}
  out.heroAncestry=chain;
  return out;});
console.log(JSON.stringify(r,null,2));
await b.close();
