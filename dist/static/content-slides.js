// Route received speech to slide topics. Slide timestamps are never consulted.
const clean=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const canonical=s=>clean(s).replace(/时刻|时候/g,'时间').replace(/大多时间/g,'大多数时间').replace(/机遇|契机/g,'机会')
  .replace(/到来|降临|来临/g,'出现').replace(/等候/g,'等待').replace(/当中|之中/g,'中')
  .replace(/积蓄力量/g,'蓄力').replace(/抵达/g,'到达').replace(/的|是/g,'');
const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
export function slideCues(page){
  const explicit=Array.isArray(page.cues)?page.cues:[];
  const lines=String(page.text||'').split(/[\n；;。！？!?]/);
  const phrases=[...explicit,...lines,...lines.flatMap(s=>s.split(/[，,、：:]/)),page.title||''];
  return [...new Set(phrases.map(x=>String(x).trim()).filter(x=>!/^第?\d+页?$/.test(x)&&canonical(x).length>=4&&canonical(x).length<=90))];
}
function phraseScore(cue,text){
  const target=canonical(cue),source=canonical(text);
  if(!target||!source)return 0;
  if(source.includes(target))return 1;
  // Permit bounded inserted speech, keeping all topic characters in order.
  for(let start=source.indexOf(target[0]);start>=0;start=source.indexOf(target[0],start+1)){
    let at=start,pairs=0,ok=true;
    for(let i=1;i<target.length;i++){
      const next=source.indexOf(target[i],at+1);
      if(next<0||next-at>12){ok=false;break;}
      if(next===at+1)pairs++;
      at=next;
    }
    if(ok&&at-start<=target.length*3+12&&pairs/(target.length-1)>=.5)return .93;
  }
  const tokens=grams(target),heard=grams(source),overlap=tokens.size?[...tokens].filter(g=>heard.has(g)).length/tokens.size:0;
  return Math.min(.86,overlap*.9);
}
export function rankSlides(pages,text){
  const all=pages.map(slideCues),counts=new Map();
  for(const cues of all)for(const key of new Set(cues.map(canonical)))counts.set(key,(counts.get(key)||0)+1);
  return pages.map((p,index)=>{
    const matches=all[index].filter(cue=>counts.get(canonical(cue))===1).map(cue=>({cue,score:phraseScore(cue,text)})).sort((a,b)=>b.score-a.score);
    return {index,score:matches[0]?.score||0,cue:matches[0]?.cue||'',strong:matches.filter(m=>m.score>=.9).length};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
}
export class ContentSlideFollower{
  constructor(){this.reset();}
  reset(){this.key=null;this.signatures=[];this.index=0;this.evidence=null;this.pending=null;this.processed=0;this.interimKey=null;}
  consume(pages,unit,recent=[],interim=false){
    const end=unit.time_span[1],parts=String(unit.text).split(/[\n。！？!?；;，,]/).map(s=>s.trim()).filter(Boolean),prior=recent.map(u=>u.text);
    for(const text of parts){
      if(/稍后|待会儿|等会儿|下一页再|后面再|之后再讲/.test(text)){this.pending=null;continue;}
      let ranked=rankSlides(pages,text),best=ranked[0],runner=ranked[1];
      if((best?.score||0)>=.35&&(best?.score||0)<.72){
        const combined=rankSlides(pages,[...prior.slice(-2),text].join(' '));
        if(combined[0]?.score>(best?.score||0)){best=combined[0];runner=combined[1];}
      }
      prior.push(text);
      if(!best||best.score<(interim?.9:.72)||best.score-(runner?.score||0)<.1){this.pending=null;continue;}
      if(best.index<this.index&&!/回到|回顾|再看|再说|重温/.test(text)){this.pending=null;continue;}
      if(best.index===this.index){this.evidence={text,cue:best.cue,at:end,source:unit.source||'transcript'};this.pending=null;continue;}
      const jump=best.index>this.index+1,immediate=best.score>=.9&&(!jump||best.strong>=2||canonical(best.cue).length>=6);
      const repeated=!interim&&this.pending?.index===best.index&&(end-this.pending.at)<=15;
      if(immediate||repeated){this.index=best.index;this.evidence={text,cue:best.cue,at:end,source:unit.source||'transcript'};this.pending=null;}
      else if(!interim)this.pending={index:best.index,at:end};
    }
  }
  update(pages,units,{at=Infinity,sessionId='replay',interim=null}={}){
    const key=JSON.stringify([sessionId,pages.map(p=>[p.url,p.title,p.text,p.cues])]);
    const observed=(units||[]).filter(u=>Number.isFinite(u.time_span?.[1])&&u.time_span[1]<=at&&Number(u.reliability?.text??0)>=.6&&String(u.text||'').trim());
    const signatures=observed.map(u=>JSON.stringify([u.text,u.time_span,u.source,u.reliability?.text]));
    const prefix=key===this.key&&signatures.length>=this.signatures.length&&this.signatures.every((s,i)=>s===signatures[i]);
    const start=prefix?this.signatures.length:0;
    if(!prefix){this.reset();this.key=key;}
    for(let i=start;i<observed.length;i++){
      const unit=observed[i];this.processed++;
      this.consume(pages,unit,observed.slice(Math.max(0,i-2),i).filter(u=>unit.time_span[1]-u.time_span[1]<=8));
    }
    this.signatures=signatures;
    const stable=interim?.text&&interim.stable===true&&Number.isFinite(interim.at)&&interim.at<=at&&at-interim.at<=3?interim:null;
    if(stable){const key=JSON.stringify([sessionId,observed.length,stable.text]);if(key!==this.interimKey){this.interimKey=key;this.consume(pages,{text:stable.text,time_span:[Math.max(0,stable.at-.01),stable.at],source:'browser-asr-stable'},[],true);}}
    return {index:pages.length?Math.min(this.index,pages.length-1):-1,evidence:this.evidence,
      heard:stable?.text||observed.at(-1)?.text||'',pending:this.pending?.index??null,received:observed.length+(stable?1:0),interim:!!stable,
      ready:pages.some(p=>slideCues(p).length>0)};
  }
}
