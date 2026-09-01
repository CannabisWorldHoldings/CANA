import { assert, deepFreeze, digest, newId } from './core.mjs';

export function createArtifact({kind,contentDigest,producer,evidenceRealm='IMPLEMENTED_UNVERIFIED',metadata={}}){
  assert(kind && contentDigest && producer,'artifact kind/contentDigest/producer required','ARTIFACT_INCOMPLETE');
  const a={id:newId('artifact'),kind,contentDigest,producer,evidenceRealm,metadata,createdAt:new Date().toISOString()};
  return deepFreeze({...a,artifactDigest:digest(a,'artifact')});
}

export function buildArtifactDag({artifacts=[],edges=[]}){
  const ids=new Set(artifacts.map(a=>a.id));
  for(const e of edges){
    assert(ids.has(e.from) && ids.has(e.to),'artifact edge references unknown node','ARTIFACT_EDGE_UNKNOWN');
    assert(e.from!==e.to,'artifact self-edge forbidden','ARTIFACT_CYCLE');
  }
  const adj=new Map([...ids].map(id=>[id,[]]));
  for(const e of edges) adj.get(e.from).push(e.to);
  const visiting=new Set(),visited=new Set();
  function dfs(id){
    if(visiting.has(id)) throw Object.assign(new Error('artifact DAG cycle detected'),{code:'ARTIFACT_CYCLE'});
    if(visited.has(id)) return;
    visiting.add(id); for(const n of adj.get(id)) dfs(n); visiting.delete(id); visited.add(id);
  }
  for(const id of ids) dfs(id);
  const dag={artifacts,edges};
  return deepFreeze({...dag,digest:digest(dag,'artifact_dag')});
}
