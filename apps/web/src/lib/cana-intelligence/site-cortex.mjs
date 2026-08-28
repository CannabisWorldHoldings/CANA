import { assert, digest, sealPlain, deepFreeze } from './core.mjs';
import { resolveCanonicalReceipt } from './receipts.mjs';
export function createSiteCortexAdapter(impl){for(const key of ['enumerateExperienceSurfaces','loadExperienceManifest','captureRenderedEvidenceReceipt','persistExperienceCandidate','loadReceipt'])assert(typeof impl?.[key]==='function',`site cortex adapter missing ${key}`,'SITE_CORTEX_ADAPTER_INCOMPLETE');return deepFreeze({...impl,ownsRoutes:false,ownsTruthStore:false,ownsAuth:false});}
export async function observeCustomerSite(adapter){
  const surfaces=await adapter.enumerateExperienceSurfaces();assert(Array.isArray(surfaces),'enumerateExperienceSurfaces must return array','SITE_ENUM_INVALID');const rows=[];
  for(const surface of surfaces){const manifest=await adapter.loadExperienceManifest(surface);const receiptDigest=await adapter.captureRenderedEvidenceReceipt(surface);let receipt=null,perceptionState='CAPABILITY_GAP';
    if(receiptDigest){receipt=await resolveCanonicalReceipt(adapter,receiptDigest,{kind:'BROWSER_OBSERVATION',minimumRealm:'VERIFIED_LOCAL'});const p=receipt.payload??{};assert(p.route,'browser receipt route required','BROWSER_RECEIPT_ROUTE_REQUIRED');assert(p.screenshotDigest&&p.domDigest&&p.browser&&p.viewport,'browser receipt missing rendered evidence','BROWSER_RECEIPT_INCOMPLETE');perceptionState='OBSERVED_RENDERED_REALITY';}
    rows.push({surface,manifest:manifest??null,browserObservationReceipt:receipt?.receiptDigest??null,perceptionState});
  }
  const graph={surfaces:rows,nodes:rows.flatMap(r=>[{id:`route:${r.surface.route??r.surface}`,kind:'ROUTE'},...(r.manifest?.sections??[]).map((s,i)=>({id:`section:${r.surface.route??r.surface}:${s.id??i}`,kind:'SECTION'}))])};
  return sealPlain({...graph,digest:digest(graph,'site_cortex')});
}
export function fullFabricCoverage(observation){const rows=observation?.surfaces??[],total=rows.length;if(!total)return sealPlain({total:0,manifestCoverage:0,visionCoverage:0,status:'NO_SURFACES'});const manifest=rows.filter(r=>r.manifest).length/total,vision=rows.filter(r=>r.perceptionState==='OBSERVED_RENDERED_REALITY').length/total;return sealPlain({total,manifestCoverage:manifest,visionCoverage:vision,status:manifest===1&&vision===1?'FULLY_OBSERVED':'PARTIAL'});}
