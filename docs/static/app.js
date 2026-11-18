import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { loadSpeakerAvatars } from './avatar.js?v=8';
import { readAvatarPreferences, rememberAvatarPreference, resolveAvatarPreference } from './avatar-preference.js';
import { motionGuidance, practiceTrajectory } from './motion-guidance.js?v=8';
import { blendPose, sampleSequence, sampleVisibility, forecastPose, reviewFrame } from './presentation.js?v=8';
import { updateAlignment } from './alignment-ui.js';

const element = id => document.getElementById(id);
const video = element('video');
const observationCanvas=document.createElement('canvas');observationCanvas.className='observation-overlay';
observationCanvas.setAttribute('aria-label','当前身体观测点');video.parentElement.appendChild(observationCanvas);
const methodInput = element('method');
const timeline = element('timeline');

let dataset = null;
let rows = [];
let selectedRow = 0;
let previewPhase = 1;
let previewToken = 0;
let report = null;
let busy = false;
let avatars = null;
let displayMode = 'avatar';
let cameraView = 'portrait';
let avatarLoadToken = 0;
let loadedCharacter = null;
let savedAvatarPreferences = {};
let liveStream = null;
let liveToken = 0;
let liveSession = null;
let liveExportSnapshot = null;
let windowProfile = 'legacy';
let windowOptions = null;
let practice = null;
const purposeInput=element('stage-purpose');
const practiceMode=()=>purposeInput.value==='practice';
const reviewMode=()=>purposeInput.value==='review';
let playback=null, displayTransition=null, displayedPrediction=null, displayedFrame=null;
let observedTransition=null, displayedCurrent=null;
let hudStamp=0, renderStats={fps:0,drawCalls:0};
let pathKey='';
const historyInput=element('history-seconds');
const horizonInput=element('horizon-seconds');
const previewSpeed=element('preview-speed');
try { savedAvatarPreferences = readAvatarPreferences(window.localStorage); } catch {}

function configuration() {
  return {model_profile:windowProfile,history_seconds:Number(historyInput.value),horizon_seconds:Number(horizonInput.value)};
}
function sampleUrl() { return '/api/sample?'+new URLSearchParams(configuration()); }
function saveTiming() {
  try {localStorage.setItem('talkeval-window-v2',JSON.stringify({...configuration(),preview_speed:Number(previewSpeed.value)}));} catch {}
}
function timingLabels() {
  const h=dataset ? dataset.history_frames/dataset.fps : Number(historyInput.value);
  const f=dataset ? dataset.horizon_frames/dataset.fps : Number(horizonInput.value);
  element('range-eyebrow').textContent=`MOTION FORECAST / ${h.toFixed(1)}s → ${f.toFixed(1)}s`;
  element('window-summary').textContent=`前 ${h} 秒观察 → 后 ${f} 秒预测`;
  element('observe-badge').textContent=`前 ${h} 秒`;
  element('forecast-heading').textContent=`未来 ${f} 秒的动作`;
  element('forecast-explanation').textContent=`以20Hz整理过去${h}秒的${h*20}帧肩、肘、腕等观测，直接输出未来${f}秒的${f*20}帧预测。`;
  element('preview').textContent=practiceMode()?'播放练习示范':reviewMode()?'播放同步复盘':`预演 ${f} 秒`;
  element('input-time-label').textContent=`← 过去${h}秒输入`;
  element('output-time-label').textContent=`未来${f}秒输出 →`;
  element('playback-note').textContent=`预测未来${f}秒，以${Number(previewSpeed.value)}倍速用${(f/Number(previewSpeed.value)).toFixed(1)}秒播放。慢放只影响录播预演，摄像头按实际时间监测。`;
  const frames=dataset?.horizon_frames || f*20;
  [...element('ghost-key').children].slice(1).forEach((span,index)=>{span.textContent=`● +${(Math.round([.3,.6,1][index]*frames)/20).toFixed(2)}秒`;});
  element('window-note').textContent=`建议先用2秒预测、半速预演；3秒可看更远，但不确定性更大。小幅预测也可能代表动作维持；切换“练习指引”可看具体调整。摄像头初次积累${h}秒历史，此后滚动更新。`;
}

function showMetrics(value) {
  if (!value) return;
  for (const method of ['gru','persistence','velocity']) {
    const metric=value.metrics?.[method]?.ade;element(`metric-${method}`).textContent=Number.isFinite(metric)?metric.toFixed(3):'—';
  }
  const adaptive=value.metrics?.adaptive;
  const h=value.metadata?.history_seconds || 2; const f=value.metadata?.horizon_seconds || .5;
  element('adaptive-metric').textContent=adaptive ? `当前 ${h}秒 → ${f}秒：自适应 ADE ${adaptive.ade.toFixed(4)} · FDE ${adaptive.fde.toFixed(4)} · 手腕 ADE ${adaptive.wrist_ade?.toFixed(4)}。` : '尚无自适应方法评测。';
  const speakers=value.metadata?.data_provenance?.speakers_per_split;
  if (speakers) {
    const measured=adaptive?.ade ?? value.metrics.gru.ade, baseline=value.metrics.persistence.ade;
    const comparison=measured<baseline ? `当前方法ADE低于保持姿态${((1-measured/baseline)*100).toFixed(1)}%` : '当前方法ADE尚未超过保持姿态';
    element('evaluation-note').textContent=`训练${speakers.train}人、验证${speakers.validation}人、测试${speakers.test}人；当前组合共${value.metrics.gru.windows}个测试窗口。${comparison}。误差单位为肩宽、参照自动姿态；窗口重叠，测试人员此前已有评测，属于固定开发留出集。不同预测时长的ADE不可直接当作算法提升比较。`;
  }
}

function avatarChoice() {
  return resolveAvatarPreference(dataset, element('avatar-character').value, savedAvatarPreferences);
}

function showAvatarChoice(choice) {
  const name = choice.character === 'male' ? '男性形象' : '女性形象';
  element('avatar-preference-note').textContent = `${name} · ${choice.description}，可手动切换`;
}

