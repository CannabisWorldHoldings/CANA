import { chromium } from 'playwright';
const B='http://orderweeddc.localhost:3000';
const b=await chromium.launch({args:['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const g=await ctx.newPage(); await g.goto(B+'/',{waitUntil:'domcontentloaded'});
try{await g.click("text=Yes, I'm 21 or older",{timeout:6000});}catch{} await g.waitForTimeout(1000); await g.close();

const p=await ctx.newPage();
const errs=[],fails=[];
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
p.on('response',r=>{if(r.status()>=400)fails.push(`${r.status()} ${r.url().replace(B,'')}`);});
const t0=Date.now();
await p.goto(B+'/',{waitUntil:'load'}); const loadMs=Date.now()-t0;
await p.waitForTimeout(2000);

console.log('=== PERFORMANCE ===');
const perf=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0]||{};return{ttfb:Math.round(n.responseStart||0),domInteractive:Math.round(n.domInteractive||0),domComplete:Math.round(n.domComplete||0),transferKB:Math.round((n.transferSize||0)/1024)};});
console.log(`  wall load: ${loadMs}ms  TTFB:${perf.ttfb}ms  domInteractive:${perf.domInteractive}ms  transfer:${perf.transferKB}KB`);
const res=await p.evaluate(()=>{const e=performance.getEntriesByType('resource');const by={};let tot=0;e.forEach(r=>{const t=r.initiatorType||'other';by[t]=(by[t]||0)+(r.transferSize||0);tot+=r.transferSize||0;});return{by,totalKB:Math.round(tot/1024),count:e.length};});
console.log(`  resources: ${res.count} files, ${res.totalKB}KB total`);
Object.entries(res.by).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([k,v])=>console.log(`    ${k}: ${Math.round(v/1024)}KB`));

console.log('=== HERO COMPOSITION (owner rejection focus) ===');
const hero=await p.evaluate(()=>{
  const out={};
  const logo=document.querySelector('header a[href="/"], header svg, header img');
  if(logo){const r=logo.getBoundingClientRect();out.logo={w:Math.round(r.width),h:Math.round(r.height),area:Math.round(r.width*r.height)};}
  const h1=document.querySelector('h1');
  if(h1){const r=h1.getBoundingClientRect();const cs=getComputedStyle(h1);out.h1={text:h1.innerText.slice(0,50),w:Math.round(r.width),h:Math.round(r.height),area:Math.round(r.width*r.height),fontSize:cs.fontSize,color:cs.color};}
  const els=[...document.querySelectorAll('div,section,aside')];
  const snap=els.find(e=>/directory snapshot|what the evidence supports/i.test(e.innerText||'')&&e.getBoundingClientRect().width<900&&e.getBoundingClientRect().width>200);
  if(snap){const r=snap.getBoundingClientRect();out.snapshotCard={w:Math.round(r.width),h:Math.round(r.height),area:Math.round(r.width*r.height),topPx:Math.round(r.top)};}
  out.viewportArea=window.innerWidth*window.innerHeight;
  return out;});
console.log(JSON.stringify(hero,null,2).split('\n').map(l=>'  '+l).join('\n'));

console.log('=== COLOR AUDIT (mint/neon green check) ===');
const colors=await p.evaluate(()=>{const m={};[...document.querySelectorAll('*')].slice(0,1200).forEach(e=>{const cs=getComputedStyle(e);[cs.color,cs.backgroundColor].forEach(c=>{if(c&&!/rgba\(0, 0, 0, 0\)/.test(c))m[c]=(m[c]||0)+1;});});return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,10);});
colors.forEach(([c,n])=>console.log(`  ${n.toString().padStart(4)}x  ${c}`));

console.log('=== CONSOLE ERRORS: '+errs.length+' | FAILED REQUESTS: '+fails.length+' ===');
[...new Set(errs)].slice(0,5).forEach(e=>console.log('  ERR '+e));
[...new Set(fails)].slice(0,8).forEach(f=>console.log('  '+f));
await b.close();
