// Demo-only addition inside the existing trace renderer's extension seam.
// Existing context decrease bars and navigation stay in their original implementation.
const contextDemoSummaries = data.compactionSummaries || [];
function contextDemoSummaryHtml(rows) {
  return rows.map(row => '<details class="ov-proof" open><summary>压缩摘要 · 第 '+row.turn+' 轮 · seq '+row.seq+'</summary>'+
    '<p class="review-quiet">模型生成的原文 · '+esc(row.model||'模型未记录')+' · 约 '+reviewTokens(row.summaryTokens)+' tokens</p>'+
    '<div style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;padding:10px 0">'+esc(row.summary||'没有摘要正文')+'</div></details>').join('');
}
const contextDemoOpenContext = reviewOpenContext;
reviewOpenContext = function(turn, step) {
  contextDemoOpenContext(turn, step);
  const rows=contextDemoSummaries.filter(row=>row.turn===turn);
  if(rows.length) $('drawer-body').insertAdjacentHTML('beforeend', contextDemoSummaryHtml(rows));
};
const contextDemoOpenCompaction = reviewOpenCompaction;
reviewOpenCompaction = function(seqs) {
  contextDemoOpenCompaction(seqs);
  const rows=contextDemoSummaries.filter(row=>seqs.includes(row.startSeq));
  if(rows.length) $('drawer-body').insertAdjacentHTML('beforeend', contextDemoSummaryHtml(rows));
};
setTimeout(()=>{
  const wanted=Number(new URL(location.href).searchParams.get('compaction'));
  const row=contextDemoSummaries.find(row=>row.seq===wanted);
  if(row)reviewOpenContext(row.turn);
},100);