function message(text, error = false) {
  element('status').textContent = text;
  element('status').classList.toggle('error', error);
}

function clock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}

function drawObservation(anchor) {
  const canvas=observationCanvas,context=canvas.getContext('2d');
  canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight;
  context.clearRect(0,0,canvas.width,canvas.height);
  const points=dataset?.live_image || dataset?.detailed_image_points?.[anchor];
  const quality=dataset?.live_detail?.visibility || dataset?.detailed_visibility?.[anchor];
  if(!points||!quality)return;
  const scale=Math.min(canvas.width/(video.videoWidth||640),canvas.height/(video.videoHeight||360));
  const w=(video.videoWidth||640)*scale,h=(video.videoHeight||360)*scale,x=(canvas.width-w)/2,y=(canvas.height-h)/2;
  const xy=j=>[x+points[j][0]*w,y+points[j][1]*h];
  context.strokeStyle='rgba(99,221,208,.8)';context.lineWidth=2;
  for(const [a,b] of [[11,12],[11,13],[13,15],[12,14],[14,16],[15,17],[15,19],[15,21],[16,18],[16,20],[16,22],[11,23],[12,24],[23,24]]) {
    if(Math.min(quality[a],quality[b])<.4)continue;
    context.beginPath();context.moveTo(...xy(a));context.lineTo(...xy(b));context.stroke();
  }
  points.forEach((_,j)=>{if(quality[j]<.4)return;context.fillStyle=j>=15&&j<=22?'#ffce8b':'#c0fff3';context.beginPath();context.arc(...xy(j),j>=15&&j<=22?3:2,0,Math.PI*2);context.fill();});
}
video.addEventListener('seeked',()=>{if(rows.length)drawObservation(observationIndex());});
new ResizeObserver(()=>{if(rows.length)drawObservation(observationIndex());}).observe(video.parentElement);

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
  return result;
}

const stage = element('stage');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.set(0.35, 0.05, 5.2);
let renderer;
let controls;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -0.48, 0);
  controls.enableDamping = true;
  controls.minDistance = 2;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.76;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.03;
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa1b8, 2.1));
  const light = new THREE.DirectionalLight(0xfff4e8, 2.8);
  light.position.set(-3, 4, 5);
  light.castShadow = false;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -5, right: 5, top: 5, bottom: -6 });
  light.shadow.normalBias = 0.035;
  light.target.position.set(0, -1.5, 0);
  scene.add(light.target);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xe1e9ff, 1.2);
  fill.position.set(3, 1, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 2);
  rim.position.set(1, 3, -4);
  scene.add(rim);
  new ResizeObserver(() => {
    const { width, height } = stage.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resetCamera();
  }).observe(stage);
} catch (error) {
  message(`3D初始化失败：${error.message}。请使用支持WebGL的浏览器。`, true);
}

function skeleton(color, opacity) {
  const group = new THREE.Group();
  const joints = Array.from({ length: 9 }, (_, index) => {
    const material = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.7 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(index === 0 ? 0.115 : 0.038, 16, 12), material);
    group.add(mesh);
    return mesh;
  });
  const bones = Array.from({ length: 10 }, () => {
    const material = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.6 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 10), material);
    group.add(mesh);
    return mesh;
  });
  scene.add(group);
  group.visible = false;
  return { group, joints, bones, opacity };
}

const currentSkeleton = skeleton(0x6bb9bc, 0.48);
const predictedSkeleton = skeleton(0x9671db, 0.95);
const actualSkeleton = skeleton(0xd7a15c, 0.65);
const up = new THREE.Vector3(0, 1, 0);
const connections = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8]];
const trajectoryGroup = new THREE.Group();
scene.add(trajectoryGroup);
const ghostPathGroup = new THREE.Group();
scene.add(ghostPathGroup);

function clearGhostPaths() {
  for (const object of [...ghostPathGroup.children]) {
    object.removeFromParent(); object.geometry?.dispose(); object.material?.dispose();
  }
}

function drawGhostPaths(visibility) {
  clearGhostPaths();
  if (!avatars) return;
  for (const [arm, joint] of [[0,5],[1,6]]) {
    if (visibility[joint] < .4) continue;
    const points=[avatars.predicted,...avatars.ghosts].map(a=>a.arms[arm].hand.getWorldPosition(new THREE.Vector3()));
    const color=practiceMode()?0xc56e27:0x117d83;
    ghostPathGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity:.85,depthTest:false})));
    points.slice(1).forEach((point,index)=>{
      const dot=new THREE.Mesh(new THREE.SphereGeometry(.025+index*.006,12,8),new THREE.MeshBasicMaterial({color,depthTest:false}));
      dot.position.copy(point); dot.renderOrder=5; ghostPathGroup.add(dot);
    });
  }
}

function updateGuidance(row) {
  const horizon=dataset.horizon_frames/dataset.fps;
  const guide=motionGuidance(dataset.positions[row.anchor],row.positions,dataset.visibility[row.anchor],element('practice-goal').value,horizon);
  element('guide-quality').textContent=`${guide.visible} / ${guide.total} 个肩肘腕可见`;
  element('guide-left').textContent=guide.hands[0].text;
  element('guide-right').textContent=guide.hands[1].text;
  element('guide-evaluation').textContent=guide.evaluation;
  element('guide-distance').textContent=`预计最大手部路径 ${guide.maxTravel.toFixed(2)} 个肩宽 / ${horizon}秒`;
  element('guide-advice').textContent=guide.suggestion;
  element('guide-note').textContent='残影是可能发生的动作，建议是可选择的调整。'+guide.note;
  if (!practice) capturePractice();
  element('detail-measurements').textContent='模型预测变化：'+guide.hands.map(h=>h.reliable?`${h.name}位移 ${h.displacement.toFixed(2)} 肩宽 / 肘角${h.angleChange>=0?'+':''}${h.angleChange.toFixed(0)}°`:`${h.name}观测不足`).join('；');
}

