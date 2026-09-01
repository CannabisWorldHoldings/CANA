import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileSovereignIntent, compileCompetitiveGenome, proposeSupersessionChallenger, scanAchievementDebt,
  createArtifact, buildArtifactDag, validateExperienceManifest, createExperienceCandidate, createSiteCortexAdapter,
  observeCustomerSite, fullFabricCoverage, proposeSiteWork, createHarnessCandidate, settleHarnessTournament,
  recursiveHarnessCheck, compileWorkforce, recordModelTrial, settleModelArena, proposeSkillFromRuns,
  skillPromotionCourt, chooseAdaptationLayer, buildFrontierLane, createFullFabricAdapter, experiencePromotionCourt,
  executeExperienceThroughCanonicalAuthority, compilePageFactoryCandidate, makeReceipt,
  validateBrowserObservationReceipt,
} from '../src/lib/cana-intelligence/index.mjs';
function store(){const m=new Map();return {m,put:r=>(m.set(r.receiptDigest,r),r),loadReceipt:async d=>m.get(d)??null};}
function browserPayload({route='/',candidateDigest='candidate:test'}={}){return {route,candidateDigest,commit:'ab2a0363ce7f3e1f2eb6067e73663cb88f042540',tree:'c4ffc5e9b62977f1e031eb8b43da73ff6da4d2c3',browser:'chromium',browserVersion:'140.0.0.0',viewport:{width:390,height:844},screenshotDigest:`sha256:${'1'.repeat(64)}`,domDigest:`sha256:${'2'.repeat(64)}`,capturedAt:'2026-08-24T12:00:00.000Z',consoleResult:{status:'PASS',errors:0},accessibilityResult:{status:'PASS',violations:0},layoutResult:{status:'PASS',horizontalOverflow:false}};}
function exactManifest(route='/'){return {route,version:'candidate-v1',presentation:{title:'Exact candidate presentation'}};}
const atomicExecution = (execute = async (input) => input) => async ({ executionInput }) => ({
  ...await execute(executionInput),
  appliedManifestDigest: executionInput.targetManifestDigest,
});

