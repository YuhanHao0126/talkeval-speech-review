// Read text from the user's PPTX in this browser; no external service is used.
import {unzipSync} from './vendor/libs/fflate.module.js';
export async function readPptxText(file){
  if(file.size>50*1024*1024)throw Error('PPT超过50MB，请在页面设置里补充各页要点。');
  let total=0;
  const entries=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{
    const wanted=/^ppt\/slides\/slide\d+\.xml$/.test(entry.name)||['ppt/presentation.xml','ppt/_rels/presentation.xml.rels'].includes(entry.name);
    if(!wanted)return false;
    total+=entry.originalSize;
    if(entry.originalSize>1024*1024||total>10*1024*1024)throw Error('PPT文字数据过大，请手动填写各页要点。');
    return true;
  }});
  const parser=new DOMParser(),decoder=new TextDecoder();
  const parse=name=>{if(!entries[name])return null;const doc=parser.parseFromString(decoder.decode(entries[name]),'application/xml');if(doc.querySelector('parsererror'))throw Error('PPT文字解析失败');return doc;};
  const relation=parse('ppt/_rels/presentation.xml.rels'),presentation=parse('ppt/presentation.xml');
  const targets=new Map([...(relation?.getElementsByTagName('Relationship')||[])].map(r=>[r.getAttribute('Id'),'ppt/'+r.getAttribute('Target').replace(/^\/?ppt\//,'').replace(/^\.\//,'')]));
  let names=[...(presentation?.getElementsByTagNameNS('*','sldId')||[])].map(r=>targets.get(r.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))).filter(Boolean);
  if(!names.length)names=Object.keys(entries).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));
  if(names.length>80)throw Error('最多支持80页PPT');
  return names.map(name=>{
    const doc=parse(name),lines=[...(doc?.getElementsByTagNameNS('*','p')||[])].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('').trim()).filter(Boolean);
    return {title:(lines[0]||'').slice(0,100),text:lines.join('\n').slice(0,6000)};
  });
}
