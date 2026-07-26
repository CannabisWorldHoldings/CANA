import { chromium } from 'playwright';
const b=await chromium.launch({args:['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1']});
for (const [vp,w,h] of [['desktop',1440,900],['mobile',390,844]]) {
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  const p=await ctx.newPage();
  await p.goto('http://orderweeddc.localhost:3000/lab/sponsorship',{waitUntil:'load'});
  await p.waitForTimeout(1200);
  await p.screenshot({path:`${process.env.HOME}/workspace/shots/sponsorship-${vp}.png`,fullPage:vp==='desktop'});
  console.log(`  ${vp}: captured`);
  await ctx.close();
}
await b.close();
