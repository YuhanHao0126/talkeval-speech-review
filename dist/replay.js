(() => {
"use strict";
const state = {
  cases: [], selectedCase: null, selectedBeat: null,
  live: { caseData: null, session: null, lastSession: null, stream: null, recognition: null, audioContext: null, analyser: null, raf: 0, levels: [], startedAt: 0, stoppedByUser: false, interim: "", lastFinalAt: 0 },
};

const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[char]));

const verdictText = {
  sufficiently_realized: "完整表达",
  partially_realized: "部分表达",
  omitted: "疑似遗漏",
  evidence_insufficient: "证据不足",
};

const verdictClass = (verdict) => {
  if (verdict === "sufficiently_realized") return "full";
  if (verdict === "partially_realized") return "partial";
  if (verdict === "omitted") return "omitted";
  return "uncertain";
};

function sourceReviewLabel(source, scriptType) {
  if (source === "provided_script_or_outline") return "文稿已匹配";
  if (["sidecar_captions", "embedded_video_subtitles"].includes(source)) return "视频字幕已匹配";
  if (source === "faster_whisper_transcription" || scriptType === "transcript_proxy") return "无讲稿 · 转写提取";
  if (scriptType === "reference_script_proxy") return "参考文稿代理";
  return "来源待确认";
}

function sourceReviewDetail(metadata) {
  const source = metadata.script_source;
  if (source === "provided_script_or_outline") {
    const name = metadata.source_script_name || metadata.script_file || "已匹配讲稿/大纲";
    return `${name} · 重点由系统提取，建议核对`;
  }
  if (["sidecar_captions", "embedded_video_subtitles"].includes(source)) return "重点根据视频字幕提取，建议核对";
  if (source === "faster_whisper_transcription") return "未匹配讲稿 · 根据视频转写提取重点，优先核对";
  return "重点由系统自动提取，建议核对";
}

