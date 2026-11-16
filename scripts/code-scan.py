"""Bounded Code Relations goals; no project execution or full model export."""
import argparse,gc,hashlib,json,sys,time
from pathlib import Path

sys.dont_write_bytecode=True
parser=argparse.ArgumentParser()
for name in ('repo','engine','typescript','project','inventory','out'):parser.add_argument('--'+name,required=True)
parser.add_argument('--refresh',action='store_true')
args=parser.parse_args()
root=Path(args.repo).resolve();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(args.engine).resolve()))
from code_relations.typescript_compiler import module_responses,_scan_stream_model
from code_relations.calculus import QuerySession
from code_relations.extraction import implementation_digest

inventory=json.loads(Path(args.inventory).read_text(encoding='utf-8'))
files={row['path']:row for row in inventory}
settings=json.loads(Path(args.project).read_text(encoding='utf-8'))['compilerOptions']
compiler=Path(args.typescript).resolve();engine=implementation_digest()
started=time.perf_counter()
print('CR: resolving the complete static module inventory',file=sys.stderr,flush=True)
modules=module_responses(root,project=Path(args.project),compiler=compiler)
(out/'modules.json').write_text(json.dumps(modules,ensure_ascii=False),encoding='utf-8')
edges={file:set() for file in files}
for row in modules['requests']:
    if row['file'] in edges and row['resolved_file'] in files:edges[row['file']].add(row['resolved_file'])

def closure(file):
    seen=set();todo=[file]
    while todo:
        current=todo.pop()
        if current in seen:continue
        seen.add(current);todo.extend(edges[current]-seen)
    return seen

closures={file:closure(file) for file in files}
remaining=set(files);batches=[]
while remaining:
    # Every consumer keeps its complete selected static import/export closure.
    # Unrelated small contexts can share a selected source Program.
    seed=max(remaining,key=lambda f:(len(closures[f]&remaining),files[f]['bytes'],f))
    context=set(closures[seed])
    for file in sorted(remaining-context):
        extra=closures[file]-context
        if sum(files[f]['bytes'] for f in context|extra)<=220000:context.update(extra)
    owners=remaining&context;remaining-=owners
    batches.append((sorted(context),sorted(owners)))

goals=['ts_file_value_dependencies','ts_unread_bindings','ts_unread_imports','ts_unread_initializer_calls','ts_unread_rest_exclusions']
results=[]
for index,(context,owners) in enumerate(batches,1):
    key=hashlib.sha256(json.dumps({'files':[(f,files[f]['sha256']) for f in context],'owners':owners,'settings':settings,'engine':engine,'compiler':modules['compiler'],'goals':goals},sort_keys=True).encode()).hexdigest()
    saved=out/('batch-'+key+'.json')
    if saved.exists() and not args.refresh:
        results.append(json.loads(saved.read_text(encoding='utf-8')))
        print(f'CR: context {index}/{len(batches)} reused ({len(owners)} source files)',file=sys.stderr,flush=True)
        continue
    config=out/'batch-jsconfig.json'
    config.write_text(json.dumps({'compilerOptions':settings,'files':[str(root/f) for f in context]}),encoding='utf-8')
    print(f'CR: context {index}/{len(batches)}, {len(context)} files, {len(owners)} new consumers',file=sys.stderr,flush=True)
    # The goal-aware stream is the same implementation used by query_typescript;
    # collect several goals in one bounded observation instead of rescanning it.
    model=_scan_stream_model(root,project=config,compiler=compiler,closed_root=False,embedded=None,expressions=goals)
    session=QuerySession(model)
    dependencies=session.evaluate(goals[0]);unused=session.evaluate(goals[1]);imports=session.evaluate(goals[2])
    calls=session.evaluate(goals[3]);rest=session.evaluate(goals[4]);owner_set=set(owners)
    declaration=model.objects.get('Declaration',{});call_info=model.objects.get('TSCall',{})
    imported={left for left,_ in imports.pairs};rest_names={left for left,_ in rest.pairs}
    leads=[]
    for left,_ in sorted(unused.pairs):
        info=declaration[left]
        if info.get('file') not in owner_set:continue
        leads.append({**{k:info[k] for k in ('file','line','column','label','kind') if k in info},
            'import':left in imported,'rest_exclusion':left in rest_names,
            'generated':files[info['file']]['generated'],'module':files[info['file']]['module'],
            'initializer_calls':[{k:call_info[right][k] for k in ('label','line','file') if k in call_info[right]} for binding,right in calls.pairs if binding==left]})
    rows=[{'source':a,'target':b,'witnesses':len(dependencies.edges[a,b])} for a,b in sorted(dependencies.pairs) if a in owner_set and b in files]
    result={'owners':owners,'contextFiles':len(context),'dependencies':rows,'leads':leads,
            'issues':list(model.issues)}
    saved.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8');results.append(result)
    del model,session,dependencies,unused,imports,calls,rest,declaration,call_info
    gc.collect()

rows=[row for batch in results for row in batch['dependencies']]
leads=[{**row,'module':files[row['file']]['module'],'generated':files[row['file']]['generated']} for batch in results for row in batch['leads']]
external=[row for row in modules['requests'] if row['resolved_file'] not in files]
report={'schema':1,'engine':engine,'compiler':modules['compiler'],'files':len(files),'contexts':len(batches),
        'seconds':round(time.perf_counter()-started,2),'rows':rows,'leads':leads,'externalRequests':external,
        'coverage':{'status':'partial-interpretation','pairs':len(rows),'pending':len(external)},
        'scope':'Selected source Programs; each consumer retains its complete selected static import/export closure. Dynamic host dispatch and runtime assembly globals are not supplied. Unread bindings are investigation leads, not deletion proofs.'}
changed=[f for f in files if hashlib.sha256((root/f).read_bytes()).hexdigest()!=files[f]['sha256']]
if changed:raise RuntimeError('Source changed during scan; rerun with the current bytes: '+', '.join(changed))
(out/'scan.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'files':len(files),'contexts':len(batches),'pairs':len(rows),'leads':len(leads),'seconds':report['seconds']}),flush=True)