test('intent compiler never authenticates execution intent',()=>{const i=compileSovereignIntent('Deploy a new homepage theme across the entire site');assert.equal(i.requiresVerifiedPrincipal,true);assert.equal(i.authorityClaimed,false);});
test('intent compiler recognizes page blog image operations',()=>{const i=compileSovereignIntent('Create a new blog page and generate a better hero image');assert.ok(i.operations.some(x=>['ADD_PAGE','ADD_BLOG'].includes(x)));assert.ok(i.operations.includes('REPLACE_IMAGE'));});
test('competitive genome marks unsupported per-claim evidence',()=>{const g=compileCompetitiveGenome({name:'X',sources:[{id:'s1',url:'https://example.com'}],claims:[{statement:'a',sourceRefs:['s1']},{statement:'b',sourceRefs:[]}]});assert.equal(g.claimStatus,'PARTIAL');assert.equal(g.claims[1].status,'UNSUPPORTED');});
test('competitive genome rejects unknown source ref',()=>assert.throws(()=>compileCompetitiveGenome({name:'X',claims:[{statement:'a',sourceRefs:['missing']}]}),/unknown source/));
test('competitive challenger remains candidate only',()=>{const g=compileCompetitiveGenome({name:'X'});const c=proposeSupersessionChallenger(g,{mechanism:'m',hypothesis:'h',decisiveExperiment:'e'});assert.equal(c.status,'CANDIDATE_ONLY');});
test('achievement debt detects fake Armada and SiteMind',()=>{const d=scanAchievementDebt({claims:['Armada','SiteMind sees the site'],evidence:{armada:{testedAgents:1,independentVerifier:false},siteMind:{browserCaptured:false}}});assert.equal(d.debts.length,2);});
test('artifact DAG rejects cycles',()=>{const a=createArtifact({kind:'SOURCE',contentDigest:'a',producer:'x'}),b=createArtifact({kind:'DERIVED',contentDigest:'b',producer:'y'});assert.throws(()=>buildArtifactDag({artifacts:[a,b],edges:[{from:a.id,to:b.id},{from:b.id,to:a.id}]}),/cycle/i);});
test('experience manifest validates',()=>assert.equal(validateExperienceManifest({id:'h',route:'/',purpose:'home',sections:[],version:'v1',provenance:{}}).valid,true));
test('experience candidate cannot execute itself',()=>{const c=createExperienceCandidate({objective:'x',target:'/',operations:[{type:'UPDATE_LAYOUT'}],proposer:'a'});assert.equal(c.mayExecute,false);});
test('Site Cortex refuses to invent vision without canonical receipt',async()=>{const a=createSiteCortexAdapter({enumerateExperienceSurfaces:async()=>[{route:'/'}],loadExperienceManifest:async()=>({id:'h',route:'/',purpose:'home',sections:[],version:'v1',provenance:{}}),captureRenderedEvidenceReceipt:async()=>null,persistExperienceCandidate:async()=>{},loadReceipt:async()=>null});const o=await observeCustomerSite(a);assert.equal(o.surfaces[0].perceptionState,'CAPABILITY_GAP');});
test('Site Cortex requires screenshot and DOM digests',async()=>{const s=store();const r=s.put(makeReceipt({kind:'BROWSER_OBSERVATION',subjectDigest:'route:/',realm:'VERIFIED_LOCAL',issuer:'browser',payload:{route:'/',browser:'chromium',viewport:'390x844'}}));const a=createSiteCortexAdapter({enumerateExperienceSurfaces:async()=>[{route:'/'}],loadExperienceManifest:async()=>null,captureRenderedEvidenceReceipt:async()=>r.receiptDigest,persistExperienceCandidate:async()=>{},loadReceipt:s.loadReceipt});const o=await observeCustomerSite(a);assert.equal(o.surfaces[0].perceptionState,'CAPABILITY_GAP');});
test('Site Cortex accepts evidence-addressed browser observation',async()=>{const s=store();const r=s.put(makeReceipt({kind:'BROWSER_OBSERVATION',subjectDigest:'route:/',realm:'VERIFIED_LOCAL',issuer:'browser',payload:browserPayload()}));const a=createSiteCortexAdapter({enumerateExperienceSurfaces:async()=>[{route:'/'}],loadExperienceManifest:async()=>({id:'h',route:'/',purpose:'home',sections:[],version:'v1',provenance:{}}),captureRenderedEvidenceReceipt:async()=>r.receiptDigest,persistExperienceCandidate:async()=>{},loadReceipt:s.loadReceipt});const o=await observeCustomerSite(a);assert.equal(fullFabricCoverage(o).visionCoverage,1);});
test('Site Cortex rejects browser observations whose console or accessibility court failed',()=>{for(const key of ['consoleResult','accessibilityResult']){const payload=browserPayload();payload[key]=key==='consoleResult'?{status:'FAIL',errors:1}:{status:'FAIL',violations:1};const receipt=makeReceipt({kind:'BROWSER_OBSERVATION',subjectDigest:'route:/',realm:'VERIFIED_LOCAL',issuer:'browser',payload});assert.throws(()=>validateBrowserObservationReceipt(receipt),(error)=>error?.code===`BROWSER_RECEIPT_${key==='consoleResult'?'CONSOLE':'ACCESSIBILITY'}_FAILED`);}});
test('Site Cortex rejects PASS labels that contradict concrete browser failures',()=>{const payload={...browserPayload(),consoleResult:{status:'PASS',errors:1},accessibilityResult:{status:'PASS',violations:[{id:'critical'}]},layoutResult:{status:'PASS',horizontalOverflow:true}};const receipt=makeReceipt({kind:'BROWSER_OBSERVATION',subjectDigest:'route:/',realm:'VERIFIED_LOCAL',issuer:'browser',payload});assert.throws(()=>validateBrowserObservationReceipt(receipt),(error)=>error?.code==='BROWSER_RECEIPT_CONSOLE_FAILED');});
test('Site Cortex requires concrete layout evidence',()=>{const payload=browserPayload();delete payload.layoutResult;const receipt=makeReceipt({kind:'BROWSER_OBSERVATION',subjectDigest:'route:/',realm:'VERIFIED_LOCAL',issuer:'browser',payload});assert.throws(()=>validateBrowserObservationReceipt(receipt),(error)=>error?.code==='BROWSER_RECEIPT_LAYOUT_REQUIRED');});
test('site operator uses receipt digests not verification booleans',()=>{const p=proposeSiteWork({surface:{route:'/shaw'},evidence:{verifiedInformationGap:true}});assert.equal(p.proposals.length,0);const q=proposeSiteWork({surface:{route:'/shaw'},evidence:{informationGapReceiptDigest:'receipt:x'}});assert.equal(q.proposals[0].type,'ADD_PAGE');});
test('harness tournament requires distinct harnesses and common benchmark',()=>{const h=createHarnessCandidate({name:'h',modelRoute:'m',promptDigest:'p',proposer:'a'});assert.throws(()=>settleHarnessTournament({trials:[{harnessDigest:h.digest,taskDigest:'t',benchmarkContractDigest:'b',score:1,realm:'VERIFIED_LOCAL',receiptDigest:'r1'},{harnessDigest:h.digest,taskDigest:'t',benchmarkContractDigest:'b',score:.5,realm:'VERIFIED_LOCAL',receiptDigest:'r2'}],verifierReceiptDigest:'v'}),/distinct/);});
test('recursive harness needs evidence receipts',()=>assert.equal(recursiveHarnessCheck({parentWinnerDigest:'a',successorDigest:'b',nextCycleReceiptDigest:null,ablationReceiptDigest:'x'}).verdict,'NOT_ESTABLISHED'));
test('workforce compiler does not call one-agent allocation Armada',()=>{const w=compileWorkforce({mission:'x',agents:[{id:'a',tested:true,realm:'VERIFIED_LOCAL',roles:['ARCHITECT','BUILDER','RESEARCHER','WRAITH','VERIFIER'],score:1,trialReceiptDigest:'r'}]});assert.equal(w.isArmada,false);});
test('model arena requires distinct identities',()=>{const a=recordModelTrial({modelId:'m',provider:'p',modelVersion:'1',lane:'code',taskDigest:'t',benchmarkContractDigest:'b',score:.8,realm:'VERIFIED_LOCAL',receiptDigest:'r1'});const b=recordModelTrial({modelId:'m',provider:'p',modelVersion:'1',lane:'code',taskDigest:'t',benchmarkContractDigest:'b',score:.9,realm:'VERIFIED_LOCAL',receiptDigest:'r2'});assert.throws(()=>settleModelArena([a,b],{verifierReceiptDigest:'v'}),/distinct model/);});
test('model arena rejects invalid realm string',()=>assert.throws(()=>recordModelTrial({modelId:'m',provider:'p',modelVersion:'1',lane:'code',taskDigest:'t',benchmarkContractDigest:'b',score:.8,realm:'BANANA',receiptDigest:'r'}),/incomplete/));
test('skill crystallizer counts unique receipts only',()=>assert.throws(()=>proposeSkillFromRuns({name:'s',runs:[1,2,3].map(()=>({verified:true,realm:'VERIFIED_LOCAL',receiptDigest:'same'})),procedure:'x',proposer:'a'}),/unique/));
test('skill promotion requires holdout and verifier receipts',()=>{const s=proposeSkillFromRuns({name:'s',runs:['1','2','3'].map(x=>({verified:true,realm:'VERIFIED_LOCAL',receiptDigest:x})),procedure:'x',proposer:'a'});assert.equal(skillPromotionCourt(s,{hiddenHoldoutReceiptDigest:'h',verifierReceiptDigest:'v'}).verdict,'ELIGIBLE_FOR_GOVERNED_PROMOTION');});
test('adaptation decision chooses lowest proven layer',()=>assert.equal(chooseAdaptationLayer({evaluations:[{layer:'PROMPT',decisive:true,passes:false},{layer:'HARNESS',decisive:true,passes:true}]}).layer,'HARNESS'));
test('frontier supremacy requires same benchmark contract',()=>{const no=buildFrontierLane({lane:'seo',frontierEvidence:{score:.8,benchmarkContractDigest:'a',evaluatorDigest:'e',window:'w',resourceBudgetDigest:'r',receiptDigest:'f'},canaEvidence:{score:.9,benchmarkContractDigest:'b',evaluatorDigest:'e',window:'w',resourceBudgetDigest:'r',receiptDigest:'c'}});assert.equal(no.supremacyClaimAllowed,false);const yes=buildFrontierLane({lane:'seo',frontierEvidence:{score:.8,benchmarkContractDigest:'a',evaluatorDigest:'e',window:'w',resourceBudgetDigest:'r',receiptDigest:'f'},canaEvidence:{score:.9,benchmarkContractDigest:'a',evaluatorDigest:'e',window:'w',resourceBudgetDigest:'r',receiptDigest:'c'}});assert.equal(yes.supremacyClaimAllowed,true);});
test('page factory requires canonical information-gap receipt',async()=>{const s=store();await assert.rejects(()=>compilePageFactoryCandidate({gapReceiptDigest:'missing',evidenceAdapter:{loadReceipt:s.loadReceipt},route:'/shaw',purpose:'guide',proposer:'a'}),/not found/);const g=s.put(makeReceipt({kind:'INFORMATION_GAP',subjectDigest:'gap:shaw',realm:'VERIFIED_LOCAL',issuer:'research',payload:{description:'missing guide'}}));const c=await compilePageFactoryCandidate({gapReceiptDigest:g.receiptDigest,evidenceAdapter:{loadReceipt:s.loadReceipt},route:'/shaw',purpose:'guide',artifactType:'BLOG',proposer:'a'});assert.equal(c.publicationAllowed,false);});
test('full-fabric execution requires promotion receipt bound to candidate',async()=>{const s=store();const c=createExperienceCandidate({objective:'x',target:'/',operations:[{type:'UPDATE_LAYOUT'}],proposer:'a'});const p=s.put(makeReceipt({kind:'PRINCIPAL',subjectDigest:'owner',realm:'VERIFIED_LOCAL',issuer:'auth',payload:{verified:true,subject:'owner',allowedActions:['EXECUTE_EXPERIENCE_CANDIDATE']}}));const adapter=createFullFabricAdapter({enumerateExperienceSurfaces:async()=>[],loadExperienceManifest:async()=>null,persistExperienceCandidate:async()=>{},renderPrivatePreview:async()=>{},captureRenderedEvidenceReceipt:async()=>null,generateMediaCandidate:async()=>{},loadReceipt:s.loadReceipt,resolveVerifiedPrincipalReceipt:async()=>p.receiptDigest,executeWithPromotionClaim:atomicExecution(),rollbackExperienceVersion:async()=>{}});await assert.rejects(()=>executeExperienceThroughCanonicalAuthority(adapter,{candidate:c,principalReceiptDigest:p.receiptDigest,promotionReceiptDigest:'missing'}),/not found/);});
test('proposal-only candidate without an exact result cannot enter promotion',async()=>{const c=createExperienceCandidate({objective:'x',target:'/',operations:[{type:'UPDATE_LAYOUT'}],proposer:'a'});await assert.rejects(()=>experiencePromotionCourt({},c,{}),(error)=>error?.code==='EXPERIENCE_CANDIDATE_RESULT_REQUIRED');});
test('promotion court binds preview browser reality rollback to candidate digest',async()=>{const s=store();const c=createExperienceCandidate({objective:'x',target:'/',operations:[{type:'UPDATE_LAYOUT'}],manifestAfter:exactManifest('/'),proposer:'a'});const p=s.put(makeReceipt({kind:'PRINCIPAL',subjectDigest:'owner',realm:'VERIFIED_LOCAL',issuer:'auth',payload:{verified:true,subject:'owner',allowedActions:['EXECUTE_EXPERIENCE_CANDIDATE']}}));const preview=s.put(makeReceipt({kind:'PRIVATE_PREVIEW',subjectDigest:c.candidateDigest,realm:'VERIFIED_LOCAL',issuer:'preview',payload:{url:'private'}}));const observation=s.put(makeReceipt({kind:'BROWSER_OBSERVATION',subjectDigest:c.candidateDigest,realm:'VERIFIED_LOCAL',issuer:'browser-observer',payload:browserPayload({candidateDigest:c.candidateDigest})}));const browser=s.put(makeReceipt({kind:'COURT',subjectDigest:c.candidateDigest,realm:'VERIFIED_LOCAL',issuer:'browser-court',payload:{court:'BROWSER',verdict:'PASS',observationReceiptDigest:observation.receiptDigest}}));const reality=s.put(makeReceipt({kind:'COURT',subjectDigest:c.candidateDigest,realm:'VERIFIED_LOCAL',issuer:'reality-court',payload:{court:'REALITY',verdict:'PASS'}}));const rollback=s.put(makeReceipt({kind:'ROLLBACK',subjectDigest:c.candidateDigest,realm:'VERIFIED_LOCAL',issuer:'versioning',payload:{targetVersion:'v1'}}));const adapter=createFullFabricAdapter({enumerateExperienceSurfaces:async()=>[],loadExperienceManifest:async()=>null,persistExperienceCandidate:async()=>{},renderPrivatePreview:async()=>{},captureRenderedEvidenceReceipt:async()=>null,generateMediaCandidate:async()=>{},loadReceipt:s.loadReceipt,resolveVerifiedPrincipalReceipt:async()=>p.receiptDigest,executeWithPromotionClaim:atomicExecution(),rollbackExperienceVersion:async()=>{},persistPromotionReceipt:async payload=>{const r=makeReceipt({kind:'PROMOTION',subjectDigest:c.candidateDigest,realm:'VERIFIED_LOCAL',issuer:'promotion-court',payload});s.put(r);return r;}});const pr=await experiencePromotionCourt(adapter,c,{principalReceiptDigest:p.receiptDigest,previewReceiptDigest:preview.receiptDigest,browserObservationReceiptDigest:observation.receiptDigest,browserCourtReceiptDigest:browser.receiptDigest,realityCourtReceiptDigest:reality.receiptDigest,rollbackReceiptDigest:rollback.receiptDigest});assert.equal(pr.kind,'PROMOTION');const executed=await executeExperienceThroughCanonicalAuthority(adapter,{candidate:c,principalReceiptDigest:p.receiptDigest,promotionReceiptDigest:pr.receiptDigest});assert.equal(executed.candidateDigest,c.candidateDigest);});