function updateSkeleton(target, positions, visibility) {
  target.group.visible = Boolean(positions);
  if (!positions) return;
  target.joints.forEach((joint, index) => {
    joint.position.fromArray(positions[index]);
    joint.material.opacity = target.opacity * ((visibility?.[index] ?? 1) >= 0.4 ? 1 : 0.12);
  });
  connections.forEach(([start, end], index) => {
    const first = new THREE.Vector3(...positions[start]);
    const second = new THREE.Vector3(...positions[end]);
    const direction = second.clone().sub(first);
    const bone = target.bones[index];
    bone.position.copy(first).add(second).multiplyScalar(0.5);
    bone.scale.set(1, Math.max(0.0001, direction.length()), 1);
    bone.quaternion.setFromUnitVectors(up, direction.normalize());
    bone.material.opacity = target.opacity * (Math.min(visibility?.[start] ?? 1, visibility?.[end] ?? 1) >= 0.4 ? 1 : 0.1);
  });
  const neckStart = new THREE.Vector3(...positions[0]);
  const neckEnd = new THREE.Vector3(...positions[1]).add(new THREE.Vector3(...positions[2])).multiplyScalar(0.5);
  const neckDirection = neckEnd.clone().sub(neckStart);
  const neck = target.bones[8];
  neck.position.copy(neckStart).add(neckEnd).multiplyScalar(0.5);
  neck.scale.set(1, Math.max(0.0001, neckDirection.length()), 1);
  neck.quaternion.setFromUnitVectors(up, neckDirection.normalize());
  neck.material.opacity = target.opacity * ((visibility?.[0] ?? 1) >= 0.4 ? 1 : 0.1);
  target.bones[9].visible = false;
}

function trajectories(row) {
  while (trajectoryGroup.children.length) {
    const child = trajectoryGroup.children[0];
    trajectoryGroup.remove(child);
    child.geometry.dispose();
    child.material.dispose();
  }
  for (const joint of [5, 6]) {
    if (dataset.visibility[row.anchor][joint] < 0.4) continue;
    const points = [dataset.positions[row.anchor][joint], ...row.positions.map(pose => pose[joint])];
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
    trajectoryGroup.add(new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0xab90dd, dashSize: 0.06, gapSize: 0.035, transparent: true, opacity: 0.7 })));
    trajectoryGroup.children.at(-1).computeLineDistances();
  }
}