const pct = (value) => `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`;
const time = (seconds) => {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "未定位";
  const total = Number(seconds);
  const minutes = Math.floor(total / 60);
  const secs = (total % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${secs}`;
};

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function renderCaseList() {
  document.querySelector("#case-count").textContent = state.cases.length;
  document.querySelector("#library-summary").textContent = `${state.cases.length} 场本地参考演讲`;
  const list = document.querySelector("#case-list");
  if (!state.cases.length) {
    list.innerHTML = `<div class="loading-card">还没有案例。把视频放入 doc/video、把同名讲稿或字幕放入 doc/tex，系统会自动导入。</div>`;
    return;
  }
  list.innerHTML = state.cases.map((item, index) => {
    const counts = item.verdict_counts || {};
    const pills = [
      ["sufficiently_realized", counts.sufficiently_realized || 0],
      ["partially_realized", counts.partially_realized || 0],
      ["omitted", counts.omitted || 0],
    ].filter(([, value]) => value > 0).map(([key, value]) => `<span class="mini-pill pill-${verdictClass(key)}">${verdictText[key]} ${value}</span>`).join("");
    const sourcePill = `<span class="mini-pill pill-uncertain">${esc(sourceReviewLabel(item.script_source, item.script_type))}</span>`;
    const reviewPill = item.review_status === "provisional" ? `<span class="mini-pill pill-uncertain">重点待人工核对</span>` : "";
    return `<button class="case-button ${state.selectedCase === item.case_id ? "active" : ""}" data-case="${esc(item.case_id)}">
      <span class="case-index">${String(index + 1).padStart(2, "0")}</span><span class="case-title">${esc(item.title || item.case_id)}</span>
      <span class="case-speaker">${esc(item.speaker_id || "未登记演讲者")}</span>
      <span class="case-pills">${sourcePill}${reviewPill}${pills || `<span class="mini-pill pill-uncertain">未完成</span>`}</span>
    </button>`;
  }).join("");
  list.querySelectorAll("[data-case]").forEach((button) => button.addEventListener("click", () => selectCase(button.dataset.case)));
}

function metric(label, value) {
  return `<div><div class="metric-line"><span>${label}</span><span class="metric-value">${pct(value)}</span></div><div class="metric-bar"><div class="metric-fill" style="width:${pct(value)}"></div></div></div>`;
}

function renderTimeline(data) {
  const units = data.expression_map?.units || [];
  const duration = caseDuration(data) || 1;
  const matched = new Set((data.alignment?.decisions || []).flatMap((item) => item.matched_observed_ids || []));
  const selected = state.selectedBeat;
  const selectedIds = new Set(selected?.matched_observed_ids || []);
  const blocks = units.map((unit) => {
    const start = Number(unit.time_span?.[0] || 0);
    const end = Number(unit.time_span?.[1] || start);
    const left = (start / duration) * 100;
    const width = Math.max(.18, ((end - start) / duration) * 100);
    const cls = selectedIds.has(unit.observed_id) ? "selected" : (matched.has(unit.observed_id) ? "matched" : "");
    return `<button class="timeline-unit ${cls}" style="left:${left}%;width:${width}%" title="${esc(time(start))} ${esc(unit.text)}" data-start="${start}" data-observed-id="${esc(unit.observed_id)}"><span>${esc(unit.text)}</span></button>`;
  }).join("");
  return `<div class="timeline-track">${blocks}</div><div class="timeline-axis"><span>00:00</span><span>${time(duration)}</span></div>`;
}

function caseDuration(data) {
  return Math.max(
    Number(data.expression_map?.duration || 0),
    Number(data.visual_observations?.duration_seconds || 0),
    Number(data.slide_analysis?.duration_seconds || 0),
    1,
  );
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function fullVideoOverview(data) {
  const duration = caseDuration(data);
  const windowSeconds = Number(data.slide_analysis?.overview_interval_seconds || 45);
  const units = data.expression_map?.units || [];
  const allReliableAudio = units.filter((unit) => (unit.reliability?.audio || 0) >= .5);
  const paceBaseline = median(allReliableAudio.map((unit) => Number(unit.speech?.pace_per_minute)).filter((value) => value > 0));
  const observations = data.visual_observations?.observations || [];
  const sceneChanges = data.visual_observations?.scene_change_analysis?.candidates || [];
  const slideSegments = data.slide_analysis?.overview_segments || [];
  const decisions = data.alignment?.decisions || [];
  const rows = [];
  for (let start = 0; start < duration; start += windowSeconds) {
    const end = Math.min(duration, start + windowSeconds);
    const localUnits = units.filter((unit) => Number(unit.time_span?.[0]) < end && Number(unit.time_span?.[1]) > start);
    const transcript = localUnits.map((unit) => String(unit.text || "").trim()).filter(Boolean).join(" ");
    const excerpt = transcript.length > 210 ? transcript.slice(0, 210) + "…" : transcript || "该时段没有可用转写";
    const speech = localUnits.filter((unit) => (unit.reliability?.audio || 0) >= .5);
    const pace = median(speech.map((unit) => Number(unit.speech?.pace_per_minute)).filter((value) => value > 0));
    const paceText = pace === null ? "语速无可靠样本" : paceBaseline ? `语速 ${Math.round(pace)} 字/分（${pace > paceBaseline * 1.12 ? "较本场偏快" : pace < paceBaseline * .88 ? "较本场偏慢" : "接近本场中位数"}）` : `语速 ${Math.round(pace)} 字/分`;
    const energyValues = speech.map((unit) => Number(unit.speech?.energy_relative)).filter(Number.isFinite);
    const energy = energyValues.length ? energyValues.reduce((sum, value) => sum + value, 0) / energyValues.length : null;
    const pauseCount = localUnits.filter((unit) => Number(unit.speech?.pause_before) >= .8).length;
    const voiceText = `${paceText} · ${energy === null ? "响度无可靠样本" : energy >= .35 ? "相对响度高于本场基线" : energy <= -.35 ? "相对响度低于本场基线" : "相对响度接近本场基线"} · 较长句间停顿 ${pauseCount} 次`;
    const localVisual = observations.filter((item) => Number(item.timestamp) >= start && Number(item.timestamp) < end);
    const visibleFaces = localVisual.filter((item) => item.face?.visible).length;
    const movingHands = localVisual.filter((item) => ["left", "right"].some((side) => item.pose?.hands?.[side]?.movement === "clear_motion")).length;
    const visualText = localVisual.length ? `可见人脸 ${visibleFaces}/${localVisual.length} 个视觉样本 · 检出明显手腕位移 ${movingHands} 个样本` : "该段没有视觉样本";
    const slide = slideSegments.find((item) => Number(item.time_span?.[0]) < end && Number(item.time_span?.[1]) > start);
    const pptText = slide?.extracted_text ? `投影画面文字：${String(slide.extracted_text).slice(0, 120)}${String(slide.extracted_text).length > 120 ? "…" : ""}` : "该段抽样帧未识别到清晰页面文字";
    const core = decisions.filter((item) => item.actual_time_span && Number(item.actual_time_span[0]) < end && Number(item.actual_time_span[1]) > start);
    const changes = sceneChanges.filter((item) => Number(item.timestamp) >= start && Number(item.timestamp) < end).length;
    const status = core.length ? `重点详解：${core.map((item) => item.beat_id).join("、")}` : "普通表达段 · 轻量回顾";
    rows.push(`<button class="full-video-segment ${core.length ? "has-core" : ""}" data-start="${start}" title="${esc(transcript || "跳转回看此时间段")}"><span class="full-video-time">${time(start)}<small>– ${time(end)}</small></span><span class="full-video-content"><b>${esc(status)}</b><span class="full-video-transcript">${esc(excerpt)}</span><small>${esc(voiceText)}</small><small>${esc(visualText)} · 画面变化候选 ${changes} 次</small><small>${esc(pptText)}</small></span></button>`);
  }
  return `<details class="full-video-overview panel"><summary><span><b>全片轻量概览</b><small>转写、声音、可见动作和投影文字按 ${windowSeconds} 秒分段</small></span><strong>${rows.length} 段 · 覆盖全片</strong></summary><p class="full-video-note">重点段继续使用上方详细证据卡；其他时段展示转写摘录和可观察信号。点击任一时间段可回到视频对应位置。动作计数不等同于动作功能或表达效果判断。</p><div class="full-video-list">${rows.join("")}</div></details>`;
}

function selectVideoTime(start) {
  const video = document.querySelector("#case-video");
  if (video) { video.currentTime = Number(start); video.play().catch(() => {}); }
}

const ANNOTATION_KEY = "talkeval_case_review_annotations_v1";
const annotationFields = {
  delivery: { label: "核心内容传达", options: [["clear", "清楚到位"], ["partial", "部分传达"], ["missing", "没有传达"], ["distorted", "意思有偏差"], ["uncertain", "暂不能判断"]] },
  emphasis: { label: "重点强调", options: [["appropriate", "强调到位"], ["weak", "强调偏弱"], ["excessive", "强调过度"], ["mistimed", "强调时机不合适"], ["uncertain", "暂不能判断"]] },
  voice: { label: "语气与节奏", options: [["supportive", "声音变化支持观点"], ["flat", "变化偏少/较平"], ["rushed", "偏快影响理解"], ["slow", "偏慢影响连贯"], ["mismatch", "轻重与重点不合"], ["uncertain", "暂不能判断"]] },
  expression: { label: "表情与观点", options: [["supportive", "支持观点表达"], ["neutral", "表情自然/中性"], ["mismatch", "与表达不一致"], ["unclear", "画面不清楚"]] },
  gesture: { label: "动作功能", options: [["illustrate", "辅助说明"], ["emphasize", "加强重点"], ["transition", "提示转场"], ["neutral", "没有明显作用"], ["distract", "分散注意力"], ["unclear", "画面不清楚"]] },
  ppt_timing: { label: "画面/PPT节奏", options: [["well_timed", "与新观点衔接自然"], ["early", "切换偏早"], ["late", "切换偏晚"], ["during", "观点讲述中途切换"], ["not_applicable", "本段无需切换/没有PPT"], ["unclear", "画面不足以判断"]] },
  ppt_content: { label: "PPT内容与观点", options: [["supports", "页面内容直接支持观点"], ["partial", "部分相关/仅作背景"], ["does_not_support", "无关或与观点冲突"], ["unclear", "图文不足以判断"]] },
};

function readAnnotations() {
  try {
    const value = JSON.parse(localStorage.getItem(ANNOTATION_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function annotationsFor(caseId) { return readAnnotations()[caseId] || {}; }

function updateAnnotation(caseId, beatId, field, value) {
  const all = readAnnotations();
  all[caseId] ||= {};
  all[caseId][beatId] ||= { labels: {}, reviewed_at: null };
  all[caseId][beatId].labels[field] = value;
  all[caseId][beatId].reviewed_at = new Date().toISOString();
  localStorage.setItem(ANNOTATION_KEY, JSON.stringify(all));
}

function annotationCount(caseId, decisions) {
  const saved = annotationsFor(caseId);
  return decisions.filter((decision) => Object.values(saved[decision.beat_id]?.labels || {}).some(Boolean)).length;
}

function annotationForm(caseId, decision) {
  const saved = annotationsFor(caseId)[decision.beat_id] || {};
  const labels = saved.labels || {};
  const selects = Object.entries(annotationFields).map(([field, config]) => {
    const options = config.options.map(([value, label]) => `<option value="${value}" ${labels[field] === value ? "selected" : ""}>${label}</option>`).join("");
    return `<label>${config.label}<select data-annotation-field="${field}" data-case-id="${esc(caseId)}" data-beat-id="${esc(decision.beat_id)}"><option value="">待人工复核</option>${options}</select></label>`;
  }).join("");
  return `<details class="annotation-details"><summary>人工复核 · 训练标注</summary><div class="annotation-form">${selects}<label class="annotation-note">复核备注<textarea rows="2" maxlength="600" data-annotation-field="note" data-case-id="${esc(caseId)}" data-beat-id="${esc(decision.beat_id)}" placeholder="记录这段表达为何清楚、如何强调，或动作起到什么作用">${esc(labels.note || "")}</textarea></label><small>标签由人工填写；机器视觉只描述动作信号，不代替“是否得当、起到什么作用”的判断。</small></div></details>`;
}

function voiceEvidence(data, decision) {
  const allUnits = data.expression_map?.units || [];
  const byId = new Map(allUnits.map((unit) => [unit.observed_id, unit]));
  const units = (decision.matched_observed_ids || []).map((id) => byId.get(id)).filter(Boolean);
  if (!units.length) return `<div class="voice-evidence empty">没有可定位的语音片段</div>`;
  const speech = units.map((unit) => unit.speech || {});
  const numericFeature = (item, key) => typeof item[key] === "number" && Number.isFinite(item[key]) ? item[key] : null;
  const paces = speech.map((item) => numericFeature(item, "pace_per_minute")).filter((value) => value !== null);
  const energies = speech.map((item) => numericFeature(item, "energy_relative")).filter((value) => value !== null);
  const pace = paces.length ? Math.round(paces.reduce((sum, value) => sum + value, 0) / paces.length) : null;
  const pauseBefore = speech[0]?.pause_before;
  const lastUnitIndex = allUnits.findIndex((unit) => unit.observed_id === units[units.length - 1].observed_id);
  const pauseAfter = lastUnitIndex >= 0 ? allUnits[lastUnitIndex + 1]?.speech?.pause_before : null;
  const sortNumbers = (values) => [...values].sort((a, b) => a - b);
  const medianNumber = (values) => {
    const ordered = sortNumbers(values);
    if (!ordered.length) return null;
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };
  const personalPaces = allUnits.filter((unit) => (unit.reliability?.audio || 0) >= .5).map((unit) => numericFeature(unit.speech || {}, "pace_per_minute")).filter((value) => value !== null && value > 0);
  const paceBaseline = medianNumber(personalPaces);
  const paceDelta = pace !== null && paceBaseline ? Math.round((pace / paceBaseline - 1) * 100) : null;
  const paceLabel = paceDelta === null ? "文本字符/分" : paceDelta === 0 ? "文本字符/分 · 接近本场中位数" : `文本字符/分 · 比本场${paceDelta > 0 ? "快" : "慢"} ${Math.abs(paceDelta)}%`;
  const energy = energies.length ? energies.reduce((sum, value) => sum + value, 0) / energies.length : null;
  const energyText = energy === null ? "未提取" : `${energy > 0 ? "+" : ""}${energy.toFixed(2)}σ`;
  const pitches = speech.map((item) => numericFeature(item, "pitch_median_hz")).filter((value) => value !== null);
  const pitchRanges = speech.map((item) => numericFeature(item, "pitch_range_semitones")).filter((value) => value !== null);
  const pitch = pitches.length ? `${Math.round(pitches.reduce((sum, value) => sum + value, 0) / pitches.length)} Hz` : "未提取";
  const pitchRange = pitchRanges.length ? `${(pitchRanges.reduce((sum, value) => sum + value, 0) / pitchRanges.length).toFixed(1)} 半音` : "未提取";
  const voiceJudgment = (decision.delivery_findings || []).find((item) => item.startsWith("语音强调判断："));
  const judgmentText = voiceJudgment ? voiceJudgment.replace(/^语音强调判断：/, "") : "缺少可靠音频特征，暂不判断。";
  return `<div class="voice-evidence"><span><b>${pace === null ? "—" : pace}</b><small>${esc(paceLabel)}</small></span><span><b>${pauseBefore == null ? "—" : `${Number(pauseBefore).toFixed(1)}s`}</b><small>观点前停顿</small></span><span><b>${pauseAfter == null ? "—" : `${Number(pauseAfter).toFixed(1)}s`}</b><small>观点后停顿</small></span><span><b>${energyText}</b><small>响度差异（本场基线）</small></span><span><b>${pitch}</b><small>中位音高</small></span><span><b>${pitchRange}</b><small>音高起伏范围</small></span></div><div class="voice-assessment"><b>声音是否强调这个核心点</b><span>${esc(judgmentText)}</span><small>语音线索按本场个人基线比较；内容是否传达到位看上方语义判定。普通话音高会受字词声调影响，所以只作辅助证据。</small></div>`;
}

const faceFeatureNames = [
  [/mouthSmile/i, "嘴角上扬动作"], [/mouthFrown/i, "嘴角下压动作"],
  [/browInnerUp/i, "内眉上抬动作"], [/browDown/i, "眉部收紧动作"],
  [/jawOpen/i, "下颌张开动作"], [/eyeBlink/i, "眨眼动作"],
  [/eyeWide/i, "睁眼幅度变化"], [/eyeSquint/i, "眯眼动作"],
  [/mouthPress/i, "嘴唇抿紧动作"], [/lipPucker/i, "嘴唇收拢动作"],
];
const poseLabels = { above_shoulder: "肩部以上", torso_level: "躯干附近", below_waist: "腰部以下", clear_motion: "位移较明显", small_motion: "位移较小", not_comparable: "暂不可比较" };

function faceFeatureLabel(name) {
  return faceFeatureNames.find(([pattern]) => pattern.test(name))?.[1] || name;
}

function visualPermissionMessage(data) {
  const permission = data.metadata?.usage_permission;
  const hasPermissionEvidence = Boolean(data.metadata?.permission_verified || String(data.metadata?.permission_evidence || "").trim());
  if (!data.video_url) return "没有可回放视频";
  if (!hasPermissionEvidence) return "素材许可待审核，机器视觉分析未运行";
  if (!data.visual_observations?.observations?.length) {
    if (!(["analysis", "training"].includes(permission))) return "素材许可待审核，机器视觉分析未运行";
    return "已允许分析；尚未生成表情/动作观察";
  }
  return "已提取面部动作与上半身姿态特征";
}

function visualObservationAt(data, seconds) {
  const observations = data.visual_observations?.observations || [];
  if (!observations.length) return null;
  let closest = null;
  for (const item of observations) {
    const distance = Math.abs(Number(item.timestamp) - Number(seconds));
    if (!closest || distance < closest.distance) closest = { item, distance };
  }
  const tolerance = Math.max(1.25, Number(data.visual_observations?.sampling_interval_seconds || 1) * .75);
  return closest && closest.distance <= tolerance ? closest.item : null;
}

function voiceObservationAt(data, seconds) {
  const units = data.expression_map?.units || [];
  if (!units.length) return null;
  let closest = null;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const [start, end] = unit.time_span || [0, 0];
    const distance = seconds < start ? start - seconds : seconds > end ? seconds - end : 0;
    if (!closest || distance < closest.distance) closest = { unit, index, distance };
  }
  return closest && closest.distance <= 1.5 ? closest : null;
}

function currentVoiceEvidence(data, seconds) {
  const match = voiceObservationAt(data, seconds);
  if (!match) return "当前播放时间附近没有语音片段";
  const { unit, index } = match;
  if ((unit.reliability?.audio || 0) < .5) return "当前语音片段音频信号不足，暂不判断";
  const speech = unit.speech || {};
  const units = data.expression_map?.units || [];
  const medianOf = (values) => {
    const ordered = [...values].sort((a, b) => a - b);
    if (!ordered.length) return null;
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };
  const pace = Number.isFinite(speech.pace_per_minute) ? Math.round(speech.pace_per_minute) : null;
  const baseline = medianOf(units.filter((item) => (item.reliability?.audio || 0) >= .5).map((item) => item.speech?.pace_per_minute).filter((value) => Number.isFinite(value) && value > 0));
  const paceDelta = pace !== null && baseline ? Math.round((pace / baseline - 1) * 100) : null;
  const paceComparison = paceDelta === null ? "" : paceDelta > 0 ? `（比本场中位数快 ${paceDelta}%）` : paceDelta < 0 ? `（比本场中位数慢 ${Math.abs(paceDelta)}%）` : "（接近本场中位数）";
  const paceText = pace === null ? "语速未提取" : `语速 ${pace} 字/分${paceComparison}`;
  const energy = Number.isFinite(speech.energy_relative) ? `响度 ${speech.energy_relative > 0 ? "+" : ""}${speech.energy_relative.toFixed(1)}σ` : "响度未提取";
  const pitch = Number.isFinite(speech.pitch_range_semitones) ? `音高起伏 ${speech.pitch_range_semitones.toFixed(1)} 半音` : "音高未提取";
  const pause = index > 0 && Number.isFinite(speech.pause_before) ? `句前停顿 ${speech.pause_before.toFixed(1)} 秒` : "句前停顿无相邻样本";
  return `${paceText} · ${energy} · ${pitch} · ${pause}`;
}

function faceEvidenceText(face) {
  if (!face) return "当前时间点没有近邻视觉样本";
  if (!face.visible) return face.view === "pose_guided_crop" ? "远景局部未检测到清晰人脸" : "画面中未检测到清晰人脸";
  const features = face.visible_features || [];
  const source = face.view === "pose_guided_crop" ? "远景局部放大 · " : "";
  if (!features.length) return `${source}检测到人脸；动作系数未超过展示阈值`;
  return source + features.slice(0, 4).map((item) => `${faceFeatureLabel(item.name)} ${Number(item.score).toFixed(2)}`).join(" · ");
}

function gestureEvidenceText(pose) {
  if (!pose) return "当前画面没有足够清晰的上半身姿态点";
  const hands = pose.hands || {};
  const parts = ["left", "right"].filter((side) => hands[side]?.visible).map((side) => {
    const hand = hands[side];
    const position = poseLabels[hand.position] || "位置不明";
    const movement = poseLabels[hand.movement] || "动作不可比";
    return `${side === "left" ? "左手" : "右手"}：${position}、${movement}`;
  });
  return parts.length ? parts.join("；") : "暂未检测到可见手腕";
}

function slideMatchFor(data, decision) {
  return (data.slide_analysis?.decisions || []).find((item) => item.beat_id === decision.beat_id) || null;
}

function compactSlideMatch(data, decision) {
  const item = slideMatchFor(data, decision);
  if (!item) return null;
  return {
    verdict: item.verdict,
    label: item.label,
    match_score: item.match_score,
    lexical_overlap_score: item.lexical_overlap_score,
    concept_coverage: item.concept_coverage,
    matched_concepts: item.matched_concepts || [],
    best_frame_timestamp: item.best_frame_timestamp,
    best_frame_text: item.best_frame_text || "",
    best_frame_confidence: item.best_frame_confidence,
    review_hint: item.review_hint || "",
  };
}

function pptContentEvidence(data, decision) {
  const result = slideMatchFor(data, decision);
  if (!result) return '<div class="ppt-content-evidence unavailable"><b>PPT内容与观点</b><span>尚无页面文字分析。请先运行 talkeval analyze-slides 生成 OCR 证据。</span></div>';
  const status = result.label || "暂不能判断";
  const score = result.match_score !== null && result.match_score !== undefined && Number.isFinite(Number(result.match_score)) ? ` · 文字线索 ${pct(result.match_score)}` : "";
  const timestamp = result.best_frame_timestamp !== null && result.best_frame_timestamp !== undefined && Number.isFinite(Number(result.best_frame_timestamp))
    ? '<a class="timing-evidence-link" href="#" data-start="' + Number(result.best_frame_timestamp) + '">最佳文字证据 ' + time(result.best_frame_timestamp) + '</a>'
    : "没有可回看的文字帧";
  const text = String(result.best_frame_text || result.extracted_text || "").trim();
  const excerpt = text.length > 260 ? text.slice(0, 260) + "…" : text;
  return '<div class="ppt-content-evidence"><div class="ppt-content-heading"><b>PPT内容与观点</b><strong>' + esc(status + score) + '</strong></div><span class="ppt-content-time">' + timestamp + '</span>' + (excerpt ? '<p>' + esc(excerpt) + '</p>' : '<p>没有提取到可展示的页面文字。</p>') + '<small>' + esc(result.review_hint || "文字重合只作初筛，图表、图片和语境仍需人工核对。") + '</small></div>';
}

function presentationCoordination(data, decision) {
  const span = decision.actual_time_span;
  const voiceFinding = (decision.delivery_findings || []).find((item) => item.startsWith("语音强调判断：")) || "";
  const voice = voiceFinding.replace(/^语音强调判断：/, "").trim() || "缺少可靠声音特征，暂不判断";
  const voiceSupports = /多项声音线索支持强调|有部分声音强调线索/.test(voice);
  const observations = data.visual_observations?.observations || [];
  const interval = Number(data.visual_observations?.sampling_interval_seconds || 2);
  const allUnits = data.expression_map?.units || [];
  const selectedUnits = (decision.matched_observed_ids || []).map((id) => allUnits.find((unit) => unit.observed_id === id)).filter((unit) => unit && (unit.reliability?.audio || 0) >= .5);
  const reliableUnits = allUnits.filter((unit) => (unit.reliability?.audio || 0) >= .5);
  const medianOf = (values) => {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!ordered.length) return null;
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };
  const paceBaseline = medianOf(reliableUnits.map((unit) => unit.speech?.pace_per_minute).filter((value) => value > 0));
  const pitchBaseline = medianOf(reliableUnits.map((unit) => unit.speech?.pitch_range_semitones).filter((value) => value >= 0));
  const localVoiceEmphasisUnits = selectedUnits.filter((unit) => {
    const speech = unit.speech || {};
    return (Number.isFinite(speech.energy_relative) && speech.energy_relative >= .35)
      || (paceBaseline && Number.isFinite(speech.pace_per_minute) && speech.pace_per_minute <= paceBaseline * .9)
      || (pitchBaseline !== null && Number.isFinite(speech.pitch_range_semitones) && speech.pitch_range_semitones >= pitchBaseline + .7);
  });
  let gesture = "没有足够姿态样本，暂不判断动作与观点的时序";
  let movingSamples = 0;
  let poseSamples = 0;
  let synchronizedSamples = 0;
  if (span && observations.length) {
    const nearby = observations.filter((item) => Number(item.timestamp) >= span[0] - interval / 2 && Number(item.timestamp) <= span[1] + interval / 2);
    const poses = nearby.filter((item) => item.pose);
    poseSamples = poses.length;
    movingSamples = poses.filter((item) => ["left", "right"].some((side) => item.pose?.hands?.[side]?.movement === "clear_motion")).length;
    const motionTimes = poses.filter((item) => ["left", "right"].some((side) => item.pose?.hands?.[side]?.movement === "clear_motion")).map((item) => Number(item.timestamp) - interval / 2);
    synchronizedSamples = motionTimes.filter((motionTime) => localVoiceEmphasisUnits.some((unit) => motionTime >= unit.time_span[0] - interval / 2 && motionTime <= unit.time_span[1] + interval / 2)).length;
    if (!poses.length) gesture = "观点时间窗附近没有足够清晰的手腕姿态样本";
    else if (!movingSamples) gesture = "观点时间窗附近 " + poseSamples + " 个姿态样本未检出明显手腕位移（抽样间隔约 " + interval + " 秒）";
    else {
      const firstMotion = poses.find((item) => ["left", "right"].some((side) => item.pose?.hands?.[side]?.movement === "clear_motion"));
      const offset = Number(firstMotion.timestamp) - interval / 2 - span[0];
      const relation = offset < 0 ? "观点开始前 " + Math.abs(offset).toFixed(1) + " 秒附近" : "观点开始后 " + offset.toFixed(1) + " 秒";
      gesture = movingSamples + "/" + poseSamples + " 个姿态样本检测到明显手腕位移，首个动作样本在" + relation;
      gesture += synchronizedSamples ? "；其中 " + synchronizedSamples + " 个样本与局部声音强调线索时间重合" : "；与局部声音强调线索是否同拍尚无证据";
      gesture += "；动作功能仍需人工确认";
    }
  }

  const changeAnalysis = data.visual_observations?.scene_change_analysis;
  let screen = changeAnalysis ? "观点附近没有明显画面变化候选" : "没有画面变化分析结果";
  let sceneEvent = null;
  if (span && changeAnalysis?.candidates?.length) {
    const intervalForChange = Number(changeAnalysis.sampling_interval_seconds || interval);
    const beforeTolerance = Math.max(4, intervalForChange * 2);
    const afterTolerance = Math.max(2, intervalForChange);
    const nearbyChanges = changeAnalysis.candidates.filter((item) => Number(item.timestamp) >= span[0] - beforeTolerance && Number(item.timestamp) <= span[1] + afterTolerance);
    if (nearbyChanges.length) {
      sceneEvent = nearbyChanges.reduce((best, item) => Math.abs(Number(item.timestamp) - span[0]) < Math.abs(Number(best.timestamp) - span[0]) ? item : best);
      const changeTime = Number(sceneEvent.timestamp);
      const offset = changeTime - span[0];
      const timing = offset < 0 ? "观点开始前 " + Math.abs(offset).toFixed(1) + " 秒" : changeTime <= span[1] ? "观点讲述开始后 " + offset.toFixed(1) + " 秒" : "观点结束后 " + Math.max(0, changeTime - span[1]).toFixed(1) + " 秒";
      const startRelation = Math.abs(offset) <= Math.max(2, intervalForChange) ? "接近观点开头" : timing;
      screen = time(changeTime) + " 检测到画面变化候选，" + startRelation + "；回看确认是否为 PPT 切换";
    }
  }
  const semantic = ({ sufficiently_realized: "机器判断核心语义完整", partially_realized: "机器判断核心语义部分覆盖", omitted: "未定位到足够的核心语义证据", evidence_insufficient: "核心语义证据不足" })[decision.verdict] || "核心语义待复核";
  const alignedCues = [];
  if (voiceSupports && synchronizedSamples) alignedCues.push("声音强调线索与手势时序重合");
  else if (voiceSupports) alignedCues.push("声音有强调线索，动作未确认与其同拍");
  else if (movingSamples) alignedCues.push("观点时段出现手势，声音强调线索较弱或不足");
  if (sceneEvent && Math.abs(Number(sceneEvent.timestamp) - (span?.[0] || 0)) <= Math.max(2, Number(changeAnalysis?.sampling_interval_seconds || interval))) alignedCues.push("画面变化靠近观点开头");
  const summary = alignedCues.length ? "协同观察：" + alignedCues.join("；") + "。是否真正帮助听众理解，仍需结合画面、语义和人工标注确认。" : "协同观察：目前没有足够的跨模态同步线索；回看后再判断动作和画面是否需要调整。";
  const slide = slideMatchFor(data, decision);
  const pptText = slide ? `${slide.label || "页面文字待复核"}${slide.match_score !== null && slide.match_score !== undefined && Number.isFinite(Number(slide.match_score)) ? `（文字线索 ${pct(slide.match_score)}）` : ""}` : "尚未生成页面文字 OCR";
  return { semantic, voice, voiceSupports, gesture, movingSamples, poseSamples, screen, sceneEvent, pptText, summary };
}

function coordinationEvidence(data, decision) {
  const result = presentationCoordination(data, decision);
  const interval = data.visual_observations?.scene_change_analysis?.sampling_interval_seconds || "2";
  const screen = result.sceneEvent
    ? '<a class="timing-evidence-link" href="#" data-start="' + Number(result.sceneEvent.timestamp) + '">' + time(result.sceneEvent.timestamp) + '</a>' + esc(result.screen.slice(time(result.sceneEvent.timestamp).length))
    : esc(result.screen);
  return '<section class="coordination-evidence"><div class="coordination-heading"><b>重点句的多模态配合</b><span>按同一时间窗对齐</span></div><div class="coordination-grid"><div><b>内容</b><span>' + esc(result.semantic) + '</span></div><div><b>声音</b><span>' + esc(result.voice) + '</span></div><div><b>动作时机</b><span>' + esc(result.gesture) + '</span></div><div><b>画面/PPT时机</b><span>' + screen + '</span></div><div class="coordination-ppt"><b>PPT文字线索</b><span>' + esc(result.pptText) + '</span></div></div>' + pptContentEvidence(data, decision) + '<p>' + esc(result.summary) + '</p><small>画面变化候选来自约 ' + esc(String(interval)) + ' 秒间隔；OCR 结合词句重合和少量显式同义词做初筛，不会仅凭文字断言图表含义或页面是否真正支撑观点。</small></section>';
}

function visualBeatEvidence(data, decision) {
  const span = decision.actual_time_span;
  const observations = data.visual_observations?.observations || [];
  if (!observations.length) return `<div class="visual-beat unavailable">${esc(visualPermissionMessage(data))}</div>`;
  if (!span) return `<div class="visual-beat unavailable">该观点没有定位时间，无法汇总视觉证据</div>`;
  const relevant = observations.filter((item) => Number(item.timestamp) >= span[0] - .5 && Number(item.timestamp) <= span[1] + .5);
  if (!relevant.length) return `<div class="visual-beat unavailable">该观点时间范围内没有视觉样本</div>`;
  const visibleFaces = relevant.filter((item) => item.face?.visible).length;
  const cropFaces = relevant.filter((item) => item.face?.visible && item.face?.view === "pose_guided_crop").length;
  const faceNames = new Map();
  relevant.forEach((item) => (item.face?.visible_features || []).forEach((feature) => {
    const name = faceFeatureLabel(feature.name);
    faceNames.set(name, (faceNames.get(name) || 0) + 1);
  }));
  const faceSummary = [...faceNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${name}（${count}个样本）`).join("、") || (visibleFaces ? "面部动作系数未超过展示阈值" : "该片段未检测到清晰人脸");
  const faceText = `${faceSummary}${cropFaces ? `；${cropFaces} 个样本经姿态定位后局部放大识别` : ""}`;
  return `<div class="visual-beat"><span><b>表情可见动作</b>${esc(faceText)}</span><small>只描述可见动作系数，不据此推断情绪或表达是否得当。</small></div>`;
}

