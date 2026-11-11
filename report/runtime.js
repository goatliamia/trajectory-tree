(() => {
  for (const element of document.querySelectorAll('[data-report-ui]')) element.textContent=ui(element.dataset.reportUi);
  for (const element of document.querySelectorAll('.diagnostic-nav')) element.setAttribute('aria-label',ui('报告章节'));
  const value=JSON.parse(document.getElementById('report-bindings').textContent),datasets=value.datasets;
  const specs=new Map(value.figures.map(spec=>[spec.id,structuredClone(spec)]));
  const savedRecords=new Map(Object.values(datasets).filter(data=>data.kind==='records').flatMap(data=>data.rows.filter(row=>row.evidence?.length===1).map(row=>
    [JSON.stringify([data.source.session,data.source.log,row.evidence?.[0]?.seq]),row])));
  const bind=figure=>{
    const spec=specs.get(figure.dataset.figure),data=datasets[spec.data],readout=figure.querySelector('.figure-readout'),byId=new Map(data.rows.map(row=>[row.id,row]));
    const select=mark=>{
      for(const el of figure.querySelectorAll('.is-active,.is-related'))el.classList.remove('is-active','is-related');mark.classList.add('is-active');
      if(mark.dataset.flowNode)for(const edge of figure.querySelectorAll('[data-flow-from]')){
        if(edge.dataset.flowFrom===mark.dataset.flowNode||edge.dataset.flowTo===mark.dataset.flowNode)edge.classList.add('is-related');
      }
      if(mark.dataset.flowFrom)for(const node of figure.querySelectorAll('[data-flow-node]')){
        if(node.dataset.flowNode===mark.dataset.flowFrom||node.dataset.flowNode===mark.dataset.flowTo)node.classList.add('is-related');
      }
      const row=byId.get(mark.dataset.row);
      readout.textContent=mark.dataset.readout||(row&&(row.text||describe(data,row)))||'';
      if(row){
        const relatedIds=mark.dataset.relatedRows?JSON.parse(mark.dataset.relatedRows):mark.dataset.relatedRow?[mark.dataset.relatedRow]:[];
        const rowIds=mark.dataset.relatedRows?[mark.dataset.row,...relatedIds]:[...relatedIds,mark.dataset.row];
        const rows=[...new Set(rowIds)].map(id=>byId.get(id)).filter(Boolean),panel=figure.querySelector('.report-record');
        const refs=[...new Map(rows.flatMap(item=>item.evidence||[]).map(ref=>[ref.seq,ref])).values()];
        const reads=refs.map(ref=>ref.read||{tool:'trajectory_read',args:{session:ref.session,snapshot:data.source.snapshot,seq:ref.seq,
          ...(data.source.host==='dsh'?{format:'linked'}:{linked:true,logId:data.source.log,cut:data.source.cut})}});
        panel.hidden=false;
        const links=panel.querySelector('.report-evidence-links');links.replaceChildren();
        refs.forEach((ref,index)=>{
          const button=document.createElement('button');button.type='button';button.textContent='#'+ref.seq;
          button.title=ui('复制这条记录的取证查询');
          button.onclick=async()=>{
            const serialized=JSON.stringify(reads[index]);
            try{await navigator.clipboard.writeText(serialized);panel.querySelector('[role=status]').textContent=ui('已复制取证查询。');}
            catch{panel.querySelector('[role=status]').textContent=serialized;}
          };
          links.append(button);
        });
        const excerpts=refs.map(ref=>savedRecords.get(JSON.stringify([ref.session,ref.log,ref.seq]))).filter(Boolean);
        const preview=panel.querySelector('.report-evidence-text');
        preview.hidden=!excerpts.length;preview.textContent=excerpts.map(record=>record.text).join('\n\n');
        panel.querySelector('.report-evidence-raw').textContent=JSON.stringify({source:data.source,values:rows.length>1?rows:row,evidence:reads},null,2);
        panel.querySelector('[role=status]').textContent='';
      }
    };
    const find=event=>{const mark=event.target.closest('[data-row],[data-readout]');return mark&&figure.contains(mark)?mark:null;};
    const preview=mark=>{const row=byId.get(mark.dataset.row);return mark.dataset.readout||(row&&(row.text||describe(data,row)))||'';};
    figure.onpointerover=event=>{const mark=find(event);if(mark)readout.textContent=preview(mark);};
    figure.onfocusin=event=>{const mark=find(event);if(mark)readout.textContent=preview(mark);};
    figure.onclick=event=>{const mark=find(event);if(mark)select(mark);};
    figure.onkeydown=event=>{if(!['Enter',' '].includes(event.key)||event.target.tagName==='BUTTON')return;const mark=find(event);if(mark){event.preventDefault();select(mark);}};
    const panel=document.createElement('details');panel.className='report-record';panel.hidden=true;
    panel.innerHTML=ui('<summary>所选记录 · 数据与来源</summary><div class="report-evidence-links"></div><pre class="report-evidence-text" hidden></pre><span role="status"></span><details><summary>取证参数与完整读数</summary><pre class="report-evidence-raw"></pre></details>');figure.append(panel);
    if(spec.type==='assembly')mountAssembly(figure.querySelector('[data-context-assembly]'),data,spec,{onSelect(selection){
      readout.textContent=assemblyFrameLabel(selection.frame)+ui(' · 选中 ')+selection.blocks.length+ui(' 个片段');panel.hidden=false;
      panel.querySelector('.report-evidence-raw').textContent=JSON.stringify({source:data.source,position:selection.frame.id,blocks:selection.blocks,evidence:selection.evidence.map(ref=>ref.read||{tool:'trajectory_read',args:{session:ref.session,snapshot:data.source.snapshot,seq:ref.seq,format:'linked'}})},null,2);
    }});
    const rerender=()=>{const template=document.createElement('template');template.innerHTML=renderFigure(spec,datasets);const replacement=template.content.firstElementChild;figure.replaceWith(replacement);bind(replacement);};
    for(const button of figure.querySelectorAll('[data-report-source]'))button.onclick=()=>{const keys=new Set(spec.series||CONTEXT_SERIES.map(row=>row[0]).filter(k=>data.columns[k]));const key=button.dataset.reportSource;keys.has(key)?keys.delete(key):keys.add(key);spec.series=[...keys];rerender();};
    for(const button of figure.querySelectorAll('[data-report-layer]'))button.onclick=()=>{const keys=new Set(spec.layers||['total']);const key=button.dataset.reportLayer;keys.has(key)?keys.delete(key):keys.add(key);spec.layers=[...keys];rerender();};
    for(const button of figure.querySelectorAll('[data-report-mode]'))button.onclick=()=>{spec.mode=button.dataset.reportMode;rerender();};
  };
  document.querySelectorAll('[data-figure]').forEach(figure => {
    const spec = specs.get(figure.dataset.figure), template = document.createElement('template');
    template.innerHTML = renderFigure(spec, datasets);
    const replacement = template.content.firstElementChild; figure.replaceWith(replacement); bind(replacement);
  });
})();