function detailAt(index) {
  if (dataset?.live_detail) return dataset.live_detail;
  const positions=sampleSequence(dataset?.detailed_positions,index);
  return positions ? {positions,visibility:sampleVisibility(dataset.detailed_visibility,index)} : null;
}
function observationIndex() {
  if(!dataset || !rows.length)return 0;
  if(liveStream)return rows[selectedRow].anchor;
  return Math.max(0,Math.min(dataset.positions.length-1,Math.round(video.currentTime*dataset.fps)));
}
function capturePractice(reuse=false) {
  if(!dataset || !rows.length)return;
  const row=rows[selectedRow];
  const at=liveStream?row.anchor:observationIndex();
  const source=reuse && practice ? practice : {
    current:sampleSequence(dataset.positions,at),visibility:sampleVisibility(dataset.visibility,at),
    detail:detailAt(at),anchor_seconds:liveStream?dataset.timestamps.at(-1):at/dataset.fps,
  };
  practice={...practiceTrajectory(source.current,source.visibility,element('practice-goal').value,dataset.horizon_frames,element('practice-hand').value),
    current:source.current,visibility:source.visibility,detail:source.detail,anchor_seconds:source.anchor_seconds};
  element('practice-instructions').textContent=practice.steps.join('；')+'。';
  element('practice-origin').textContent=`起点已固定在 ${clock(practice.anchor_seconds)}。动作方向按演讲者自身左右理解；换起点时再点“以当前姿态开始”。`;
}
function queueTransition() {
  const target=rows[selectedRow]?.positions.at(-1);
  displayTransition=target && displayedPrediction ? {from:displayedPrediction,to:target,started:performance.now(),duration:120} : null;
  const current=dataset?.positions[rows[selectedRow]?.anchor];
  observedTransition=current && displayedCurrent ? {from:displayedCurrent,to:current,started:performance.now(),duration:120} : null;
}
function carriedDetail(pose,current,detail) {
  if(!pose||!detail)return null;
  const points=detail.positions.map(p=>p.slice());
  for(const [elbow,wrist,indices] of [[3,5,[15,17,19,21]],[4,6,[16,18,20,22]]]) {
    const before=new THREE.Vector3().fromArray(current[wrist]).sub(new THREE.Vector3().fromArray(current[elbow])).normalize();
    const after=new THREE.Vector3().fromArray(pose[wrist]).sub(new THREE.Vector3().fromArray(pose[elbow])).normalize();
    const rotation=new THREE.Quaternion().setFromUnitVectors(before,after);
    for(const j of indices)points[j]=new THREE.Vector3().fromArray(detail.positions[j]).sub(new THREE.Vector3().fromArray(current[wrist])).applyQuaternion(rotation).add(new THREE.Vector3().fromArray(pose[wrist])).toArray();
  }
  return {positions:points,visibility:detail.visibility,inherited:true};
}
function paint(now=performance.now(),forceHud=true) {
  if (!dataset || !rows.length) return;
  const row=rows[selectedRow],review=reviewMode(),guided=practiceMode();
  const current=guided && practice ? practice.current : dataset.positions[row.anchor];
  const visibility=guided && practice ? practice.visibility : dataset.visibility[row.anchor];
  const currentDetail=guided && practice ? practice.detail : detailAt(row.anchor);
  const shown=guided && practice ? practice.positions : row.positions;
  let positions=forecastPose(current,shown,previewPhase);
  if(!review && !guided && displayTransition && !playback) {
    const fraction=(now-displayTransition.started)/displayTransition.duration;
    positions=blendPose(displayTransition.from,displayTransition.to,fraction);
    if(fraction>=1)displayTransition=null;
  }
  displayedPrediction=positions;
  const compared=review ? reviewFrame(dataset,row,previewPhase) : null;
  const bones=displayMode==='skeleton';
  const trails=!bones && !review && !guided && element('ghosts').checked;
  let observed=current;
  if(!guided && !review && !playback){
    if(!liveStream && !video.paused){observed=sampleSequence(dataset.positions,video.currentTime*dataset.fps);observedTransition=null;}
    else if(observedTransition){
      const fraction=(now-observedTransition.started)/observedTransition.duration;
      observed=blendPose(observedTransition.from,observedTransition.to,fraction);
      if(fraction>=1)observedTransition=null;
    }
  }
  displayedCurrent=observed;
  updateSkeleton(currentSkeleton,bones && !review && !guided ? observed : null,visibility);
  updateSkeleton(predictedSkeleton,bones ? positions : null,visibility);
  updateSkeleton(actualSkeleton,bones && review ? compared.left : null,compared?.visibility);
  predictedSkeleton.group.position.x=review?1.22:0;
  actualSkeleton.group.position.x=-1.22;
  trajectoryGroup.visible=bones && !review && !guided;
  if(avatars) {
    avatars.predicted.group.position.x=review?1.22:0;
    avatars.actual.group.position.x=-1.22;
    avatars.predicted.update(bones?null:trails?observed:positions,visibility,carriedDetail(trails?observed:positions,current,currentDetail));
    avatars.actual.update(!bones && review ? compared.left : null,compared?.visibility,review?detailAt(compared.index):null);
    avatars.ghosts.forEach((ghost,index)=>{
      ghost.group.position.x=0;
      const phase=[.3,.6,1][index];
      const ghostPose=shown[Math.max(0,Math.round(phase*shown.length)-1)];
      ghost.update(trails && previewPhase+1e-6>=phase ? ghostPose : null,visibility,carriedDetail(ghostPose,current,currentDetail));
    });
    const key=`${dataset.timestamps[row.anchor]}/${methodInput.value}/${shown.length}/${avatarLoadToken}`;
    ghostPathGroup.visible=trails && previewPhase===1;
    if(ghostPathGroup.visible && key!==pathKey){drawGhostPaths(visibility);pathKey=key;}
  }
  displayedFrame={mode:purposeInput.value,phase:previewPhase,anchor_seconds:dataset.timestamps[row.anchor],
    seconds:compared?.seconds ?? (guided?practice?.anchor_seconds:dataset.timestamps[row.anchor])+previewPhase*shown.length/dataset.fps,
    left:review?compared.left:null,right:review?positions:null,pose:positions,
    raw:row.positions,actual_index:compared?.index,video_seconds:video.currentTime,
    practice_anchor:practice?.anchor_seconds,visibleAvatars:avatars?[avatars.predicted,avatars.actual,...avatars.ghosts].filter(a=>a.group.visible).length:0};
  if(!forceHud && now-hudStamp<80)return;
  hudStamp=now;
  const offset=previewPhase*shown.length/dataset.fps;
  element('forecast-heading').textContent=guided?'跟着人物练一个动作':review?'同一时刻，实际与预测对照':`未来 ${dataset.horizon_frames/dataset.fps} 秒的动作`;
  element('video-heading').textContent=review?'同步回放的原录像':guided?'练习起点 / 实时观察':'已观察的演讲';
  element('comparison-labels').hidden=!review;
  if(review){
    element('comparison-labels').children[0].textContent=`左 · 录像实测 ${clock(compared.seconds)}`;
    element('comparison-labels').children[1].textContent=`右 · 模型预测 ${clock(compared.seconds)}`;
  }
  const quality=avatars?.predicted.lastQuality;
  if(quality)element('pose-quality').textContent=quality.neutral===2?'双臂未可靠入镜 · 自然姿态占位':quality.neutral===1?'一侧手臂未可靠入镜 · 自然姿态占位':quality.inferred?'部分手肘 / 手腕由几何关系补全':`肩肘腕观测可用 · ${quality.palms||0}只掌面方向可用`;
  element('pose-quality').hidden=bones;
  element('ghost-key').hidden=!trails;
  element('ghost-toggle').hidden=review||guided;
  stage.dataset.trails=String(trails);stage.dataset.previewing=String(Boolean(playback));stage.dataset.purpose=purposeInput.value;
  element('stage-panel').classList.toggle('practice-view',guided);
  element('practice-controls').hidden=!guided;
  element('detail-measurements').hidden=guided;
  element('purpose-note').textContent=guided?'自选目标生成的练习示范':review?'左侧实测、右侧预测；原录像同步回放':'模型预计接下来怎样动';
  element('observed-legend').hidden=review||guided||!(bones||trails);
  element('predicted-legend').textContent=guided?'建议动作 · 起点固定':review?'实测姿态来自录像估计':'预测动作 · 越远越不确定';
  element('forecast-time').textContent=guided?`示范 ${offset.toFixed(2)}s`:`+${offset.toFixed(2)}s`;
  element('display-clock').textContent=review?`预测起点 ${clock(dataset.timestamps[row.anchor])} → 对照时刻 ${clock(compared.seconds)}`:guided?`示范进度 ${Math.round(previewPhase*100)}% · 可反复看起点与终点`:`预测起点 ${clock(dataset.timestamps[row.anchor])} → 预计 ${clock(dataset.timestamps[row.anchor]+offset)}`;
  element('future-scrub').value=String(Math.round(previewPhase*100));element('future-progress').textContent=`${Math.round(previewPhase*100)}%`;
  element('preview').textContent=guided?'播放练习示范':review?'播放同步复盘':`预演 ${shown.length/dataset.fps} 秒`;
}
function scrub(phase) {
  if(!liveStream)video.pause();previewToken++;playback=null;displayTransition=null;observedTransition=null;previewPhase=phase;
  if(reviewMode() && rows.length)video.currentTime=dataset.timestamps[rows[selectedRow].anchor]+phase*dataset.horizon_frames/dataset.fps;
  paint();
}
async function startPreview() {
  if(!dataset || !rows.length)return;
  if(!liveStream)video.pause();displayTransition=null;observedTransition=null;
  const token=++previewToken;previewPhase=0;
  playback={token,started:performance.now(),duration:1000*dataset.horizon_frames/dataset.fps/Number(previewSpeed.value)};
  if(reviewMode()) {
    video.currentTime=dataset.timestamps[rows[selectedRow].anchor];
    video.playbackRate=Number(previewSpeed.value);
    try{await video.play();}catch(error){playback=null;message(`无法播放：${error.message}`,true);}
  }
  paint();
}