function updateLiveVisualEvidence(data, seconds) {
  const faceNode = document.querySelector("#case-visual-face");
  const gestureNode = document.querySelector("#case-visual-gesture");
  const voiceNode = document.querySelector("#case-voice-now");
  if (voiceNode) voiceNode.textContent = currentVoiceEvidence(data, seconds);
  if (!faceNode || !gestureNode) return;
  const observation = visualObservationAt(data, seconds);
  faceNode.textContent = observation ? faceEvidenceText(observation.face) : visualPermissionMessage(data);
  gestureNode.textContent = observation ? gestureEvidenceText(observation.pose) : visualPermissionMessage(data);
}

function coachingHint(decision, beat) {
  if (!decision && !beat) return "当前时段没有对应的核心重点；可结合转写检查是否还需补充观点。";
  const target = beat?.target_meaning || "这项核心观点";
  if (!decision) return `接下来进入“${target}”。建议先用一句话说清结论，再补充解释或例子。`;
  if (decision.verdict === "sufficiently_realized") return `已定位到“${target}”。回看时核对停顿、音高起伏和手势是否帮助观众抓住重点。`;
  if (decision.verdict === "partially_realized") return `“${target}”只有部分传达；建议补足关键说明，并在观点前后留出停顿再强调。`;
  if (decision.verdict === "omitted") return `建议下次明确补讲“${target}”，并在转入下一段前用一句话重申。`;
  return `“${target}”的证据不足；建议检查转写和画面，再决定是否需要补充强调。`;
}

