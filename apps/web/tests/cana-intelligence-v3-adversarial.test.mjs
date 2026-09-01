import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  makeReceipt, validateReceiptShape, createExperienceCandidate, createFullFabricAdapter, executeExperienceThroughCanonicalAuthority,
  createSiteCortexAdapter, observeCustomerSite, recordModelTrial, settleModelArena, createHarnessCandidate, settleHarnessTournament,
  proposeSkillFromRuns, buildFrontierLane, makeObservation, RealityGraph, recursiveHarnessCheck, recursiveImproverCourt,
  preregisterExperiment, commitmentForSalt, makeAssignmentReceipt, makeExposureReceipt, makeOutcomeReceipt,
  createCanonicalEvidenceAdapter, settleExperiment, authorizeExperiment,
} from '../src/lib/cana-intelligence/index.mjs';
import {
  resolveArmadaAdapter,
  runCommandAgent,
} from '../../../tools/cana-armada/command-executor.mjs';
function store(){const m=new Map(),ledgers=new Map();return {m,ledgers,put:r=>(m.set(r.receiptDigest,r),r),adapter:createCanonicalEvidenceAdapter({loadReceipt:async d=>m.get(d)??null,loadLesson:async()=>null,loadExperimentLedger:async id=>ledgers.get(id)??{assignments:[],exposures:[],outcomes:[]}})};}

