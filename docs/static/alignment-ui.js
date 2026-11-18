const el = id => document.getElementById(id);
export async function updateAlignment() {
  const button = el('align-button'); button.disabled = true;
  try {
    const outline = el('outline-input').value.split('\n').filter(s => s.trim()).map((line,index) => {
      const [text, weight, terms] = line.split('|').map(s => s.trim());
      if (!terms) throw new Error('每行需包含观点、权重和必要表达，以 | 分开。');
      return {id:String(index+1),text,weight:Number(weight),claims:terms.split(/[;；]/).map(g=>g.split('/').map(s=>s.trim()).filter(Boolean))};
    });
    const response = await fetch('/api/alignment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outline,transcript:el('transcript-input').value})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    el('coverage-value').textContent = `${(data.weighted_coverage*100).toFixed(1)}%`;
    el('coverage-bar').value = data.weighted_coverage;
    el('alignment-results').replaceChildren();
    for (const item of data.results) {
      const row=document.createElement('div');row.className='alignment-row';
      const title=document.createElement('strong');title.textContent=item.text;
      const weight=document.createElement('span');weight.textContent=`权重 ${item.weight}`;
      const status=document.createElement('span');status.textContent=item.status;status.className=item.completion===1?'complete':'missing';
      const evidence=document.createElement('div');evidence.className='alignment-evidence';
      evidence.textContent=(item.evidence?`句${item.sentence_span.join('–')} · 表达证据：${item.evidence}`:'未找到必要表达的证据')+(item.missing_claims.length?`　待补：${item.missing_claims.map(g=>g.join('/')).join('；')}`:'')+(item.review_reasons.length?`　复核：${item.review_reasons.join('；')}`:'');
      row.append(title,weight,status,evidence);el('alignment-results').append(row);
    }
    el('alignment-note').textContent=data.note+' 完整记1、部分或需复核记0.5、未覆盖记0；乘以重要度后求加权比例。';
    el('alignment-status').textContent='已按当前输入重新计算';
  } catch(error) { el('alignment-status').textContent=error.message; }
  finally {button.disabled=false;}
}
el('align-button').addEventListener('click',updateAlignment);
el('append-example').addEventListener('click',()=>{
  const sentence='建议反馈给演讲者，帮助下一轮练习改进，形成闭环。';
  if (!el('transcript-input').value.includes(sentence)) el('transcript-input').value+='\n'+sentence;
  updateAlignment();
});