function exportCaseAnnotations(data) {
  const decisions = data.alignment?.decisions || [];
  const saved = annotationsFor(data.case_id);
  const beats = new Map((data.intent_map?.beats || []).map((beat) => [beat.beat_id, beat]));
  const units = new Map((data.expression_map?.units || []).map((unit) => [unit.observed_id, unit]));
  const records = decisions.flatMap((decision) => {
    const annotation = saved[decision.beat_id];
    if (!annotation || !Object.values(annotation.labels || {}).some(Boolean)) return [];
    const beat = beats.get(decision.beat_id) || {};
    const labels = annotation.labels || {};
    return [{
      schema_version: "talkeval_case_annotation_v1",
      case_id: data.case_id,
      case_title: data.intent_map?.title || data.metadata?.topic || data.case_id,
      language: data.metadata?.language || data.expression_map?.language || null,
      source: { script_type: data.metadata?.script_type || null, usage_permission: data.metadata?.usage_permission || "to_review", permission_evidence: data.metadata?.permission_evidence || null, training_eligible: data.metadata?.usage_permission === "training" && Boolean(data.metadata?.permission_verified || String(data.metadata?.permission_evidence || "").trim()), video_file: data.metadata?.video_file || null },
      beat: { beat_id: decision.beat_id, target_meaning: beat.target_meaning || null, required_claims: beat.required_claims || [] },
      evidence: { time_span: decision.actual_time_span || null, observed_ids: decision.evidence_ids || decision.matched_observed_ids || [], transcript: (decision.evidence_ids || []).map((id) => units.get(id)?.text).filter(Boolean).join(" ") },
      model_output: { verdict: decision.verdict, semantic_similarity: decision.semantic_similarity, claim_coverage: decision.claim_coverage, confidence: decision.confidence, delivery_findings: decision.delivery_findings || [], presentation_coordination: presentationCoordination(data, decision), ppt_content_match: compactSlideMatch(data, decision) },
      human_annotation: { labels, review_complete: Object.keys(annotationFields).every((field) => Boolean(labels[field])), reviewed_at: annotation.reviewed_at },
    }];
  });
  if (!records.length) {
    document.querySelector("#annotation-status").textContent = "先在观点卡片中填写人工复核";
    return;
  }
  const blob = new Blob([records.map((record) => JSON.stringify(record)).join("\n") + "\n"], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${data.case_id}-annotations.jsonl`;
  link.click();
  URL.revokeObjectURL(url);
  document.querySelector("#annotation-status").textContent = `已导出 ${records.length} 条人工复核`;
}

function renderDetail(data) {
  const metadata = data.metadata || {};
  const decisions = data.alignment?.decisions || [];
  const title = data.intent_map?.title || metadata.topic || data.case_id;
  const subtitle = `${metadata.speaker_id || "未登记演讲者"} · ${metadata.topic || "主题待补充"}`;
  const verdictCounts = decisions.reduce((counts, decision) => {
    counts[decision.verdict] = (counts[decision.verdict] || 0) + 1;
    return counts;
  }, {});
  const reviewed = annotationCount(data.case_id, decisions);
  const located = (verdictCounts.sufficiently_realized || 0) + (verdictCounts.partially_realized || 0);
  const permissionVerified = Boolean(metadata.permission_verified || String(metadata.permission_evidence || "").trim());
  const provisional = data.review_status === "provisional" || data.intent_map?.review_status === "provisional";
  const permissionLabel = !permissionVerified ? "素材许可：待审核" : metadata.usage_permission === "training" ? "训练许可：已登记" : metadata.usage_permission === "analysis" ? "分析许可：已登记" : "素材许可：待审核";
  const detailSummary = `<div class="detail-summary"><div><strong>${located}/${decisions.length}</strong><span>定位到表达</span></div><div><strong>${verdictCounts.sufficiently_realized || 0}</strong><span>机器判为完整</span></div><div><strong>${reviewed}/${decisions.length}</strong><span>已有人工标注</span></div></div>`;
  const badges = [
    `<span class="badge badge-neutral">${esc(sourceReviewLabel(metadata.script_source, metadata.script_type))}</span>`,
    `<span class="badge badge-neutral">ASR：${esc(data.run_metadata?.asr_backend || "未知")}</span>`,
    `<span class="badge badge-neutral">语义：${esc(data.run_metadata?.semantic_backend || "未知")}</span>`,
    `<span class="badge badge-neutral">${permissionLabel}</span>`,
    provisional ? `<span class="badge badge-neutral">${esc(sourceReviewDetail(metadata))}</span>` : "",
  ].join("");
  const video = data.video_url ? `<video id="case-video" class="video-frame" controls preload="metadata" src="${esc(data.video_url)}"></video>` : `<div class="video-placeholder">未找到视频文件，仅显示分析证据</div>`;
  const cards = decisions.map((decision, index) => {
    const beat = (data.intent_map?.beats || []).find((item) => item.beat_id === decision.beat_id) || {};
    const active = state.selectedBeat?.beat_id === decision.beat_id;
    const span = decision.actual_time_span;
    const evidence = (decision.evidence_ids || []).map((id) => (data.expression_map?.units || []).find((unit) => unit.observed_id === id)).filter(Boolean);
    const evidenceText = evidence.map((item) => item.text).join(" ") || "未找到可引用的实际转写";
    return `<article class="decision-card ${active ? "active" : ""}" data-beat-index="${index}" data-beat-id="${esc(decision.beat_id)}">
      <div class="decision-heading"><div class="decision-title"><span class="beat-id">${esc(decision.beat_id)}</span><h3>${esc(beat.target_meaning || "目标观点")}</h3></div><span class="badge badge-${verdictClass(decision.verdict)}">${esc(verdictText[decision.verdict] || decision.verdict)}</span></div>
      <div class="decision-reason">${esc(decision.reason || "暂无判定理由")}</div>
      <div class="metrics">${metric("语义相似度", decision.semantic_similarity)}${metric("必要命题覆盖", decision.claim_coverage)}${metric("置信度", decision.confidence)}</div>
      <div class="evidence-box"><div class="evidence-heading"><span>转写证据</span><span class="decision-time" data-start="${span ? span[0] : ""}">${span ? `${time(span[0])} – ${time(span[1])}` : "未定位"}</span></div><p class="evidence-text">${esc(evidenceText)}</p></div>
      ${coordinationEvidence(data, decision)}
      ${voiceEvidence(data, decision)}
      ${visualBeatEvidence(data, decision)}
      ${annotationForm(data.case_id, decision)}
    </article>`;
  }).join("");
  document.querySelector("#detail-column").innerHTML = `
    <section class="detail-header panel" id="detail-header"><div class="detail-title-row"><div><p class="eyebrow">SELECTED SPEECH</p><h2>${esc(title)}</h2><p class="detail-subtitle">${esc(subtitle)}</p></div>${detailSummary}</div><div class="detail-toolbar"><div class="detail-badges">${badges}</div><div class="detail-actions"><span id="annotation-status">已有人工标注 ${reviewed}/${decisions.length}</span><button class="outline-button" id="export-annotations" type="button">导出标注 .jsonl</button><a class="report-link" href="${esc(data.report_url || "#")}" target="_blank" rel="noreferrer">打开分析报告 ↗</a></div></div></section>
    <div class="case-review-grid">
      <section class="case-video-column"><section class="video-panel panel"><div class="video-heading"><div><p class="eyebrow">REFERENCE VIDEO</p><h3>演讲视频</h3></div><p>拖动播放，右侧重点同步定位</p></div>${video}<div class="playback-progress"><div><span id="case-current-time">00:00</span><span id="case-duration">${time(data.expression_map?.duration)}</span></div><i><em id="case-progress-fill"></em></i></div></section>
        <section class="signal-summary panel"><div class="signal-summary-heading"><p class="eyebrow">同步分析</p><strong>当前画面与表达信号</strong></div><div class="playback-signal-grid"><div><b>当前播放段语音</b><span id="case-voice-now">等待定位</span></div><div><b>表情可观察特征</b><span id="case-visual-face">等待定位</span></div><div><b>动作与手势</b><span id="case-visual-gesture">等待定位</span></div></div><div class="evidence-dimensions"><div><b>内容</b><span>重点进度、语义匹配、必要命题覆盖</span></div><div><b>语音</b><span>语速、停顿、响度与音高起伏</span></div><div class="${data.visual_observations?.observations?.length ? "" : "unavailable"}"><b>视觉模型</b><span>${esc(visualPermissionMessage(data))}</span></div></div><p>声音强调与语义覆盖分开呈现；表情和姿态只描述可见动作。最终表达是否有效仍需结合原视频和观点人工复核。</p></section>
        ${fullVideoOverview(data)}
      </section>
      <section class="case-analysis-column"><section class="playback-focus panel"><div class="focus-top"><span class="live-led"></span><span id="case-play-state">回放准备就绪</span><span id="case-point-progress">重点 — / ${decisions.length}</span><span id="case-play-time">00:00</span></div><p class="eyebrow">当前重点与演讲进度</p><h3 id="case-current-title">选择一个观点开始回看</h3><p id="case-current-copy">播放视频后，这里会同步显示当前或下一项核心观点及其离线判定。</p><div class="focus-footer"><span id="case-current-verdict">等待播放</span><span id="case-current-coverage">—</span></div><div class="coaching-hint"><b>表达复盘提示</b><span id="case-current-hint">播放或选择观点后显示建议</span></div></section>
        <section class="decisions-panel panel"><div class="panel-heading"><div><p class="eyebrow">CORE POINT REVIEW</p><h3>重点是否传达到位</h3></div><span class="case-count">${decisions.length} 个观点</span></div><p class="review-hint">点击观点卡或时间戳可跳到视频证据；机器判定是初筛，人工标注用于后续训练。${provisional ? "本案例的重点由系统根据讲稿、字幕或转写自动提取，尚未人工确认，结果仅供回放参考。" : ""}${metadata.can_evaluate_original_intent === false ? "本案例使用演讲后转写稿生成代理重点，只能核对这些代理重点，不代表演讲者原始意图。" : ""}</p><div class="decision-list">${cards || `<div class="loading-card">没有判定结果</div>`}</div></section>
      </section>
    </div>
    <section class="timeline-panel panel"><div class="timeline-header"><div><p class="eyebrow">SPEECH TIMELINE</p><h3>表达与重点时间轴</h3><p>深色片段为已定位的转写内容；点击片段可跳转回看。</p></div><span class="timeline-duration">时长 ${time(data.expression_map?.duration)}</span></div>${renderTimeline(data)}</section>
    <details class="raw-panel panel"><summary>查看原始 JSON（调试用）</summary><pre>${esc(JSON.stringify(data.alignment, null, 2))}</pre></details>`;
  document.querySelectorAll(".decision-card").forEach((card) => card.addEventListener("click", (event) => {
    if (event.target.closest(".annotation-details")) return;
    const decision = decisions[Number(card.dataset.beatIndex)];
    state.selectedBeat = decision;
    if (decision.actual_time_span) {
      selectVideoTime(decision.actual_time_span[0]);
      updateCasePlayback(data, decision.actual_time_span[0]);
    }
    document.querySelectorAll(".decision-card").forEach((item) => item.classList.toggle("active", item === card));
  }));
  document.querySelectorAll("[data-start]").forEach((node) => node.addEventListener("click", (event) => {
    event.stopPropagation();
    if (node.dataset.start) selectVideoTime(node.dataset.start);
  }));
  document.querySelectorAll("[data-annotation-field]").forEach((field) => field.addEventListener(field.tagName === "TEXTAREA" ? "input" : "change", () => {
    updateAnnotation(field.dataset.caseId, field.dataset.beatId, field.dataset.annotationField, field.value.trim());
    const count = annotationCount(data.case_id, decisions);
    document.querySelector("#annotation-status").textContent = `已有人工标注 ${count}/${decisions.length}`;
    document.querySelector("#detail-header .detail-summary div:last-child strong").textContent = `${count}/${decisions.length}`;
  }));
  document.querySelector("#export-annotations").addEventListener("click", () => exportCaseAnnotations(data));
  const caseVideo = document.querySelector("#case-video");
  if (caseVideo) {
    caseVideo.addEventListener("loadedmetadata", () => {
      document.querySelector("#case-duration").textContent = time(caseVideo.duration);
      updateCasePlayback(data, caseVideo.currentTime);
    });
    caseVideo.addEventListener("timeupdate", () => updateCasePlayback(data, caseVideo.currentTime));
    updateCasePlayback(data, caseVideo.currentTime || 0);
  } else {
    updateCasePlayback(data, 0);
  }
}

function updateCasePlayback(data, seconds) {
  const duration = Number(document.querySelector("#case-video")?.duration || caseDuration(data));
  const current = Math.max(0, Number(seconds || 0));
  const progress = duration ? Math.min(100, current / duration * 100) : 0;
  const decisions = data.alignment?.decisions || [];
  const currentDecision = decisions.find((decision) => decision.actual_time_span && current >= decision.actual_time_span[0] && current <= decision.actual_time_span[1]);
  const nextDecision = decisions.find((decision) => decision.actual_time_span && decision.actual_time_span[0] > current);
  const atEnd = duration > 0 && current >= duration - 1;
  const focus = currentDecision || nextDecision;
  const beat = focus && (data.intent_map?.beats || []).find((item) => item.beat_id === focus.beat_id);
  const focusIndex = focus ? decisions.indexOf(focus) + 1 : 0;
  const pointProgress = document.querySelector("#case-point-progress");
  if (pointProgress) pointProgress.textContent = atEnd ? `回放结束 · ${decisions.length} 项重点` : focus ? `重点 ${focusIndex} / ${decisions.length}` : `重点 — / ${decisions.length}`;
  const title = document.querySelector("#case-current-title");
  if (!title) return;
  if (currentDecision) {
    title.textContent = `${currentDecision.beat_id} · ${beat?.target_meaning || "核心观点"}`;
    document.querySelector("#case-current-copy").textContent = currentDecision.reason || "已到达观点对应证据片段。";
    document.querySelector("#case-current-verdict").textContent = verdictText[currentDecision.verdict] || currentDecision.verdict;
    document.querySelector("#case-current-coverage").textContent = `命题覆盖 ${pct(currentDecision.claim_coverage)}`;
    document.querySelector("#case-play-state").textContent = "正在播放观点证据";
  } else if (nextDecision) {
    title.textContent = `下一重点 · ${beat?.target_meaning || "核心观点"}`;
    document.querySelector("#case-current-copy").textContent = `约 ${time(nextDecision.actual_time_span[0])} 进入该观点；当前时间点还没有匹配到核心观点证据。`;
    document.querySelector("#case-current-verdict").textContent = "尚未到达证据片段";
    document.querySelector("#case-current-coverage").textContent = `语义匹配 ${pct(nextDecision.semantic_similarity)}`;
    document.querySelector("#case-play-state").textContent = current > 0 ? "正在回看" : "回放准备就绪";
  } else {
    title.textContent = atEnd ? "已到达演讲结尾" : current > 0 ? "当前片段没有核心观点匹配" : "选择一个观点开始回看";
    document.querySelector("#case-current-copy").textContent = atEnd ? "已到达视频末尾；可以回看上方重点片段，或在时间轴抽查其他转写。" : current > 0 ? "这段暂未与已确认核心观点对齐；继续播放可查看下一处重点证据。" : "播放视频后，这里会同步显示当前或下一项核心观点及其离线判定。";
    document.querySelector("#case-current-verdict").textContent = atEnd ? "演讲结束" : current > 0 ? "暂无匹配片段" : "等待播放";
    document.querySelector("#case-current-coverage").textContent = `${decisions.length} 个核心观点`;
    document.querySelector("#case-play-state").textContent = atEnd ? "演讲收束阶段" : current > 0 ? "普通表达片段" : "回放准备就绪";
  }
  const currentTime = document.querySelector("#case-current-time");
  if (currentTime) currentTime.textContent = time(current);
  const playTime = document.querySelector("#case-play-time");
  if (playTime) playTime.textContent = time(current);
  const progressFill = document.querySelector("#case-progress-fill");
  if (progressFill) progressFill.style.width = `${progress}%`;
  const hint = document.querySelector("#case-current-hint");
  if (hint) {
    if (atEnd) {
      const complete = decisions.filter((item) => item.verdict === "sufficiently_realized").length;
      const partial = decisions.filter((item) => item.verdict === "partially_realized").length;
      const omitted = decisions.filter((item) => item.verdict === "omitted").length;
      hint.textContent = `本场重点复盘：完整表达 ${complete} 项、部分表达 ${partial} 项、疑似遗漏 ${omitted} 项；逐条回看证据核对。`;
    } else {
      hint.textContent = coachingHint(focus, beat);
    }
  }
  updateLiveVisualEvidence(data, current);
  document.querySelectorAll(".decision-card").forEach((card) => card.classList.toggle("active", currentDecision ? card.dataset.beatId === currentDecision.beat_id : false));
  const activeIds = new Set(currentDecision?.matched_observed_ids || []);
  document.querySelectorAll(".timeline-unit").forEach((unit) => unit.classList.toggle("selected", activeIds.has(unit.dataset.observedId)));
}

async function selectCase(caseId) {
  state.selectedCase = caseId;
  state.selectedBeat = null;
  renderCaseList();
  document.querySelector("#detail-column").innerHTML = `<div class="loading-card panel">正在读取案例证据…</div>`;
  try {
    const data = await getJson(`./data/cases/${encodeURIComponent(caseId)}.json`);
    renderDetail(data);
    document.querySelector("#connection-status").textContent = "分析结果已连接";
  } catch (error) {
    document.querySelector("#detail-column").innerHTML = `<div class="error-state">无法读取案例：${esc(error.message)}</div>`;
  }
}

async function loadCases() {
  try {
    const data = await getJson("./data/cases.json");
    state.cases = data.cases || [];
    renderCaseList();
    document.querySelector("#connection-status").textContent = `已连接 · ${state.cases.length} 个案例`;
    if (!state.selectedCase && state.cases.length) selectCase(state.cases[0].case_id);
  } catch (error) {
    document.querySelector("#connection-status").textContent = "读取失败";
    document.querySelector("#case-list").innerHTML = `<div class="error-state">${esc(error.message)}<br>请确认公开案例数据已经发布。</div>`;
  }
}

document.querySelector("#refresh-button").addEventListener("click", loadCases);
loadCases();

})();