test('forged receipt digest is rejected',()=>{const r=makeReceipt({kind:'COURT',subjectDigest:'x',issuer:'v',payload:{court:'BROWSER',verdict:'PASS'}});assert.throws(()=>validateReceiptShape({...r,payload:{court:'BROWSER',verdict:'FAIL'}}),/digest mismatch/);});
test('unknown receipt realm is rejected',()=>assert.throws(()=>makeReceipt({kind:'COURT',subjectDigest:'x',realm:'BANANA',issuer:'v'}),/realm/));
test('SiteMind cannot upgrade boolean capture flags into perception',async()=>{const a=createSiteCortexAdapter({enumerateExperienceSurfaces:async()=>[{route:'/'}],loadExperienceManifest:async()=>null,captureRenderedEvidenceReceipt:async()=>null,persistExperienceCandidate:async()=>{},loadReceipt:async()=>null});const o=await observeCustomerSite(a);assert.equal(o.surfaces[0].perceptionState,'CAPABILITY_GAP');});
test('execution cannot accept never-courted candidate',async()=>{const c=createExperienceCandidate({objective:'x',target:'/',operations:[{type:'UPDATE_LAYOUT'}],proposer:'a'});const s=store();const p=s.put(makeReceipt({kind:'PRINCIPAL',subjectDigest:'owner',realm:'VERIFIED_LOCAL',issuer:'auth',payload:{verified:true,subject:'owner',allowedActions:['EXECUTE_EXPERIENCE_CANDIDATE']}}));const a=createFullFabricAdapter({enumerateExperienceSurfaces:async()=>[],loadExperienceManifest:async()=>null,persistExperienceCandidate:async()=>{},renderPrivatePreview:async()=>{},captureRenderedEvidenceReceipt:async()=>null,generateMediaCandidate:async()=>{},loadReceipt:async d=>s.m.get(d)??null,resolveVerifiedPrincipalReceipt:async()=>p.receiptDigest,executeWithPromotionClaim:async()=>({executed:true}),rollbackExperienceVersion:async()=>{}});await assert.rejects(()=>executeExperienceThroughCanonicalAuthority(a,{candidate:c,principalReceiptDigest:p.receiptDigest,promotionReceiptDigest:'promotion:fake'}),/not found/);});
test('same model twice cannot form arena',()=>{const a=recordModelTrial({modelId:'m',provider:'p',modelVersion:'1',lane:'x',taskDigest:'t',benchmarkContractDigest:'b',score:1,realm:'VERIFIED_LOCAL',receiptDigest:'r1'}),b=recordModelTrial({modelId:'m',provider:'p',modelVersion:'1',lane:'x',taskDigest:'t',benchmarkContractDigest:'b',score:.9,realm:'VERIFIED_LOCAL',receiptDigest:'r2'});assert.throws(()=>settleModelArena([a,b],{verifierReceiptDigest:'v'}),/distinct/);});
test('same harness twice cannot form tournament',()=>{const h=createHarnessCandidate({name:'h',modelRoute:'m',promptDigest:'p',proposer:'a'});assert.throws(()=>settleHarnessTournament({trials:[1,2].map((_,i)=>({harnessDigest:h.digest,taskDigest:'t',benchmarkContractDigest:'b',score:1-i*.1,realm:'VERIFIED_LOCAL',receiptDigest:`r${i}`})),verifierReceiptDigest:'v'}),/distinct/);});
test('duplicate skill run receipt cannot fake replication',()=>assert.throws(()=>proposeSkillFromRuns({name:'s',runs:[1,2,3].map(()=>({verified:true,realm:'VERIFIED_LOCAL',receiptDigest:'r'})),procedure:'x',proposer:'a'}),/unique/));
test('different benchmark contracts cannot justify supremacy',()=>assert.equal(buildFrontierLane({lane:'x',frontierEvidence:{score:.8,benchmarkContractDigest:'b1',evaluatorDigest:'e',window:'w',resourceBudgetDigest:'r',receiptDigest:'f'},canaEvidence:{score:.9,benchmarkContractDigest:'b2',evaluatorDigest:'e',window:'w',resourceBudgetDigest:'r',receiptDigest:'c'}}).supremacyClaimAllowed,false));
test('temporal succession does not poison reality graph',()=>{const a=makeObservation({entityKey:'m',predicate:'hours',value:'9-5',sourceKind:'CANONICAL_REALITY',provenance:{},observedAt:'2026-08-01T00:00:00Z'}),b=makeObservation({entityKey:'m',predicate:'hours',value:'10-6',sourceKind:'CANONICAL_REALITY',provenance:{},observedAt:'2026-08-02T00:00:00Z'});assert.equal(new RealityGraph([a,b]).resolve('m','hours').value,'10-6');});
test('sealed observation contains no mutable Date',()=>{const o=makeObservation({entityKey:'m',predicate:'p',value:1,sourceKind:'CANONICAL_REALITY',provenance:{},observedAt:new Date()});assert.equal(typeof o.observedAt,'string');});
test('recursive harness claim requires next-cycle receipt not boolean',()=>assert.equal(recursiveHarnessCheck({parentWinnerDigest:'a',successorDigest:'b',nextCycleReceiptDigest:null,ablationReceiptDigest:'ab'}).verdict,'NOT_ESTABLISHED'));
test('recursive improver claim requires successor identity change and receipts',()=>assert.equal(recursiveImproverCourt({parentImproverDigest:'a',successorImproverDigest:'a',nextCycleReceiptDigest:'n',ablationReceiptDigest:'a'}).verdict,'NOT_ESTABLISHED'));
test('source-registered command agent receives no parent secret, HOME, or effect authority', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cana-armada-env-'));
  process.env.CANA_FAKE_SECRET = 'DO_NOT_LEAK';
  const run = await runCommandAgent({
    adapter: resolveArmadaAdapter('fixture-agent-a', 'candidate'),
    cwd,
    input: JSON.stringify({ lane: 'fixture' }),
  });
  const output = JSON.parse(run.stdout);
  assert.equal(output.inheritedSecret, null);
  assert.equal(output.inheritedHome, null);
  assert.equal(output.effectAuthority, 'NONE');
  assert.equal(run.effectAuthority, 'NONE');
  delete process.env.CANA_FAKE_SECRET;
  await fs.rm(cwd, { recursive: true, force: true });
});
test('caller cannot forge a command adapter or select an executable', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cana-armada-forge-'));
  await assert.rejects(
    () => runCommandAgent({
      adapter: {
        adapterId: 'fixture-agent-a',
        role: 'candidate',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
      },
      cwd,
      input: '',
    }),
    (error) => error?.code === 'ARMADA_ADAPTER_NOT_AUTHORIZED',
  );
  assert.throws(
    () => resolveArmadaAdapter('/bin/sh', 'candidate'),
    (error) => error?.code === 'ARMADA_ADAPTER_NOT_AUTHORIZED',
  );
  await fs.rm(cwd, { recursive: true, force: true });
});
test('post-registration minimum sample cannot be changed at settlement',async()=>{const s=store();const principal=s.put(makeReceipt({kind:'PRINCIPAL',subjectDigest:'owner',realm:'VERIFIED_LOCAL',issuer:'auth',payload:{verified:true,subject:'owner',allowedActions:['AUTHORIZE_EXPERIMENT','SETTLE_EXPERIMENT']}}));const salt='0123456789abcdef';let e=preregisterExperiment({hypothesis:'x',unit:'session',primaryMetric:'m',treatment:'A',comparator:'B',assignmentMethod:'RANDOMIZED',assignmentSaltCommitment:commitmentForSalt(salt),exposureDefinition:'x',analysisMethod:'two-proportion-z',minimumPerArm:50,stopRule:'n',rollbackPlan:'r',interferenceAssumptions:'none',maximumClaimCeiling:'m',proposerId:'a'});e=await authorizeExperiment(e,s.adapter,principal.receiptDigest);const A=[],X=[],O=[];for(let i=0;i<30;i++){const a=makeAssignmentReceipt({experiment:e,unitId:`u${i}`,assignmentSalt:salt});s.put(a);A.push(a.receiptDigest);const x=makeExposureReceipt({experiment:e,assignmentReceipt:a,exposed:true,exposureEvidenceDigest:`x${i}`});s.put(x);X.push(x.receiptDigest);const o=makeOutcomeReceipt({experiment:e,exposureReceipt:x,success:a.payload.arm==='TREATMENT',outcomeEvidenceDigest:`o${i}`});s.put(o);O.push(o.receiptDigest);}s.ledgers.set(e.experimentId,{assignments:A,exposures:X,outcomes:O});const settled=await settleExperiment(e,s.adapter,principal.receiptDigest);assert.equal(settled.minimumPerArm,50);assert.equal(settled.sufficient,false);});

