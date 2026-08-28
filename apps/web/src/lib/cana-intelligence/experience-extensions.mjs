import { assert, digest, newId, sealPlain } from './core.mjs';
export const EXPERIENCE_OPS=sealPlain(['ADD_PAGE','ADD_BLOG','UPDATE_LAYOUT','REPLACE_IMAGE','UPDATE_THEME','UPDATE_CONTENT','ADD_COMPONENT','REMOVE_COMPONENT']);
export function validateExperienceManifest(manifest){const errors=[];if(!manifest?.id)errors.push('id');if(typeof manifest?.route!=='string'||!manifest.route.startsWith('/'))errors.push('route');if(!manifest?.purpose)errors.push('purpose');if(!Array.isArray(manifest?.sections))errors.push('sections');if(!manifest?.version)errors.push('version');if(!manifest?.provenance)errors.push('provenance');return sealPlain({valid:!errors.length,errors});}
export function createExperienceCandidate({objective,target,operations,manifestBefore=null,proposer,evidenceReceiptDigests=[]}){
  assert(objective&&target&&proposer,'experience candidate incomplete','EXPERIENCE_CANDIDATE_INCOMPLETE');assert(Array.isArray(operations)&&operations.length,'experience operations required','EXPERIENCE_OPS_REQUIRED');
  for(const op of operations)assert(EXPERIENCE_OPS.includes(op.type),'unknown experience operation','EXPERIENCE_OP_UNKNOWN');
  const blast=operations.some(o=>o.type==='UPDATE_THEME'||o.scope==='SITE_WIDE')?'HIGH':operations.some(o=>['ADD_PAGE','ADD_BLOG','UPDATE_LAYOUT'].includes(o.type))?'MEDIUM':'LOW';
  const c={candidateId:newId('experience'),objective,target,operations,manifestBefore,proposer,evidenceReceiptDigests,status:'CANDIDATE_ONLY',blastRadius:blast,authorityRequired:blast==='LOW'?'OWNER_OR_DELEGATED':'OWNER',mayExecute:false,mayPublish:false,createdAt:new Date().toISOString()};
  return sealPlain({...c,candidateDigest:digest(c,'experience_candidate')});
}
