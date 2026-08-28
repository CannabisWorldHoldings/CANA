import { deepFreeze } from './core.mjs';

const rule=(id,claimed,evidenceKey,test,why)=>({id,claimed,evidenceKey,test,why});
const RULES=[
  rule('REAL_ARMADA','Armada','armada',(e)=>e?.testedAgents>=2 && e?.independentVerifier===true,'An Armada requires multiple actually trialed agents/models and an independent verifier.'),
  rule('SITEMIND_EYES','SiteMind sees the site','siteMind',(e)=>e?.browserCaptured===true && e?.domCaptured===true && e?.pixelsCaptured===true,'Static surface contracts are not browser perception.'),
  rule('PROGRAMMABLE_SITE','Site is threaded into CANA','experience',(e)=>e?.enumerated===true && e?.manifestCoverage===1 && e?.previewable===true && e?.rollbackable===true,'Full fabric requires every real surface to be addressable, previewable and reversible.'),
  rule('REAL_RSI','RSI','rsi',(e)=>e?.verifiedLesson===true && e?.improverChanged===true && e?.ablationLinked===true && e?.successorRanNextCycle===true,'Self-modification is not recursive self-improvement.'),
  rule('CAUSAL_MEMORY','Causal learning','causal',(e)=>e?.verifiedExposure===true && e?.realOutcome===true && e?.causalSettlement===true,'Association or simulation cannot become causal memory.'),
  rule('AUTONOMOUS_PAGE_FACTORY','Autonomous page factory','pageFactory',(e)=>e?.realRouteCandidate===true && e?.courted===true && e?.privatePreview===true,'Generating prose or a mock component is not a page factory.'),
  rule('MODEL_ARENA','Model arena','modelArena',(e)=>e?.realModelsTrialed>=2 && e?.sameTask===true && e?.independentScoring===true,'A roster of available models is not an arena.'),
  rule('SOFTWARE_FACTORY','Intent to verified software','softwareFactory',(e)=>e?.repoMutation===true && e?.tests===true && e?.independentReview===true,'A software proposal is not verified software.'),
];

export function scanAchievementDebt({claims=[],evidence={}}={}){
  const normalized=new Set(claims.map(x=>String(x).toLowerCase()));
  const debts=[];
  const satisfied=[];
  for(const r of RULES){
    const isClaimed=[r.claimed,r.id].some(x=>normalized.has(String(x).toLowerCase()));
    if(!isClaimed) continue;
    if(r.test(evidence[r.evidenceKey])) satisfied.push(r.id);
    else debts.push({id:r.id,claim:r.claimed,severity:'HIGH',why:r.why,status:'ACHIEVEMENT_DEBT'});
  }
  return deepFreeze({debts,satisfied,verdict:debts.length?'DEBT_PRESENT':'NO_DEBT_DETECTED'});
}

export function fullFabricDebt(evidence){
  return scanAchievementDebt({claims:['Site is threaded into CANA','SiteMind sees the site','Autonomous page factory','Model arena','RSI'],evidence});
}