test('prediction cannot settle before its window closes',async()=>{const {lockPrediction,settlePrediction}=await import('../src/lib/cana-intelligence/index.mjs');const s=store();const p=lockPrediction({worldStateDigest:'w',hypothesis:'demand rises',expectedDirection:'UP',windowStart:'2026-08-24T00:00:00Z',windowEnd:'2026-08-25T00:00:00Z',falsificationRule:'delta<=0'});const o=s.put(makeReceipt({kind:'PREDICTION_OUTCOME',subjectDigest:p.lockDigest,realm:'VERIFIED_LOCAL',issuer:'observer',payload:{actualDelta:0.2}}));await assert.rejects(()=>settlePrediction(p,o.receiptDigest,s.adapter,new Date('2026-08-24T12:00:00Z')),/window has not closed/);});
test('prediction settlement requires receipt bound to lock digest',async()=>{const {lockPrediction,settlePrediction}=await import('../src/lib/cana-intelligence/index.mjs');const s=store();const p=lockPrediction({worldStateDigest:'w',hypothesis:'demand rises',expectedDirection:'UP',windowStart:'2026-08-24T00:00:00Z',windowEnd:'2026-08-25T00:00:00Z',falsificationRule:'delta<=0'});const o=s.put(makeReceipt({kind:'PREDICTION_OUTCOME',subjectDigest:'wrong',realm:'VERIFIED_LOCAL',issuer:'observer',payload:{actualDelta:0.2}}));await assert.rejects(()=>settlePrediction(p,o.receiptDigest,s.adapter,new Date('2026-08-26T00:00:00Z')),/subject mismatch/);});
test('prediction scores direction and magnitude from observed receipt',async()=>{const {lockPrediction,settlePrediction}=await import('../src/lib/cana-intelligence/index.mjs');const s=store();const p=lockPrediction({worldStateDigest:'w',hypothesis:'demand rises',expectedDirection:'UP',magnitudeRange:[0.1,0.3],windowStart:'2026-08-24T00:00:00Z',windowEnd:'2026-08-25T00:00:00Z',falsificationRule:'delta<=0'});const o=s.put(makeReceipt({kind:'PREDICTION_OUTCOME',subjectDigest:p.lockDigest,realm:'VERIFIED_LOCAL',issuer:'observer',payload:{actualDelta:0.2}}));const r=await settlePrediction(p,o.receiptDigest,s.adapter,new Date('2026-08-26T00:00:00Z'));assert.equal(r.directionalCorrect,true);assert.equal(r.magnitudeCorrect,true);});
test('wilson and two-proportion handle basic boundaries',async()=>{const {wilson,twoProportion}=await import('../src/lib/cana-intelligence/index.mjs');assert.deepEqual(wilson(0,0),[0,1]);assert.equal(twoProportion(0,0,1,1),null);const r=twoProportion(10,100,30,100);assert.ok(r.lift>0);assert.ok(r.ciLo>0);});
test('opportunity baseline detects price mismatch and answerability gap',async()=>{const {buildDemandGraph,discoverOpportunities}=await import('../src/lib/cana-intelligence/index.mjs');const events=Array.from({length:5},(_,i)=>({eventId:`p${i}`,kind:i<3?'ZERO_RESULTS':'ASK',provenanceState:'OBSERVED',observedAt:new Date(),dimensions:{market:'US-DC',neighborhood:'Shaw',category:'flower',fulfillment:'delivery',priceCapUsd:20}}));const graph=buildDemandGraph(events);const supply=[{epistemicState:'KNOWN',market:'US-DC',neighborhood:'Shaw',category:'flower',fulfillment:'delivery',priceUsd:40}];const kinds=new Set(discoverOpportunities({demandGraph:graph,supply}).map(x=>x.kind));assert.ok(kinds.has('PRICE_MISMATCH'));assert.ok(kinds.has('ANSWERABILITY_GAP'));});
