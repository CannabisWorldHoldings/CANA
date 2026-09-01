import { deepFreeze } from './core.mjs';

const ORDER=['PROMPT','RETRIEVAL','TOOLS','HARNESS','MODEL_ROUTE','MEMORY','FINE_TUNE','PREFERENCE_OPTIMIZATION'];

export function chooseAdaptationLayer({evaluations=[]}){
  const by=new Map(evaluations.map(e=>[e.layer,e]));
  for(const layer of ORDER){
    const e=by.get(layer);
    if(e?.decisive===true && e?.passes===true) return deepFreeze({layer,reason:e.reason??'lowest sufficient proven layer',requiresTraining:layer==='FINE_TUNE'||layer==='PREFERENCE_OPTIMIZATION'});
  }
  return deepFreeze({layer:'UNKNOWN',reason:'No supplied evaluation establishes a sufficient adaptation layer',requiresTraining:false});
}
