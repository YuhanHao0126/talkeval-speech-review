// Geometry-only training cues. No assertion about persuasion, personality or intent.
const norm = p => Math.hypot(...p);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a,b) => a.map((v,i)=>v+b[i]);
const mul = (a,k) => a.map(v=>v*k);
const unit = a => mul(a,1/Math.max(norm(a),1e-8));
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

// A practice target is generated from the selected goal, never called a prediction.
// Preserve each observed arm length; solve its elbow on the reachable sphere.
export function practiceTrajectory(current, visibility, goal, frames, hand = 'both') {
  const target=current.map(p=>p.slice());const steps=[];let available=0;
  for(const [s,e,w,side,name] of [[1,3,5,1,'左手'],[2,4,6,-1,'右手']]) {
    if (hand !== 'both' && hand !== (side === 1 ? 'left' : 'right')) continue;
    if(![s,e,w].every(j=>visibility[j]>=.4)) {steps.push(`${name}入镜后再给出目标`);continue;}
    available++;
    const upper=norm(sub(current[e],current[s])),lower=norm(sub(current[w],current[e]));
    const offset=goal==='open' ? [side*.32,.08,.08] : goal==='emphasis' ? [side*.05,.22,.12] : [0,0,0];
    const desired=add(current[w],offset), ray=sub(desired,current[s]);
    const reach=clamp(norm(ray),Math.abs(upper-lower)+.03,Math.max(.04,upper+lower-.03));
    const direction=unit(ray),along=(upper**2-lower**2+reach**2)/(2*reach);
    let bend=sub(sub(current[e],current[s]),mul(direction,sub(current[e],current[s]).reduce((sum,x,i)=>sum+x*direction[i],0)));
    if(norm(bend)<.01){bend=[side*.5,-1,.3];bend=sub(bend,mul(direction,bend.reduce((sum,x,i)=>sum+x*direction[i],0)));}
    target[w]=add(current[s],mul(direction,reach));
    target[e]=add(add(current[s],mul(direction,along)),mul(unit(bend),Math.sqrt(Math.max(0,upper**2-along**2))));
    if(goal==='steady'){target[e]=current[e].slice();target[w]=current[w].slice();}
    const amount=norm(sub(target[w],current[w]));
    steps.push(goal==='steady'?`${name}保持舒适位置，先说完这句话`:`${name}${goal==='open'?'轻轻向外打开':'小幅向上抬'}，约${amount.toFixed(2)}个肩宽`);
  }
  // Interpolate directions, then restore segment lengths for each frame.
  const positions=Array.from({length:frames},(_,i)=>{
    const t=(i+1)/frames,u=t*t*(3-2*t);
    const p=current.map((point,j)=>add(point,mul(sub(target[j],point),u)));
    for(const [s,e,w] of [[1,3,5],[2,4,6]]) {
      if (hand !== 'both' && hand !== (s === 1 ? 'left' : 'right')) continue;
      if(![s,e,w].every(j=>visibility[j]>=.4))continue;
      p[e]=add(p[s],mul(unit(sub(p[e],p[s])),norm(sub(current[e],current[s]))));
      p[w]=add(p[e],mul(unit(sub(p[w],p[e])),norm(sub(current[w],current[e]))));
    }
    return p;
  });
  return {positions,steps,available,goal,hand,kind:'rule_generated_practice',note:'按当前姿态和自选目标生成的练习路径；不是模型预测，也不保证表达效果更好。'};
}

function elbowAngle(p,s,e,w) {
  const a=unit(sub(p[s],p[e])),b=unit(sub(p[w],p[e]));
  return Math.acos(clamp(a.reduce((sum,x,i)=>sum+x*b[i],0),-1,1))*180/Math.PI;
}
export function motionGuidance(current, future, visibility, goal = 'steady', horizonSeconds = .5) {
  const arms = [1, 2, 3, 4, 5, 6];
  const visible = arms.filter(j => (visibility[j] || 0) >= .4).length;
  const hands = [[5, '左手', 1], [6, '右手', -1]].map(([joint, name, side]) => {
    const reliable = [joint, joint === 5 ? 1 : 2, joint === 5 ? 3 : 4].every(j => visibility[j] >= .4);
    if (!reliable) return { joint, name, reliable, text: `${name}观测不足，暂不作方向建议` };
    const delta = sub(future.at(-1)[joint], current[joint]);
    const displacement = norm(delta);
    const path = [current[joint], ...future.map(p => p[joint])];
    const travel = path.slice(1).reduce((sum, p, i) => sum + norm(sub(p, path[i])), 0);
    const axis = delta.map(Math.abs).indexOf(Math.max(...delta.map(Math.abs)));
    const direction = axis === 1 ? (delta[1] > 0 ? '上抬' : '下落') : axis === 0 ? (delta[0] * side > 0 ? '向外展开' : '向内收回') : (delta[2] > 0 ? '向前移动' : '向后收回');
    const elbow=joint===5?3:4, shoulder=joint===5?1:2;
    const angleChange=elbowAngle(future.at(-1),shoulder,elbow,joint)-elbowAngle(current,shoulder,elbow,joint);
    return { joint, name, reliable, displacement, travel, direction, angleChange, text: displacement < .04 ? `${name}基本保持当前位置` : `${name}预计${direction} ${displacement.toFixed(2)} 个肩宽` };
  });
  const reliable = hands.filter(h => h.reliable);
  const maxTravel = Math.max(0, ...reliable.map(h => h.travel));
  const maxMove = Math.max(0, ...reliable.map(h => h.displacement));
  let evaluation, suggestion, level = 'normal';
  if (!reliable.length) {
    evaluation = '手臂观测不足'; suggestion = '调整取景，让双肩、双肘和双手入镜后再判断。'; level = 'unknown';
  } else if (maxTravel / horizonSeconds > 1.6) {
    evaluation = '预计手部移动较快'; suggestion = '如果此处不是强调重点，可放慢手势，让手停在舒适的位置。'; level = 'attention';
  } else if (reliable.some(h => h.travel > .3*horizonSeconds && h.travel > 2.5 * Math.max(h.displacement, .02))) {
    evaluation = '预测轨迹有往返变化'; suggestion = '可以先完成一个方向的手势再收回；也可能是姿态估计抖动，请结合原视频。'; level = 'attention';
  } else if (goal === 'open' && reliable.length === 2 && norm(sub(future.at(-1)[5], future.at(-1)[6])) < .55) {
    evaluation = '双手预计仍靠近'; suggestion = '若这里想做展开式说明，可以尝试轻轻向两侧打开双手。';
  } else if (goal === 'emphasis' && maxMove < .04) {
    evaluation = `未来${horizonSeconds}秒动作变化较小`; suggestion = '若这里是重点，可配合一次小幅手势；也可以用停顿强调，不必为了评分而动。';
  } else {
    evaluation = maxMove < .04 ? `未来${horizonSeconds}秒大致保持` : `未来${horizonSeconds}秒有姿态变化`;
    suggestion = '当前几何指标未触发调整提示。继续讲清这句话，按自己的节奏完成手势。';
  }
  return { visible, total: arms.length, hands, evaluation, suggestion, level, maxTravel, maxMove, goal,
    note: '规则提示参考手部轨迹和所选练习目标；不等于演讲质量评分。阈值为演示设定，效果待试用验证。' };
}
