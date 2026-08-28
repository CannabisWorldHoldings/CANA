import { decorateFreshness, evidenceCanSupportReality } from './epistemics.mjs';
import { sealPlain } from './core.mjs';
function overlaps(a,b){
  // Without explicit validity windows, observations are snapshots: temporal change is succession, not contradiction.
  if(!a.validFrom&&!a.validTo&&!b.validFrom&&!b.validTo) return a.observedAt===b.observedAt;
  const a0=new Date(a.validFrom??a.observedAt).getTime(), a1=new Date(a.validTo??'9999-12-31T23:59:59.999Z').getTime();
  const b0=new Date(b.validFrom??b.observedAt).getTime(), b1=new Date(b.validTo??'9999-12-31T23:59:59.999Z').getTime();
  return Math.max(a0,b0)<=Math.min(a1,b1);
}
function validAt(o,at){const t=new Date(at).getTime(); const lo=new Date(o.validFrom??o.observedAt).getTime(); const hi=new Date(o.validTo??'9999-12-31T23:59:59.999Z').getTime(); return t>=lo&&t<=hi;}
export class RealityGraph{
  constructor(observations=[],now=new Date()){
    this.now=new Date(now).toISOString(); this.observations=observations.map(o=>decorateFreshness(o,now)).filter(o=>!o.supersededBy); this.byEntity=new Map();
    for(const obs of this.observations){if(!this.byEntity.has(obs.entityKey))this.byEntity.set(obs.entityKey,[]);this.byEntity.get(obs.entityKey).push(obs);}
    for(const rows of this.byEntity.values()) rows.sort((a,b)=>new Date(b.observedAt)-new Date(a.observedAt));
  }
  resolve(entityKey,predicate,{at=null}={}){
    let rows=(this.byEntity.get(entityKey)??[]).filter(o=>o.predicate===predicate); if(at) rows=rows.filter(o=>validAt(o,at));
    if(!rows.length)return sealPlain({entityKey,predicate,epistemicState:'UNKNOWN',value:null});
    const latest=rows[0]; const conflicting=rows.filter(o=>evidenceCanSupportReality(o)&&o.evidenceDigest!==latest.evidenceDigest&&overlaps(o,latest)&&JSON.stringify(o.value)!==JSON.stringify(latest.value));
    if(conflicting.length)return sealPlain({...latest,epistemicState:'CONTRADICTED',conflictingEvidence:[latest.evidenceDigest,...conflicting.map(o=>o.evidenceDigest)]});
    return latest;
  }
  entity(entityKey){const rows=this.byEntity.get(entityKey)??[];const predicates=[...new Set(rows.map(o=>o.predicate))];return sealPlain({entityKey,claims:Object.fromEntries(predicates.map(p=>[p,this.resolve(entityKey,p)]))});}
  ledger(){const byState={},bySource={};for(const o of this.observations){byState[o.epistemicState]=(byState[o.epistemicState]??0)+1;bySource[o.sourceKind]=(bySource[o.sourceKind]??0)+1;}return sealPlain({total:this.observations.length,byState,bySource});}
}
