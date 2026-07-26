import { chromium } from 'playwright';
const B='http://orderweeddc.localhost:3000/lab/sponsorship';
const b=await chromium.launch({args:['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1']});
const results=[];
for (const [vp,w,h] of [['desktop',1440,900],['mobile',390,844]]) {
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  const p=await ctx.newPage();
  const errs=[],fails=[];
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120));});
  p.on('response',r=>{if(r.status()>=400)fails.push(`${r.status()} ${r.url().split('/').pop()}`);});
  await p.goto(B,{waitUntil:'load',timeout:30000});
  await p.waitForTimeout(1400);
  // Every scenario card and whether a VISIBLE badge rendered
  const cards=await p.$$eval('[data-scenario]', els=>els.map(e=>{
    const badge=e.querySelector('[data-sponsorship-state]');
    const visible=badge ? !badge.hasAttribute('hidden') && getComputedStyle(badge).display!=='none' : false;
    const isActive=badge?.getAttribute('data-sponsorship-state')==='ACTIVE';
    return {
      scenario:e.getAttribute('data-scenario'),
      resolved:e.getAttribute('data-resolved-state'),
      badgeState:badge?.getAttribute('data-sponsorship-state')??null,
      visibleBadge:visible && isActive,
      label:isActive?badge.textContent.trim().split('.')[0]:null,
      entryHash:badge?.getAttribute('data-sponsorship-entry-hash')??null,
      entitlement:badge?.getAttribute('data-sponsorship-entitlement')??null,
      affectsOrder:badge?.getAttribute('data-sponsorship-affects-order')??null,
    };}));
  // overflow check
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  results.push({vp,cards,errs:[...new Set(errs)],fails:[...new Set(fails)],overflow});
  await p.close(); await ctx.close();
}
for (const r of results){
  console.log(`\n=== ${r.vp.toUpperCase()} ===`);
  console.log(`  console errors: ${r.errs.length}  failed requests: ${r.fails.length}  h-overflow: ${r.overflow}`);
  for (const c of r.cards){
    const mark=c.visibleBadge?'BADGE ':'  --  ';
    console.log(`  ${mark} ${String(c.scenario).padEnd(12)} state=${String(c.resolved).padEnd(16)} ${c.label?`label="${c.label}" hash=${c.entryHash} order=${c.affectsOrder}`:''}`);
  }
}
// COURT ASSERTIONS
const d=results[0];
const shouldBadge=new Set(['active']);
let viol=[];
for (const c of d.cards){
  if (c.visibleBadge && !shouldBadge.has(c.scenario)) viol.push(`${c.scenario} rendered a badge but must not`);
  if (!c.visibleBadge && shouldBadge.has(c.scenario)) viol.push(`${c.scenario} must render a badge but did not`);
  if (c.visibleBadge && c.affectsOrder!=='false') viol.push(`${c.scenario} badge does not assert order-neutrality`);
  if (c.visibleBadge && !c.entryHash) viol.push(`${c.scenario} badge lacks ledger provenance`);
}
if (d.errs.length) viol.push(`${d.errs.length} console errors`);
if (d.fails.length) viol.push(`${d.fails.length} failed requests`);
if (d.overflow) viol.push('horizontal overflow');
console.log(`\n  SPONSORSHIP COURT: ${viol.length===0?'PASS':'FAIL'}`);
viol.forEach(v=>console.log(`    ✗ ${v}`));
await b.close();
process.exit(viol.length===0?0:1);
