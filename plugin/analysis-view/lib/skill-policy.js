// A preset-owned deny overlay using DSH's public Skill provider contract.
// No original Skill file is edited and no copied Skill body is retained.
export const inject=['skills'];
export const POLICY_MODULE='dsh-analysis-view/skill-policy';
export const POLICY_ID='trajectory-skill-policy';
export const POLICY_PROVIDER='trajectory-preset-skill-policy';
export function disabledSkillNames(rows=[]){
  return new Set(rows.filter(row=>row.name===POLICY_MODULE&&row.disabled!==true)
    .flatMap(row=>Array.isArray(row.config?.disabled)?row.config.disabled:[]).map(item=>typeof item==='string'?item:item.name));
}
export function apply(ctx,config={}){
  const rows=config.disabled??[];
  if(!Array.isArray(rows))throw new TypeError('disabled skills must be an array');
  const definitions=new Map();
  for(const item of rows){
    const name=typeof item==='string'?item:item.name;
    if(typeof name!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))throw new TypeError('invalid disabled Skill name');
    definitions.set(name,{name,description:typeof item?.description==='string'&&item.description?item.description:'Disabled in this preset.',
      invocation:{modelInvocable:false,userInvocable:false},source:'runtime',provider:POLICY_PROVIDER,
      rank:-1000000,locator:name,content:''});
  }
  // registerProvider itself owns registration, invalidation and cancellation via
  // Cordis effects. Even an empty plugin disposer cannot leave this entry behind.
  ctx.skills.registerProvider(()=>({name:POLICY_PROVIDER,
    list:async()=>[...definitions.values()],
    get:async candidate=>definitions.get(candidate.name),
  }));
}
