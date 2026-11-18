import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const load=path=>{const c=vm.createContext({});vm.runInContext(fs.readFileSync(new URL(path,root),'utf8'),c);return c.StageEngine;};
const E=load('original-site/stage-engine.js');
const session=JSON.parse(fs.readFileSync(new URL('data/stage-sessions/import-poisson-20261106-demo/session.json',root)));
const plan=session.points.map(p=>({id:p.id,title:p.text,claims:p.claims,priority:3}));
const units=session.segments.map(s=>({text:s.text,time_span:s.time_span,reliability:{text:1}}));
const norm=x=>JSON.parse(JSON.stringify(x));
const assess=(t,source=units,cache=null)=>E.assess(plan,source.filter(u=>u.time_span[1]<=t),[],t,cache);
const ended=assess(session.durationSeconds);
assert.equal(E.coverageSummary(ended).coverage,1);
assert.deepEqual(norm(ended.map(b=>b.completedAt)),[14.1,20.04,39.66,50.02,60.1]);
assert.equal(E.coverageSummary(assess(60.09)).coverage<1,true,'No future subtitle can complete the final point');
assert.equal(E.coverageSummary(assess(0)).coverage,0);
const cache=new E.AssessmentCache();
for(const t of [0,14,14.1,20.04,31.12,37.46,39.66,46.44,47.98,50.02,60.09,60.1,67.84,20,0,67.84]){
  assert.deepEqual(norm(assess(t,units,cache)),norm(assess(t)));
  assert.ok(assess(t).flatMap(b=>b.claims).every(c=>!c.matched||c.end<=t));
}
const omitted=units.filter(u=>u.time_span[0]<50.02 || u.time_span[0]>=60.1);
assert.equal(E.complete(assess(session.durationSeconds,omitted)[4]),false,'Ending the video does not fill missing content');
assert.ok(E.coverageSummary(assess(session.durationSeconds,omitted)).coverage<1);
function matches(claim,text){return E.assess([{id:'x',title:claim,claims:[claim],priority:3}],[{text,time_span:[0,5],reliability:{text:1}}],[],5)[0];}
const negativeCases=[
  ['人生像一场泊松过程','人生不像一场泊松过程。'],
  ['机遇到来，果断出击，抓住机会','契机没有出现，我们果断出击，抓住这个机会。'],
  ['机遇到来，果断出击，抓住机会','我们要果断出击。'],
  ['成本降低10%，收入增加','成本降低20%，收入增加。'],
  ['降低成本，增加收入','降低成本，没有增加收入。'],
  ['张三帮助李四','李四帮助张三。'],
  ['大多数时间处在等待中','这次公交车等了很久，下一站就到。'],
  ['人生像一场泊松过程','先讲泊松过程，再说人生不是这个意思。']
];
for(const [claim,text]of negativeCases)assert.equal(E.complete(matches(claim,text)),false,`${claim} / ${text}`);
assert.equal(E.complete(matches('多数时候需要等待','多数时间，我们确实需要耐心等待。')),true);
assert.equal(E.complete(matches('机遇到来，抓住机会','当契机突然降临，我们要牢牢抓住这个机会。')),true);
assert.equal(E.complete(matches('成本降低10%，收入增加','成本降低10%，收入增加。')),true);
const manual=E.assess(plan,units,[{beatId:plan[0].id,at:61,value:false}],67.84);
assert.equal(manual[0].status,'pending');
assert.ok(E.coverageSummary(manual).coverage<1);
assert.deepEqual(norm(E.coverageSummary([{status:'matched',priority:3},{status:'partial',priority:2},{status:'pending',priority:1}])),{coverage:4/6,total:3,done:1,partial:1,conflicts:0,pending:1});
const beforePath='artifacts/slow-coverage-v21/before/original-site/stage-engine.js';
if(fs.existsSync(new URL(beforePath,root))){
  const old=load(beforePath),prior=old.assess(plan,units,[],session.durationSeconds);
  const report={case:session.id,method:E.ASSESSMENT_METHOD,source:'existing time subtitles, unchanged',
    before:{coverage:100*prior.reduce((n,b)=>n+(old.complete(b)?1:b.status==='partial'?.5:0),0)/prior.length,points:prior.map(b=>({title:b.title,status:b.status,claims:b.claims}))},
    after:{coverage:100*E.coverageSummary(ended).coverage,points:ended.map(b=>({title:b.title,status:b.status,completedAt:b.completedAt,claims:b.claims}))},
    checkpoints:[0,14.1,20.04,39.66,50.02,60.09,60.1,67.84].map(t=>({t,...E.coverageSummary(assess(t))})),
    negativeCases:negativeCases.map(([claim,text])=>({claim,text,completed:E.complete(matches(claim,text))})),
    omittedFinalPointCoverage:100*E.coverageSummary(assess(session.durationSeconds,omitted)).coverage};
  fs.writeFileSync(new URL('artifacts/slow-coverage-v21/alignment-report.json',root),JSON.stringify(report,null,2));
}
console.log('PASS: five timed points, rewind/cache equality, missing content, negation/numbers/role order, manual override and weighted coverage.');
