import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('original-site/stage-engine.js',root),'utf8'),context);
const E=context.StageEngine,normalize=x=>JSON.parse(JSON.stringify(x));
let checks=0;
for(const name of ['speech_004_whales','speech_002_pressure_white_hair']){
  const data=JSON.parse(fs.readFileSync(new URL(`original-site/data/cases/${name}.json`,root)));
  const plan=E.defaultPlan(data),cache=new E.AssessmentCache(),manual=[];
  for(const t of [0,5,30,30.5,300,789.216,789.5,790,791,900,10,30,790]){
    const plain=E.evaluate(data,t,plan,1000,[],'',manual,null,'active');
    const cached=E.evaluate(data,t,plan,1000,[],'',manual,null,'active',cache);
    assert.deepEqual(normalize(cached),normalize(plain));checks++;
    assert.ok(cached.units.every(u=>u.time_span[1]<=t));
  }
  manual.push({beatId:plan[0].id,at:790,value:true});
  for(const mutate of [()=>{},()=>{plan[0].priority=1;plan[0].deadline=12;},()=>{plan[0].claims.push('没有必然联系');},
    ()=>{data.expression_map.units[2].text='不支持这个判断';},()=>{data.expression_map.units[2].reliability.text=0;}]){
    mutate();for(const t of [791,789]){
      assert.deepEqual(normalize(E.evaluate(data,t,plan,1000,[],'',manual,null,'active',cache)),normalize(E.evaluate(data,t,plan,1000,[],'',manual,null,'active')));checks++;
    }
  }
}
// ASR may edit or append segments; a negation split at the boundary must survive.
const plan=[{id:'a',title:'支持',claims:['支持这个结论'],priority:3}],units=[],cache=new E.AssessmentCache();
for(const text of ['不','支持这个结论','下面开始新的论点','支持这个结论']){
  const i=units.length;units.push({text,time_span:[i,i+1],reliability:{text:1}});
  assert.deepEqual(normalize(E.assess(plan,units,[],i+1,cache)),normalize(E.assess(plan,units,[],i+1)));checks++;
}
console.log(`Passed: ${checks} cached/uncached equal checks, rewind, outline/manual/ASR/reliability invalidation, negation boundaries.`);