function resetCamera() {
  const comparison = reviewMode();
  if(controls){controls.minAzimuthAngle=comparison?-.6:-Infinity;controls.maxAzimuthAngle=comparison?.6:Infinity;}
  const full = cameraView === 'full' && displayMode === 'avatar';
  const close = cameraView === 'detail' && displayMode === 'avatar';
  const fitted = (comparison ? 4.5 : close ? 1.6 : 2.4) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  const distance = Math.max(full ? 9.1 : comparison ? 6.8 : close ? 3.1 : 5.2, fitted);
  camera.position.set(cameraView === 'angle' ? distance * 0.48 : 0.35, full ? -0.8 : 0.05, distance);
  controls?.target.set(0, full ? -1.5 : close && !comparison ? 0.27 : -0.48, 0);
  controls?.update();
}

function setDisplay(mode) {
  displayMode = mode;
  element('view-avatar').setAttribute('aria-pressed', String(mode === 'avatar'));
  element('view-skeleton').setAttribute('aria-pressed', String(mode === 'skeleton'));
  element('stage').dataset.mode = mode;
  element('observed-legend').hidden = mode !== 'skeleton';
  element('predicted-legend').innerHTML = mode === 'avatar' ? '<i class="predicted"></i>人物播放预测动作' : '<i class="predicted"></i>模型预测';
  element('coordinate-note').textContent = mode === 'avatar' ? '通用人物展示上半身动作，不还原本人外貌。未来掌面随前臂转动；手指和下半身不单独预测。' : '相对肩部中心的单目3D估计，非动作捕捉真值；姿态不可靠时，关节淡化显示。';
  resetCamera();
  paint();
}

function select(index, seek = true) {
  if (!rows.length) return;
  selectedRow = Math.max(0, Math.min(rows.length - 1, index));
  timeline.value = selectedRow;
  const row = rows[selectedRow];
  const at = dataset.timestamps[row.anchor];
  element('anchor-time').textContent = clock(at);
  element('history-label').textContent = `观察窗口 ${clock(dataset.timestamps[row.anchor - dataset.history_frames + 1])} – ${clock(at)}`;
  const ranges = dataset.split_ranges;
  let label = '跨分区窗口 · 不计评测';
  for (const [name, [start, end]] of Object.entries(ranges)) {
    if (row.anchor - dataset.history_frames + 1 >= start && row.anchor + dataset.horizon_frames < end) label = { train: '训练片段', validation: '验证片段', test: '留出测试片段' }[name];
  }
  element('split-label').textContent = dataset.source === '用户上传视频' ? '新上传片段' : label;
  if (dataset.training_split === 'test') element('split-label').textContent = '跨演讲者测试片段';
  if (seek) video.currentTime = at;
  const latency = dataset.latency_ms?.[methodInput.value];
  element('inference').textContent = Number.isFinite(latency) ? `单窗口预测计算 ${latency.toFixed(1)} ms · 不含姿态提取` : `预测跨度 ${dataset.horizon_frames/dataset.fps}秒`;
  if(!seek && !practiceMode())queueTransition();
  if(seek) {displayTransition=null; if(practiceMode())capturePractice();}
  if(displayMode==='skeleton')trajectories(row);
  updateGuidance(row);
  drawObservation(row.anchor);
  paint();
}

function changeMethod() {
  if (liveStream) {liveExportSnapshot=null;displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;element('export').disabled=true;return;}
  if (!dataset) return;
  video.pause();
  previewToken += 1;
  const oldAnchor = rows[selectedRow]?.anchor || 0;
  rows = dataset.forecasts[methodInput.value] || [];
  if (!rows.length) {
    message('当前方法没有可用预测，请选择另一方法。', true);
    return;
  }
  timeline.max = rows.length - 1;
  selectedRow = Math.max(0, rows.findLastIndex(row => row.anchor <= oldAnchor));
  previewPhase = reviewMode()||practiceMode()?0:1;
  select(selectedRow);
}

async function load(source,oldAnchor=null) {
  stopLive();
  video.pause();
  previewToken += 1;
  dataset = typeof source==='string' ? await json(source) : source;
  purposeInput.querySelector('[value=review]').disabled=false;
  historyInput.value=String(dataset.history_frames/dataset.fps);horizonInput.value=String(dataset.horizon_frames/dataset.fps);
  timingLabels();showMetrics(dataset.report || report);
  showAvatarChoice(avatarChoice());
  if (avatars && avatarChoice().character !== loadedCharacter) refreshAvatar();
  else if (avatars) element('stage').dataset.preferenceSource = avatarChoice().source;
  video.src = dataset.video_url;
  practice=null;displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;playback=null;
  element('empty-video').hidden = true;
  element('stage-empty').hidden = Boolean(avatars) || displayMode === 'skeleton';
  element('source-title').textContent = dataset.title;
  for (const option of methodInput.options) option.disabled = !dataset.forecasts[option.value]?.length;
  if (!dataset.forecasts[methodInput.value]?.length) methodInput.value = dataset.forecasts.adaptive?.length ? 'adaptive' : dataset.forecasts.gru?.length ? 'gru' : 'persistence';
  rows = dataset.forecasts[methodInput.value];
  if (!rows?.length) throw new Error('视频没有足够长的有效观察窗口。');
  timeline.max = rows.length - 1;
  const testStart = dataset.split_ranges.test[0] + dataset.history_frames - 1;
  selectedRow = dataset.source === '用户上传视频' || dataset.training_split === 'test' ? 0 : Math.max(0, rows.findIndex(row => row.anchor >= testStart));
  if (Number.isInteger(dataset.preferred_anchor)) selectedRow = Math.max(0, rows.findIndex(row => row.anchor >= dataset.preferred_anchor));
  if (Number.isInteger(oldAnchor)) selectedRow=Math.max(0,rows.findLastIndex(row=>row.anchor<=oldAnchor));
  previewPhase = reviewMode()||practiceMode()?0:1;
  for (const id of ['timeline', 'play', 'preview', 'export']) element(id).disabled = false;
  const ready = () => select(selectedRow);
  if (video.readyState >= 1) ready(); else video.addEventListener('loadedmetadata', ready, { once: true });
  select(selectedRow, false);
  message(`${dataset.title} · ${dataset.positions.length} 帧姿态 · 使用过去${dataset.history_frames/dataset.fps}秒，预测未来${dataset.horizon_frames/dataset.fps}秒。`);
}