test('a failed idempotent executor does not consume the promotion before a safe retry', async () => {
  const s = store();
  const candidate = createExperienceCandidate({ objective: 'x', target: '/', operations: [{ type: 'UPDATE_LAYOUT' }], manifestAfter: exactManifest('/'), proposer: 'a' });
  const principal = s.put(makeReceipt({ kind: 'PRINCIPAL', subjectDigest: 'owner', realm: 'VERIFIED_LOCAL', issuer: 'auth', payload: { verified: true, subject: 'owner', allowedActions: ['EXECUTE_EXPERIENCE_CANDIDATE'] } }));
  const promotion = s.put(makeReceipt({ kind: 'PROMOTION', subjectDigest: candidate.candidateDigest, realm: 'VERIFIED_LOCAL', issuer: 'court', payload: { principalReceiptDigest: principal.receiptDigest, manifestAfterDigest: candidate.manifestAfterDigest, allowedEffectSet: ['UPDATE_LAYOUT'] } }));
  let shouldFail = true;
  let claimed = false;
  const adapter = createFullFabricAdapter({
    enumerateExperienceSurfaces: async () => [], loadExperienceManifest: async () => null,
    persistExperienceCandidate: async () => {}, renderPrivatePreview: async () => {},
    captureRenderedEvidenceReceipt: async () => null, generateMediaCandidate: async () => {},
    loadReceipt: s.loadReceipt, resolveVerifiedPrincipalReceipt: async () => principal.receiptDigest,
    executeWithPromotionClaim: async ({ executionInput }) => {
      if (claimed) return false;
      if (shouldFail) { shouldFail = false; throw new Error('EXECUTOR_FAILED'); }
      claimed = true;
      return { ...executionInput, appliedManifestDigest: executionInput.targetManifestDigest };
    },
    rollbackExperienceVersion: async () => {},
  });

  await assert.rejects(
    () => executeExperienceThroughCanonicalAuthority(adapter, { candidate, principalReceiptDigest: principal.receiptDigest, promotionReceiptDigest: promotion.receiptDigest }),
    /EXECUTOR_FAILED/,
  );
  assert.equal(claimed, false, 'failed execution must leave the one-time claim available');
  const result = await executeExperienceThroughCanonicalAuthority(adapter, { candidate, principalReceiptDigest: principal.receiptDigest, promotionReceiptDigest: promotion.receiptDigest });
  assert.equal(result.idempotencyKey, promotion.receiptDigest);
  assert.equal(claimed, true);
});

