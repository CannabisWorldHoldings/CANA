import { chromium } from 'playwright';
const B='http://orderweeddc.localhost:3000';
const b=await chromium.launch({args:['--host-resolver-rules=MAP orderweeddc.localhost 127.0.0.1']});
for (const [vp,w,h] of [['desktop',1440,900],['mobile',390,844]]) {
  for (const th of ['day','night']) {
    const ctx=await b.newContext({viewport:{width:w,height:h}});
    for (const d of ['a','b','c']) {
      const p=await ctx.newPage();
      try{
        await p.goto(`${B}/lab/dir-${d}?theme=${th}`,{waitUntil:'load',timeout:30000});
        await p.waitForTimeout(1600);
        await p.screenshot({path:`${process.env.HOME}/workspace/shots/lab/${d}-${th}-${vp}.png`});
        console.log(`  dir-${d} ${th} ${vp}: OK`);
      }catch(e){console.log(`  dir-${d} ${th} ${vp}: FAIL ${e.message.split('\n')[0]}`);}
      await p.close();
    }
    await ctx.close();
  }
}
await b.close();