function setBusy(value) {
  busy = value;
  for (const id of ['sample-button', 'upload-button','live-button','method']) element(id).disabled = value;
  historyInput.disabled=horizonInput.disabled=value || !windowOptions?.available;
  for (const id of ['timeline','play','preview','export']) element(id).disabled=value || !rows.length || (Boolean(liveStream) && id!=='export');
  element('progress').hidden = !value;
}

element('sample-button').addEventListener('click', async () => {
  setBusy(true);
  try { await load(sampleUrl()); } catch (error) { message(`示例载入失败：${error.message}`, true); } finally {setBusy(false);}
});
element('upload-button').addEventListener('click', () => element('upload').click());
element('upload').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || busy) return;
  stopLive();
  setBusy(true);
  try {
    const body = new FormData();
    body.append('video', file);
    for (const [key,value] of Object.entries(configuration())) body.append(key,String(value));
    const created = await json('/api/analyze', { method: 'POST', body });
    while (true) {
      const job = await json(`/api/jobs/${created.job_id}`);
      element('progress').value = job.progress || 0;
      message(`正在本机提取姿态与计算预测… ${Math.round((job.progress || 0) * 100)}%`);
      if (job.status === 'error') throw new Error(job.error);
      if (job.status === 'done') { await load(job.result_url); break; }
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); event.target.value = ''; }
});
methodInput.addEventListener('change', changeMethod);
async function changeWindow() {
  if (busy) return;
  saveTiming();previewToken++;
  if(liveStream){
    liveExportSnapshot=null;displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;practice=null;element('export').disabled=true;
    message('时间设置已更新，正在等候新的观察窗口…');
    const config=JSON.stringify(configuration());
    try {const value=await json('/api/window-report?'+new URLSearchParams(configuration()));if(config===JSON.stringify(configuration()))showMetrics(value);} catch(error){message(error.message,true);}
    return;
  }
  if(!dataset?.source_id){message('设置已保存，请载入示例或上传视频。');return;}
  const oldAnchor=rows[selectedRow]?.anchor;
  setBusy(true);message('正在用已提取姿态重新预测，无需重新上传视频…');
  try {
    const result=await json('/api/reforecast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...configuration(),source_id:dataset.source_id})});
    await load(result,oldAnchor);
  } catch(error) {
    historyInput.value=String(dataset.history_frames/dataset.fps);horizonInput.value=String(dataset.horizon_frames/dataset.fps);
    saveTiming();message(error.message,true);
  } finally {setBusy(false);}
}
historyInput.addEventListener('change',changeWindow);horizonInput.addEventListener('change',changeWindow);
previewSpeed.addEventListener('change',()=>{scrub(previewPhase);saveTiming();timingLabels();paint();});
timeline.addEventListener('input', () => {video.pause();previewToken++;playback=null;previewPhase=reviewMode()||practiceMode()?0:1;select(Number(timeline.value));});

element('ghosts').addEventListener('change',()=>{pathKey='';paint();});
for(const id of ['practice-goal','practice-hand'])element(id).addEventListener('change',()=>{capturePractice(true);scrub(0);});
element('practice-capture').addEventListener('click',()=>{capturePractice();scrub(0);});
element('practice-start').addEventListener('click',()=>scrub(0));
element('practice-end').addEventListener('click',()=>scrub(1));
element('practice-play').addEventListener('click',startPreview);
purposeInput.addEventListener('change',()=>{
  video.pause();previewToken++;playback=null;displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;
  if(practiceMode())capturePractice();
  previewPhase=reviewMode()||practiceMode()?0:1;
  if(!liveStream && rows.length && !practiceMode())video.currentTime=dataset.timestamps[rows[selectedRow].anchor];
  if(liveStream)video.play().catch(()=>{});
  if(liveStream)element('preview').disabled=!practiceMode()||!rows.length;
  resetCamera();timingLabels();paint();
});
element('future-scrub').addEventListener('input',event=>scrub(Number(event.target.value)/100));
element('view-avatar').addEventListener('click', () => setDisplay('avatar'));
element('view-skeleton').addEventListener('click', () => { element('stage-empty').hidden = true; setDisplay('skeleton'); });
element('camera-view').addEventListener('change', event => { cameraView = event.target.value; resetCamera(); });
element('avatar-quality').addEventListener('change', () => refreshAvatar());
element('avatar-character').addEventListener('change', () => {
  const selected = element('avatar-character').value;
  try {
    if (selected === 'male' || selected === 'female') {
      rememberAvatarPreference(window.localStorage, dataset, selected);
      savedAvatarPreferences = readAvatarPreferences(window.localStorage);
    }
  } catch {}
  refreshAvatar();
});
element('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element('stage-panel').requestFullscreen();
  } catch (error) { message(`暂时无法全屏：${error.message}`, true); }
});
element('play').addEventListener('click',async()=>{
  if(reviewMode()){if(playback){scrub(previewPhase);}else await startPreview();return;}
  previewToken++;playback=null;previewPhase=1;displayTransition=null;video.playbackRate=1;
  if(video.paused){try{await video.play();}catch(error){message(error.message,true);}}else video.pause();
});
video.addEventListener('play',()=>element('play').textContent='Ⅱ');
video.addEventListener('pause',()=>element('play').textContent='▶');
element('preview').addEventListener('click',startPreview);
element('reset-camera').addEventListener('click', resetCamera);
element('export').addEventListener('click', () => {
  const row = rows[selectedRow];
  let payload;
  if(liveStream && liveExportSnapshot) {
    payload={...liveExportSnapshot.payload,exported_at:new Date().toISOString(),snapshot_age_seconds:(performance.now()-liveExportSnapshot.receivedAt)/1000,note:'摄像头最近一次有效预测快照；以anchor_seconds标记会话内观测时刻，并非导出时刻的新预测。'};
  } else {
    if(!dataset || !row){message('当前没有有效预测可导出，请等待观测恢复。',true);return;}
    payload = { method: methodInput.value, model_profile:dataset.model_profile || 'legacy', anchor_seconds: dataset.timestamps[row.anchor], history_seconds: dataset.history_frames/dataset.fps, horizon_seconds: dataset.horizon_frames/dataset.fps, preview_speed:Number(previewSpeed.value), positions: row.positions, joint_names: dataset.joint_names, coordinate_note: dataset.coordinate_note,practice:practice,displayed_content:practiceMode()?'rule_generated_practice':reviewMode()?'review':'prediction',display_clock:{anchor_seconds:dataset.timestamps[row.anchor],offset_seconds:previewPhase*dataset.horizon_frames/dataset.fps,left:reviewMode()?'actual':null,right:reviewMode()?'prediction':null} };
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'talkeval-motion-forecast.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function refreshAvatar() {
  const token = ++avatarLoadToken;
  const quality = element('avatar-quality');
  renderer?.setPixelRatio(Math.min(window.devicePixelRatio||1,quality.value==='hd'?1.5:1.25));
  const choice = avatarChoice();
  showAvatarChoice(choice);
  quality.disabled = true;
  try {
    const result = await loadSpeakerAvatars(scene, quality.value, choice.character);
    if (token !== avatarLoadToken) { result.predicted.dispose(); result.actual.dispose(); result.ghosts.forEach(a=>a.dispose()); return; }
    avatars?.predicted.dispose();
    avatars?.actual.dispose();
    avatars?.ghosts.forEach(a=>a.dispose());
    avatars = result;
    loadedCharacter = choice.character;
    element('stage').dataset.avatarReady = 'true';
    element('stage').dataset.quality = quality.value;
    element('stage').dataset.character = choice.character;
    element('stage').dataset.preferenceSource = avatarChoice().character === choice.character ? avatarChoice().source : choice.source;
    element('stage-empty').hidden = true;
    setDisplay(displayMode);
    showAvatarChoice(avatarChoice());
    if (avatarChoice().character !== loadedCharacter) queueMicrotask(() => refreshAvatar());
  } catch (error) {
    if (!avatars) { element('stage-empty').hidden = true; setDisplay('skeleton'); }
    message(`人物模型载入失败：${error.message}`, true);
  } finally { if (token === avatarLoadToken) quality.disabled = false; }
}

async function initialize() {
  updateAlignment();
  refreshAvatar();
  try {
    const status = await json('/api/status');
    report = status.report;
    windowOptions=status.window_options;
    let saved={};try {saved=JSON.parse(localStorage.getItem('talkeval-window-v2') || '{}');} catch {}
    if(windowOptions?.available) {
      windowProfile='flexible';
      for(const option of horizonInput.options)option.disabled=!windowOptions.horizons.includes(Number(option.value));
      historyInput.value=String(windowOptions.histories.includes(saved.history_seconds)?saved.history_seconds:windowOptions.default_history_seconds);
      horizonInput.value=String(windowOptions.horizons.includes(saved.horizon_seconds)?saved.horizon_seconds:windowOptions.default_horizon_seconds);
    } else {historyInput.value='2';horizonInput.value='0.5';}
    if([.25,.5,1].includes(saved.preview_speed))previewSpeed.value=String(saved.preview_speed);
    showMetrics(report);setBusy(true);
    try {await load(sampleUrl());} finally {setBusy(false);}
  } catch (error) { message(`请选择示例或上传视频。${error.message}`, true); }
}

let frameCount=0, rateSince=performance.now(), lastObservation=0;
function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  let changing=false;
  if(playback && playback.token!==previewToken)playback=null;
  if(dataset && rows.length) {
    if(playback){
      previewPhase=Math.min(1,Math.max(0,reviewMode()?(video.currentTime-dataset.timestamps[rows[selectedRow].anchor])*dataset.fps/dataset.horizon_frames:(now-playback.started)/playback.duration));
      changing=true;
      if(previewPhase>=1){if(reviewMode()){video.pause();video.currentTime=dataset.timestamps[rows[selectedRow].anchor]+dataset.horizon_frames/dataset.fps;}playback=null;}
    } else if(!video.paused && !liveStream && !reviewMode() && !practiceMode()) {
      // Only use an anchor already observed; never blend in a forecast made in the future.
      const index=rows.findLastIndex(row=>dataset.timestamps[row.anchor]<=video.currentTime);
      if(index>=0 && index!==selectedRow){previewPhase=1;select(index,false);}
      if(element('ghosts').checked || displayMode==='skeleton')changing=true;
      if(video.currentTime>dataset.timestamps[rows.at(-1).anchor])video.pause();
    }
    if((displayTransition || observedTransition) && !practiceMode() && !reviewMode())changing=true;
    if(changing)paint(now,previewPhase===1 && !displayTransition);
    if((!video.paused || video.seeking) && now-lastObservation>60){drawObservation(observationIndex());lastObservation=now;}
  }
  controls?.update();renderer?.render(scene,camera);
  frameCount++;
  if(now-rateSince>1000){
    renderStats={fps:frameCount*1000/(now-rateSince),drawCalls:renderer?.info.render.calls||0};
    element('render-rate').textContent=`画面约 ${Math.round(renderStats.fps)} 帧/秒`;
    frameCount=0;rateSince=now;
  }
}
if(new URLSearchParams(location.search).has('debug'))window.__talkevalDiagnostics=()=>({frame:displayedFrame,render:renderStats,transition:!!displayTransition,practice:practice,playing:!!playback});
requestAnimationFrame(renderLoop);
initialize();

function stopLive() {
  const wasLive=Boolean(liveStream);
  liveToken += 1;
  liveStream?.getTracks().forEach(track=>track.stop()); liveStream=null;
  if (liveSession) fetch(`/api/live/${liveSession}`,{method:'DELETE',keepalive:true}).catch(()=>{});
  liveSession=null;video.srcObject=null;
  liveExportSnapshot=null;element('export').textContent='导出预测 ↓';element('export').disabled=!rows.length;
  element('live-button').textContent='开启摄像头监测';
  purposeInput.querySelector('[value=review]').disabled=dataset?.source==='实时摄像头';methodInput.disabled=false;
  if(wasLive){
    rows=[];playback=null;displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;practice=null;
    for(const id of ['timeline','play','preview','export'])element(id).disabled=true;
    for(const target of [currentSkeleton,predictedSkeleton,actualSkeleton])updateSkeleton(target,null);
    if(avatars)for(const avatar of [avatars.predicted,avatars.actual,...avatars.ghosts])avatar.update(null,[]);
    trajectoryGroup.visible=ghostPathGroup.visible=false;
  }
}

element('live-button').addEventListener('click',async()=>{
  if(liveStream){stopLive();message('摄像头已关闭。可重新载入录像示例。');return;}
  try {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前浏览器不支持摄像头，请在本机Chrome或Edge打开。');
    liveExportSnapshot=null;element('export').disabled=true;
    liveStream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:20}},audio:false});
    const created=await json('/api/live',{method:'POST'});liveSession=created.id;
    video.pause();video.removeAttribute('src');video.srcObject=liveStream;await video.play();
    previewToken++;const token=++liveToken;
    element('live-button').textContent='停止摄像头';element('empty-video').hidden=true;
    element('export').textContent='导出最近有效预测 ↓';
    if(reviewMode())purposeInput.value='prediction';
    purposeInput.querySelector('[value=review]').disabled=true;practice=null;playback=null;displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;
    for(const id of ['timeline','play'])element(id).disabled=true;
    element('preview').disabled=true;
    const canvas=document.createElement('canvas');canvas.width=Math.min(1280,video.videoWidth||640);canvas.height=Math.round(canvas.width*(video.videoHeight||480)/(video.videoWidth||640));
    const context=canvas.getContext('2d');const started=performance.now();
    async function capture() {
      if(token!==liveToken||!liveStream)return;
      try {
        const captured=performance.now();context.drawImage(video,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
        if(token!==liveToken)return;
        const requested={...configuration(),method:methodInput.value};const requestKey=JSON.stringify(requested);
        const body=new FormData();body.append('frame',blob,'frame.jpg');body.append('timestamp_ms',String(captured-started));
        for (const [key,value] of Object.entries(requested))body.append(key,String(value));
        const result=await json(`/api/live/${liveSession}`,{method:'POST',body});
        if(token!==liveToken)return;
        if(requestKey!==JSON.stringify({...configuration(),method:methodInput.value})){setTimeout(capture,15);return;}
        if(result.ready){
          dataset={fps:20,history_frames:result.history_frames,horizon_frames:result.horizon_frames,positions:result.history,visibility:result.visibility,timestamps:result.timestamps,source:'实时摄像头',joint_names:result.joint_names,coordinate_note:result.coordinate_note,model_profile:result.model_profile};
          dataset.live_detail=result.detail;dataset.live_image=result.image_points;
          rows=[{anchor:result.history_frames-1,positions:result.positions}];selectedRow=0;
          if(!practiceMode()){previewPhase=1;queueTransition();}
          element('preview').disabled=!practiceMode();
          timingLabels();element('source-title').textContent=`摄像头 · 过去${result.history_frames/20}秒观测`;element('split-label').textContent='实时输入 · 未用于训练';
          element('anchor-time').textContent=clock(result.timestamps.at(-1));
          element('history-label').textContent=`历史按20Hz重采样 · 当前采集约${result.capture_fps.toFixed(1)}fps`;
          element('inference').textContent=`本次处理 ${result.processing_ms.toFixed(0)}ms · 往返 ${(performance.now()-captured).toFixed(0)}ms`;
          liveExportSnapshot={receivedAt:performance.now(),payload:{method:requested.method,model_profile:result.model_profile,anchor_seconds:result.timestamps.at(-1),history_seconds:result.history_frames/20,horizon_seconds:result.horizon_frames/20,positions:result.positions,joint_names:result.joint_names,coordinate_note:result.coordinate_note}};
          element('export').disabled=false;if(displayMode==='skeleton')trajectories(rows[0]);updateGuidance(rows[0]);drawObservation(rows[0].anchor);if(!practiceMode()||!playback)paint();
          liveExportSnapshot.payload.practice=practice;liveExportSnapshot.payload.displayed_content=practiceMode()?'rule_generated_practice':'prediction';
          message('实时监测中 · 画面只发给本机服务，不保存摄像头录像。');
        } else {
          message(result.message);rows=[];displayTransition=null;displayedPrediction=null;observedTransition=null;displayedCurrent=null;playback=null;element('export').disabled=!liveExportSnapshot;
          updateSkeleton(currentSkeleton,null);updateSkeleton(predictedSkeleton,null);trajectoryGroup.visible=false;
          if(avatars){avatars.predicted.update(null,[]);avatars.actual.update(null,[]);avatars.ghosts.forEach(a=>a.update(null,[]));ghostPathGroup.visible=false;}
          observationCanvas.getContext('2d').clearRect(0,0,observationCanvas.width,observationCanvas.height);
        }
      } catch(error){if(token===liveToken){stopLive();message(error.message,true);}return;}
      if(token===liveToken)setTimeout(capture,15);
    }
    capture();
  }catch(error){stopLive();message(`无法开启摄像头：${error.message}`,true);}
});
window.addEventListener('pagehide',stopLive);
