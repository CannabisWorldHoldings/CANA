import { sealPlain, digest, assert, clamp, iso } from './core.mjs';
export const EPISTEMIC_STATES=sealPlain(['KNOWN','UNKNOWN','STALE','CONTRADICTED','INFERRED','SYNTHETIC','CAPABILITY_GAP']);
export const DEFAULT_SOURCE_REGISTRY=sealPlain({
  CANONICAL_REALITY:{trustTier:5,ceiling:'KNOWN',observed:true}, USER_INTERACTION:{trustTier:4,ceiling:'KNOWN',observed:true},
  SITEMIND_SCAN:{trustTier:4,ceiling:'KNOWN',observed:true}, OPERATOR_ATTESTATION:{trustTier:3,ceiling:'KNOWN',observed:true},
  DERIVED:{trustTier:2,ceiling:'INFERRED',observed:false}, EXTERNAL_REPORT:{trustTier:2,ceiling:'INFERRED',observed:false},
  TEST_FIXTURE:{trustTier:0,ceiling:'SYNTHETIC',observed:false}, SIMULATOR:{trustTier:0,ceiling:'SYNTHETIC',observed:false},
});
const VALUE_RANK=new Map([['SYNTHETIC',0],['INFERRED',1],['KNOWN',2]]);
export function enforceCeiling(requested,ceiling){
  if(!EPISTEMIC_STATES.includes(requested)) throw new Error(`Unknown epistemic state: ${requested}`);
  if(['UNKNOWN','STALE','CONTRADICTED','CAPABILITY_GAP'].includes(requested)) return requested;
  return VALUE_RANK.get(requested)>VALUE_RANK.get(ceiling)?ceiling:requested;
}
export function makeObservation(input,registry=DEFAULT_SOURCE_REGISTRY){
  const source=registry[input.sourceKind]; assert(source,`Unknown source kind ${input.sourceKind}`,'UNKNOWN_SOURCE_KIND');
  assert(typeof input.entityKey==='string'&&input.entityKey,'entityKey required'); assert(typeof input.predicate==='string'&&input.predicate,'predicate required');
  assert(input.provenance&&typeof input.provenance==='object','provenance required','PROVENANCE_REQUIRED');
  const observedAt=iso(input.observedAt); const validFrom=input.validFrom?iso(input.validFrom):null; const validTo=input.validTo?iso(input.validTo):null;
  if(validFrom&&validTo) assert(new Date(validFrom)<=new Date(validTo),'validFrom must be <= validTo','INVALID_VALIDITY_WINDOW');
  const requestedState=input.requestedState??source.ceiling; const epistemicState=enforceCeiling(requestedState,source.ceiling);
  const evidencePayload={entityKey:input.entityKey,predicate:input.predicate,value:input.value,sourceKind:input.sourceKind,provenance:input.provenance,observedAt,validFrom,validTo};
  return sealPlain({
    id:input.id??null,entityKey:input.entityKey,predicate:input.predicate,value:input.value,unit:input.unit??null,sourceKind:input.sourceKind,
    provenance:{...input.provenance,requestedState,enforcedState:epistemicState},observedAt,validFrom,validTo,expiresAt:input.expiresAt?iso(input.expiresAt):null,
    evidenceDigest:digest(evidencePayload),confidence:input.confidence==null?null:clamp(input.confidence),epistemicState,authority:'ZERO',
    supersededBy:input.supersededBy??null,correctionOf:input.correctionOf??null,downgraded:epistemicState!==requestedState,
  });
}
export function decorateFreshness(observation,now=new Date()){
  if(!observation.expiresAt) return observation; const expired=new Date(now).getTime()>new Date(observation.expiresAt).getTime();
  if(!expired||!['KNOWN','INFERRED'].includes(observation.epistemicState)) return observation;
  return sealPlain({...observation,epistemicState:'STALE'});
}
export function evidenceCanSupportReality(observation){return observation.epistemicState==='KNOWN'&&!['SIMULATOR','TEST_FIXTURE'].includes(observation.sourceKind);}
