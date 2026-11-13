import { join, resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { configurationReceipt } from '../lib/lifecycle-observation.mjs';
import { loadManagementSdk, readComposition, configurationTargets, hash, textFile, toolPatch, toolEnabledIn, presetSkillPatch, applyOwnedPatch, allEntries } from './dsh-management-config.mjs';

import { disabledSkillNames, POLICY_MODULE } from '../plugin/analysis-view/lib/skill-policy.js';

const publicTarget=t=>Object.fromEntries(Object.entries(t).filter(([key])=>!key.startsWith('_')));

async function resolvedDestination(file){
  const tail=[];let parent=resolve(file);
  for(;;){try{return join(await realpath(parent),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const next=dirname(parent);if(next===parent)throw error;tail.push(relative(next,parent));parent=next;}}
}

const cacheNotice='工具声明变化会破坏已加载相关工具的会话的前缀缓存复用。建议确认相关对话不再使用这些工具后再停用。';
export class DshManagement {
  constructor({home=join(homedir(),'.dsh'),profileRoot=join(home,'profiles','web'),workspace=process.cwd(),storage=resolve('.dsh/preset-context-demo/management'),readSnapshot,api,clock=Date.now,reconcile}={}){
    Object.assign(this,{home:resolve(home),profileRoot:resolve(profileRoot),workspace:resolve(workspace),storage:resolve(storage),readSnapshot,clock,reconcile});
    this.api=api?Promise.resolve(api):loadManagementSdk();this.plans=new Map();this.queue=Promise.resolve();
  }
  async state(){return JSON.parse(await textFile(join(this.storage,'state.json'))??'{"skills":{},"operations":[]}');}
  async inventory(preset){
    const api=await this.api, config=await readComposition(api,this),snapshot=await this.readSnapshot(),state=await this.state();
    const current=snapshot.presets.find(p=>p.id===preset);if(!current)throw new Error('预设不存在');
    const targets=await configurationTargets(api,config,this.profileRoot,preset);
    targets.push(...await this.skillTargets(current,config,api));
    return {api,config,state,targets};
  }
  async skillTargets(current,config,api){
    const declaration=allEntries(config.entries).find(r=>r.name==='@deepseek-ai/dsh-agent-preset'&&r.config?.id===current.id);
    const blocked=disabledSkillNames(declaration?.config?.plugins),targets=[];
    let available=true;try{createRequire(join(this.profileRoot,'package.json')).resolve(POLICY_MODULE);}catch{available=false;}
    for(const skill of [...current.skills,...current.disabledSkills??[]]){
      const sourceText=await textFile(skill.path);let reason=null,nativeInvocation;
      try{const match=sourceText?.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);const meta=match&&api.yaml.parse(match[1]);
        if(!meta)throw Error('missing metadata');nativeInvocation={modelInvocable:meta['disable-model-invocation']!==true,userInvocable:meta['user-invocable']!==false};
      }catch{reason='Skill 文件已变化，请刷新';}
      if(nativeInvocation?.modelInvocable===false&&nativeInvocation?.userInvocable===false)reason='此 Skill 的源文件已停用，需先恢复文件调用策略';
      if(!available)reason='当前 DSH 尚未安装轨迹树 Skill 策略组件';
      targets.push({id:hash(['skill',this.workspace,current.id,skill.name]),kind:'skill',name:skill.name,
        enabled:!blocked.has(skill.name)&&(nativeInvocation?.modelInvocable!==false||nativeInvocation?.userInvocable!==false),
        source:skill.path,origin:skill.provenance?.origin??(skill.package?'official':'personal'),scope:current.name+' 预设',preset:current.id,
        affected:[skill.name],method:'预设 Skill 策略',reason,_skill:skill,_sourceText:sourceText});
    }
    return targets;
  }
  async skillScopes(name){
    const api=await this.api,config=await readComposition(api,this),snapshot=await this.readSnapshot();
    const rows=[];
    for(const preset of snapshot.presets){
      const target=(await this.skillTargets({...preset,skills:preset.skills.filter(s=>s.name===name),disabledSkills:(preset.disabledSkills??[]).filter(s=>s.name===name)},config,api))[0];
      rows.push(target?{...publicTarget(target),available:true,preset:preset.id,presetName:preset.name}:{preset:preset.id,presetName:preset.name,available:false,enabled:false});
    }
    return {name,rows};
  }
  async list(preset){const {targets,state}=await this.inventory(preset);return {targets:targets.map(publicTarget),recent:state.operations.slice(-5).reverse(),runtime:'not-connected'};}
  async preview({preset,id,enabled}){
    if(typeof enabled!=='boolean')throw new Error('缺少目标状态');
    const context=await this.inventory(preset),target=context.targets.find(t=>t.id===id);
    if(!target)throw new Error('当前配置中没有此项，请刷新');
    if(target.reason)throw new Error(target.reason);
    if(target.enabled===enabled)throw new Error('此项已经处于所选状态，请刷新');
    const {api,config}=context;
    let change;
    if(target.kind==='bundle'){
      if(enabled){
        const meta=api.operations.bundleManifest(target.source,this.profileRoot,api.anchor);
        if(!meta)throw new Error('不是可启用的 DSH 插件包');
        api.boot.assertBundlePlatform(meta.dsh?.bundle?.platforms,process.platform);
        const compatibility=api.boot.evaluatePluginCompatibility(meta,api.boot.readProfileVersionExemptions(this.profileRoot));
        if(compatibility&&!compatibility.exempted)throw new Error('插件版本与当前 DSH 不兼容，请先在官方插件管理中处理');
      }
      const previous=config.manifest.dsh?.profile?.bundles??[];
      change={type:'bundle',file:config.manifestFile,before:await textFile(config.manifestFile),bundles:enabled?[...previous,target.source]:previous.filter(n=>n!==target.source)};
    }else{
      const patch=target.kind==='tool'?toolPatch(api,config,target,enabled):presetSkillPatch(config,preset,target._skill,enabled);
      const before=await textFile(config.patchFile),applied=applyOwnedPatch(api,config,before,patch);
      change={type:'patch',file:config.patchFile,before,after:applied.after};
      if(target.kind==='tool'&&toolEnabledIn(applied.entries,target)!==enabled)throw new Error('更高优先级配置覆盖了此开关，请在原配置中修改');
      if(target.kind==='skill'){
        const declaration=allEntries(applied.entries).find(r=>r.config?.id===preset&&r.name==='@deepseek-ai/dsh-agent-preset');
        if(disabledSkillNames(declaration?.config?.plugins).has(target.name)===enabled)throw new Error('更高优先级配置覆盖了此 Skill 策略');
      }
    }
    for(const [key,plan]of this.plans)if(plan.expires<this.clock())this.plans.delete(key);
    if(this.plans.size>=50)this.plans.delete(this.plans.keys().next().value);
    const token=randomUUID(),expires=this.clock()+300000;
    const plan={token,expires,preset,id,enabled,target,change,fingerprint:config.fingerprint,realFile:await resolvedDestination(change.file),stateHash:hash(context.state)};
    this.plans.set(token,plan);
    return {token,expires,target:publicTarget(target),enabled,file:change.file,
      notice:target.kind==='skill'?'仅修改 '+target.scope+'。其他预设与 Skill 原文件保持不变。':cacheNotice,
      application:'使用 DSH 原生配置；保存后需核对运行状态，必要时重启 DSH 并新建相关会话。',
      cleanup:target.kind==='bundle'?'保留插件包与用户数据。停用不代表插件产生的文件、进程或其他副作用已清理。':null};
  }
  commit(token){
    const task=this.queue.catch(()=>{}).then(()=>this.applyPlan(token)).then(async receipt=>{
      if(receipt.configurationVerified&&this.reconcile){
        try{
          const result=await this.reconcile(receipt);receipt.runtime=result.application;receipt.runtimeResult=result;
          receipt.message=result.application==='applied'?'配置已应用':result.application==='restart-required'?'配置已保存，重启 DSH 后生效':'配置已保存，运行应用未完成';
          const api=await this.api,state=await this.state(),index=state.operations.findIndex(row=>row.id===receipt.id);
          if(index>=0)state.operations[index]={...state.operations[index],runtime:receipt.runtime,runtimeResult:result};
          await api.atomic.writeFileAtomic(join(this.storage,'state.json'),JSON.stringify(state),{mode:0o600});
        }catch{receipt.runtime='not-observed';receipt.recordWarning='配置已保存，运行状态核对未完成，请刷新或重启 DSH。';}
      }
      return receipt;
    });this.queue=task;return task;
  }
  async applyPlan(token){
    const plan=this.plans.get(token);this.plans.delete(token);
    if(!plan||plan.expires<this.clock())throw new Error('操作确认已失效，请重新打开');
    const api=await this.api;
    return api.atomic.withFileLock(join(this.profileRoot,'package.json'),async()=>{
      const context=await this.inventory(plan.preset),target=context.targets.find(t=>t.id===plan.id);
      if(!target||target.reason||context.config.fingerprint!==plan.fingerprint||hash(context.state)!==plan.stateHash)throw new Error('配置已变化，请刷新并重新确认');
      const change=plan.change;
      if(await textFile(change.file)!==change.before||await resolvedDestination(change.file)!==plan.realFile)throw new Error('文件已变化，请刷新并重新确认');
      // Pin the Skill source too; a pending copy must never resurrect stale content.
      if(target.kind==='skill'&&target._sourceText!==plan.target._sourceText)throw new Error('Skill 正文已变化，请重新确认');
      await mkdir(this.storage,{recursive:true});
      const operationId=randomUUID(),backup=join(this.storage,operationId+'.json');
      const receipt={id:operationId,time:this.clock(),kind:target.kind,name:target.name,source:target.source,preset:plan.preset,enabled:plan.enabled,
        status:'prepared',file:change.file,runtime:'not-observed',cleanup:'unknown'};
      await api.atomic.writeFileAtomic(backup,JSON.stringify({receipt,change,target:publicTarget(target)},null,2),{mode:0o600});
      if(change.type==='bundle'){
        const manifest=context.config.manifest;manifest.dsh={...manifest.dsh,profile:{...manifest.dsh?.profile,bundles:change.bundles}};
        await api.operations.saveManifest(this.profileRoot,manifest);
      }else{await mkdir(dirname(change.file),{recursive:true});await api.atomic.writeFileAtomic(change.file,change.after,{mode:0o600});}
      const actual=await textFile(change.file);
      let verified=change.type==='bundle'?JSON.stringify(JSON.parse(actual).dsh.profile.bundles)===JSON.stringify(change.bundles):actual===change.after;
      if(target.kind==='tool')verified&&=toolEnabledIn((await readComposition(api,this)).entries,target)===plan.enabled;
      if(target.kind==='skill'){
        const current=allEntries((await readComposition(api,this)).entries).find(r=>r.name==='@deepseek-ai/dsh-agent-preset'&&r.config?.id===plan.preset);
        verified&&=Boolean(current)&&disabledSkillNames(current.config.plugins).has(target.name)!==plan.enabled;
      }
      receipt.status=verified?'configuration-saved':'verification-failed';Object.assign(receipt,configurationReceipt(verified));
      const state=context.state;
      state.operations.push(receipt);state.operations=state.operations.slice(-80);
      try { await api.atomic.writeFileAtomic(join(this.storage,'state.json'),JSON.stringify(state),{mode:0o600}); }
      catch { receipt.recordWarning='配置已写入，但操作记录保存失败；备份仍在本地，请先刷新配置。'; }
      try{await api.atomic.writeFileAtomic(backup,JSON.stringify({receipt,change,target:publicTarget(target)},null,2),{mode:0o600});}
      catch{receipt.recordWarning='配置已写入，但最终收据保存失败；保存前的备份仍在本地，请先刷新配置。';}
      return {...receipt,message:verified?'配置已保存，运行状态待核对':'配置写入后核对未通过，请查看原配置',backup};
    },{waitMs:3000});
  }
}
