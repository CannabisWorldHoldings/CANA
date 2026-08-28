import { assert, deepFreeze, digest } from './core.mjs';

export const INTENT_MODES = deepFreeze(['READ','PROPOSE','SIMULATE','AUTHORIZE','EXECUTE']);
export const EXPERIENCE_OPERATIONS = deepFreeze([
  'ADD_PAGE','ADD_BLOG','UPDATE_LAYOUT','REPLACE_IMAGE','UPDATE_THEME','UPDATE_CONTENT',
  'ADD_COMPONENT','REMOVE_COMPONENT','CREATE_CAMPAIGN','BUILD_SOFTWARE','TRAIN_MODEL','CHANGE_MODEL_ROUTE','CREATE_SKILL'
]);

const laneLexicon = {
  experience: ['page','homepage','layout','theme','image','blog','article','ui','ux','design','experience','navigation'],
  marketing: ['marketing','campaign','seo','aeo','geo','content','growth','ads','retention','crm'],
  software: ['code','repo','repository','software','backend','frontend','api','database','runtime','deploy'],
  intelligence: ['agent','armada','model','harness','skill','rsi','self-improve','research','reasoning'],
  market: ['market','merchant','customer','demand','supply','price','inventory','neighborhood','competition'],
};

const opMatchers = [
  [/\b(add|create|build|generate)\b.*\b(page|landing page)\b/i,'ADD_PAGE'],
  [/\b(add|create|write|generate)\b.*\b(blog|article|editorial)\b/i,'ADD_BLOG'],
  [/\b(layout|recompose|rearrange|redesign)\b/i,'UPDATE_LAYOUT'],
  [/\b(image|hero|photo|photography|visual asset)\b/i,'REPLACE_IMAGE'],
  [/\b(theme|visual universe|design system)\b/i,'UPDATE_THEME'],
  [/\b(copy|content|headline|text)\b/i,'UPDATE_CONTENT'],
  [/\b(campaign|growth experiment)\b/i,'CREATE_CAMPAIGN'],
  [/\b(code|software|feature|backend|frontend|api)\b/i,'BUILD_SOFTWARE'],
  [/\b(fine[- ]?tun|train model|lora|adapter)\b/i,'TRAIN_MODEL'],
  [/\b(route model|model routing|switch model)\b/i,'CHANGE_MODEL_ROUTE'],
  [/\b(skill|crystalli[sz]e workflow)\b/i,'CREATE_SKILL'],
];

function detectMode(text){
  if (/\b(execute|apply|ship|publish|deploy|promote|rollout|roll out)\b/i.test(text)) return 'EXECUTE';
  if (/\b(authorize|approve|sign off|grant)\b/i.test(text)) return 'AUTHORIZE';
  if (/\b(simulate|what if|counterfactual|preview future)\b/i.test(text)) return 'SIMULATE';
  if (/\b(show|explain|list|what|why|where|which|inspect|query)\b/i.test(text) && !/\b(change|build|create|generate|improve|redesign)\b/i.test(text)) return 'READ';
  return 'PROPOSE';
}

function detectLane(text){
  const t=text.toLowerCase();
  const scores=Object.entries(laneLexicon).map(([lane,terms])=>({lane,score:terms.reduce((n,term)=>n+(t.includes(term)?term.length:0),0)})).sort((a,b)=>b.score-a.score);
  return scores[0].score ? scores[0].lane : 'intelligence';
}

function detectOperations(text){
  const out=[];
  for (const [re,op] of opMatchers) if (re.test(text) && !out.includes(op)) out.push(op);
  return out;
}

function blastRadius(mode, operations, text){
  if (mode==='READ' || mode==='SIMULATE') return 'NONE';
  if (/\b(global|sitewide|entire site|all pages|production|database|payment|pricing)\b/i.test(text)) return 'HIGH';
  if (operations.some(op=>['UPDATE_THEME','BUILD_SOFTWARE','TRAIN_MODEL','CREATE_CAMPAIGN'].includes(op))) return 'MEDIUM';
  return 'LOW';
}

export function compileSovereignIntent(raw, { actor='OWNER' }={}){
  assert(typeof raw==='string' && raw.trim(), 'intent must be non-empty', 'INTENT_INVALID');
  const text=raw.trim();
  const mode=detectMode(text);
  const operations=detectOperations(text);
  const blast=blastRadius(mode,operations,text);
  const requiresVerifiedPrincipal = mode==='AUTHORIZE' || mode==='EXECUTE';
  const route = mode==='READ' ? ['PERCEIVE','WORLD_STATE','ANSWER']
    : mode==='SIMULATE' ? ['PERCEIVE','WORLD_STATE','CONSTRAINTS','SIMULATE','PREDICT']
    : mode==='PROPOSE' ? ['PERCEIVE','WORLD_STATE','CONSTRAINTS','CANDIDATES','WRAITH','COURTS','PREVIEW']
    : ['POLICY','VERIFY_PRINCIPAL','AUTHORIZE','NARROW_EXECUTOR','OBSERVE','SETTLE','LEARN'];
  return deepFreeze({
    raw:text, actor, mode, lane:detectLane(text), operations, blastRadius:blast,
    requiresVerifiedPrincipal,
    authorityClaimed:false,
    authorityNote: requiresVerifiedPrincipal ? 'Intent compilation NEVER authenticates or authorizes. Canonical CANA must resolve a verified principal.' : 'No mutation authority required.',
    reversibleByDefault: !operations.includes('TRAIN_MODEL'),
    route,
    digest:digest({text,mode,operations,blast,actor},'intent'),
  });
}