test('atomic promotion execution serializes concurrent effects', async () => {
  const s = store();
  const candidate = createExperienceCandidate({ objective: 'x', target: '/', operations: [{ type: 'UPDATE_LAYOUT' }], manifestAfter: exactManifest('/'), proposer: 'a' });
  const principal = s.put(makeReceipt({ kind: 'PRINCIPAL', subjectDigest: 'owner', realm: 'VERIFIED_LOCAL', issuer: 'auth', payload: { verified: true, subject: 'owner', allowedActions: ['EXECUTE_EXPERIENCE_CANDIDATE'] } }));
  const promotion = s.put(makeReceipt({ kind: 'PROMOTION', subjectDigest: candidate.candidateDigest, realm: 'VERIFIED_LOCAL', issuer: 'court', payload: { principalReceiptDigest: principal.receiptDigest, manifestAfterDigest: candidate.manifestAfterDigest, allowedEffectSet: ['UPDATE_LAYOUT'] } }));
  let reserved = false;
  let effects = 0;
  const adapter = createFullFabricAdapter({
    enumerateExperienceSurfaces: async () => [], loadExperienceManifest: async () => null,
    persistExperienceCandidate: async () => {}, renderPrivatePreview: async () => {},
    captureRenderedEvidenceReceipt: async () => null, generateMediaCandidate: async () => {},
    loadReceipt: s.loadReceipt, resolveVerifiedPrincipalReceipt: async () => principal.receiptDigest,
    executeWithPromotionClaim: async ({ executionInput }) => {
      if (reserved) throw new Error('PROMOTION_REPLAYED');
      reserved = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      effects += 1;
      return { ...executionInput, appliedManifestDigest: executionInput.targetManifestDigest };
    },
    rollbackExperienceVersion: async () => {},
  });
  const execute = () => executeExperienceThroughCanonicalAuthority(adapter, { candidate, principalReceiptDigest: principal.receiptDigest, promotionReceiptDigest: promotion.receiptDigest });
  const results = await Promise.allSettled([execute(), execute()]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(effects, 1);
});
