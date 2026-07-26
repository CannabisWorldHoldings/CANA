import { chromium } from 'playwright';
const B='http://orderweeddc.localhost:3000/';
const b=await chromium.launch({args:['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1']});
for (const [vp,w,h] of [['desktop',1440,900],['mobile',390,844]]) {
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  const g=await ctx.newPage(); await g.goto(B,{waitUntil:'domcontentloaded'});
  try{await g.click("text=Yes, I'm 21 or older",{timeout:6000});}catch{} await g.waitForTimeout(900); await g.close();
  const p=await ctx.newPage();
  const errs=[],fails=[];
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,110));});
  p.on('response',r=>{if(r.status()>=400)fails.push(r.status()+' '+r.url().split('/').pop());});
  await p.goto(B,{waitUntil:'load'}); await p.waitForTimeout(1800);
  const d=await p.evaluate(()=>{
    const marks=[...document.querySelectorAll('[data-sponsorship-state]')];
    const visible=marks.filter(m=>{const cs=getComputedStyle(m);const r=m.getBoundingClientRect();
      return !m.hasAttribute('hidden')&&cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0;});
    // organic ordering as rendered
    const names=[...document.querySelectorAll('article h2 a')].map(a=>a.textContent.trim());
    return {total:marks.length, states:marks.map(m=>m.getAttribute('data-sponsorship-state')),
      visible:visible.map(m=>({state:m.getAttribute('data-sponsorship-state'),
        hash:m.getAttribute('data-sponsorship-entry-hash'),
        order:m.getAttribute('data-sponsorship-affects-order'),
        text:m.textContent.trim().split('.')[0]})),
      order:names};
  });
  console.log(`\n=== PRODUCTION HOMEPAGE — ${vp} ===`);
  console.log(`  sponsorship elements: ${d.total}  states: ${[...new Set(d.states)].join(',')}`);
  console.log(`  VISIBLE badges: ${d.visible.length}`);
  d.visible.forEach(v=>console.log(`    "${v.text}" hash=${String(v.hash).slice(0,12)} affectsOrder=${v.order}`));
  console.log(`  organic order: ${d.order.join(' | ')}`);
  console.log(`  console errors ${errs.length} · failed requests ${fails.length}`);
  await ctx.close();
}
await b.close();
