/* Shared, deterministic context-fit baseline. All verdicts are review candidates. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TalkEvalFit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "context-rules-2026.10.15-v2";
  const LABELS = { supportive: "可能支持表达", neutral: "基本协调 · 候选", partial: "局部片段可评", conflict: "可能冲突 · 请复核", insufficient: "暂不能评价" };
  const GOALS = { auto: "随内容观察", warm: "友好欢迎", explain: "平稳说明", emphasize: "突出重点", solemn: "严肃克制" };
  const CONFIG = Object.freeze({ minSamples: 3, minCoverage: .6, smile: .5, minSmileSeconds: 1.2, maxTimingUncertainty: 2, motionSpeed: .65 });
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = value => Math.max(0, Math.min(1, value));
  const round = value => Math.round(value * 1000) / 1000;
  const median = values => { const a = values.filter(finite).sort((a, b) => a - b); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stamp = seconds => finite(seconds) ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "未定位";
  function tokens(text) {
    const s = String(text || "").toLowerCase();
    const words = s.match(/[a-z0-9]{2,}/g) || [];
    // Do not create bigrams across punctuation or word boundaries.
    for (const run of s.match(/[\u3400-\u9fff]+/g) || []) for (let i = 0; i < run.length - 1; i++) words.push(run.slice(i, i + 2));
    return new Set(words);
  }
  function overlap(target, spoken) {
    const a = tokens(target), b = tokens(spoken);
    let hits = 0; a.forEach(word => { if (b.has(word)) hits++; });
    return a.size ? hits / a.size : 0;
  }
  function matchPoint(points, text) {
    const candidates = points.map(point => ({ id: point.id || point.beat_id, text: point.text || point.target_meaning, score: overlap(point.text || point.target_meaning, text) })).sort((a, b) => b.score - a.score);
    const top = candidates[0], second = candidates[1];
    const reliable = Boolean(top && top.score >= .18 && (!second || top.score - second.score >= .06));
    return { pointId: reliable ? top.id : null, pointText: reliable ? top.text : "", lexicalScore: top ? round(top.score) : 0, reliable, method: "lexical_candidate_with_margin" };
  }
  function context(text, goal) {
    const explicit = goal && goal !== "auto" && Boolean(GOALS[goal]);
    const ambiguous = /[“”「」]|不是|并非|不必|不要|不需要|not\b|don't\b/i.test(text);
    const rules = [
      ["warm", "欢迎 / 感谢", /谢谢|感谢|欢迎|大家好|很高兴|\bthank(?:s| you)\b|\bwelcome\b/i],
      ["contrast", "比较与转折", /相比|相反|但是|然而|而是|与其|一方面|另一方面|\bhowever\b|\binstead\b/i],
      ["cause", "解释原因", /因为|所以|因此|导致|原因|意味着|\bbecause\b|\btherefore\b/i],
      ["enumerate", "分点 / 数量说明", /首先|其次|第一|第二|第三|分别|百分之|\d+(?:%|个|万|年)|\bfirst\b|\bsecond\b/i],
      ["question", "提出问题", /为什么|怎么|如何|是不是|吗[？?]?|[？?]|\bwhy\b|\bhow\b/i],
      ["example", "举例说明", /比如|例如|举个例|\bfor example\b/i],
      ["emphasize", "强调结论", /关键|重点|最重要|必须|强调|结论|核心|\bimportant\b|\bkey point\b/i],
    ];
    const hit = rules.find(([kind, , pattern]) => !(ambiguous && ["warm", "emphasize"].includes(kind)) && pattern.test(text));
    const kind = hit?.[0] || "explain", cue = hit ? text.match(hit[2])?.[0] : "";
    return { goal: explicit ? goal : kind === "warm" ? "warm" : kind === "emphasize" ? "emphasize" : "explain",
      kind, roleLabel: explicit ? GOALS[goal] : hit?.[1] || "陈述 / 说明", cue,
      source: explicit ? "演讲者设置" : cue ? `转写线索「${cue}」` : "依据当前转写", explicit, ambiguous };
  }
  function normaliseObservation(raw) {
    const face = raw.face && typeof raw.face === "object" ? raw.face : {};
    const full = face.blendshape_scores || null;
    const partial = face.visible_features || [];
    function coefficient(name) {
      if (full && finite(full[name])) return full[name];
      const entry = partial.find(item => item.name === name);
      return entry && finite(entry.score) ? entry.score : null;
    }
    const leftSmile = coefficient("mouthSmileLeft"), rightSmile = coefficient("mouthSmileRight");
    const smile = finite(leftSmile) && finite(rightSmile) ? (leftSmile + rightSmile) / 2 : null;
    const hands = Object.entries(raw.pose?.hands || {}).filter(([, hand]) => hand?.visible).map(([side, hand]) => ({ ...hand, side }));
    const comparable = hands.filter(hand => ["clear_motion", "small_motion"].includes(hand.movement));
    return { at: raw.timestamp, faceVisible: face.visible === true && face.subject_association !== "unconfirmed", smile,
      brow: [coefficient("browInnerUp"), coefficient("browOuterUpLeft"), coefficient("browOuterUpRight")].filter(finite).reduce((best, score) => Math.max(best, score), 0),
      jaw: coefficient("jawOpen"), faceHeight: face.source_face_height_pixels ?? null, hands,
      handVisible: hands.length > 0, comparable: comparable.length > 0,
      moving: comparable.some(hand => hand.movement === "clear_motion"),
      motion: Math.max(0, ...comparable.map(hand => finite(hand.speed_body_per_second) ? hand.speed_body_per_second : finite(hand.displacement_normalized) ? hand.displacement_normalized : 0)),
      source: raw };
  }
  function motionDetails(sample) {
    const motions = sample.hands.filter(hand => hand.movement === "clear_motion").map(hand => ({ side: hand.side, direction: hand.motion_direction || null }));
    return { motions, sides: motions.map(hand => hand.side), direction: motions.length && motions.every(hand => hand.direction === motions[0].direction) ? motions[0].direction : null };
  }
  function events(samples, interval, predicate, kind) {
    const result = [];
    let current = null;
    for (const sample of samples) {
      if (!predicate(sample)) { current = null; continue; }
      if (!current || sample.at - current.end > interval * 1.8) {
        current = { id: `${kind}-${round(sample.at)}`, kind, start: sample.at, end: sample.at, peak: sample.at, count: 1, magnitude: kind === "smile" ? sample.smile : sample.motion, ...motionDetails(sample) };
        result.push(current);
      } else {
        current.end = sample.at; current.count++;
        const magnitude = kind === "smile" ? sample.smile : sample.motion;
        if (magnitude > current.magnitude) { current.magnitude = magnitude; current.peak = sample.at; Object.assign(current, motionDetails(sample)); }
      }
    }
    return result.map(item => ({ ...item, duration: round(item.end - item.start), magnitude: round(item.magnitude) }));
  }
  function resultPart(status, reason, suggestion, evidence = [], observation = "") { return { status, label: LABELS[status], reason, suggestion, evidence, observation }; }
  function analyze(input = {}) {
    const span = input.timeSpan;
    const validSpan = Array.isArray(span) && finite(span[0]) && finite(span[1]) && span[0] >= 0 && span[1] > span[0];
    const window = validSpan ? span : [0, 0];
    const original = (input.observations || []).filter(item => finite(item.timestamp) && item.timestamp >= window[0] && item.timestamp <= window[1]);
    const samples = original.map(normaliseObservation).sort((a, b) => a.at - b.at);
    const gaps = samples.slice(1).map((item, i) => item.at - samples[i].at).filter(x => x > 0);
    const interval = median(gaps) || (finite(input.samplingInterval) && input.samplingInterval > 0 ? input.samplingInterval : 1);
    const cuts = (input.sceneChanges || []).filter(finite);
    samples.forEach(sample => { if (cuts.some(at => Math.abs(at - sample.at) <= interval)) { sample.comparable = false; sample.moving = false; sample.cut = true; } });
    // Measure covered time, so clustered samples do not hide a long blind interval.
    const support = Math.min(interval, finite(input.samplingInterval) && input.samplingInterval > 0 ? input.samplingInterval : interval);
    function timeCoverage(items) {
      let covered = 0, end = window[0];
      for (const item of items) {
        const left = Math.max(window[0], item.at - support / 2), right = Math.min(window[1], item.at + support / 2);
        covered += Math.max(0, right - Math.max(left, end)); end = Math.max(end, right);
      }
      return validSpan ? clamp(covered / (window[1] - window[0])) : 0;
    }
    const coverage = timeCoverage(samples);
    const faceSamples = samples.filter(sample => sample.faceVisible);
    const handSamples = samples.filter(sample => sample.comparable);
    const faceCoverage = timeCoverage(faceSamples), handCoverage = timeCoverage(handSamples);
    const ctx = context(String(input.text || ""), input.goal);
    const timingOK = validSpan && input.timingQuality !== "manual" && input.timingQuality !== "unknown" && finite(input.timeUncertainty) && input.timeUncertainty <= CONFIG.maxTimingUncertainty;
    const textOK = String(input.text || "").trim().length >= 3 && input.textReliable !== false;
    const linked = input.pointReliable !== false;
    const sharedOK = timingOK && textOK && coverage >= CONFIG.minCoverage;
    const handOK = sharedOK && handSamples.length >= CONFIG.minSamples && handCoverage >= CONFIG.minCoverage;
    const smileSamples = faceSamples.filter(sample => finite(sample.smile));
    const needsSmile = ctx.goal === "warm" || ctx.goal === "solemn";
    const faceOK = sharedOK && faceSamples.length >= CONFIG.minSamples && faceCoverage >= CONFIG.minCoverage && (!needsSmile || (smileSamples.length >= CONFIG.minSamples && timeCoverage(smileSamples) >= CONFIG.minCoverage));
    const motionEvents = events(samples, interval, sample => sample.comparable && sample.moving, "motion").filter(event => interval >= .75 || event.count >= 2);
    const smileEvents = events(samples, interval, sample => sample.faceVisible && finite(sample.smile) && sample.smile >= CONFIG.smile, "smile");
    const sustainedSmile = smileEvents.filter(event => event.count >= CONFIG.minSamples && event.duration >= CONFIG.minSmileSeconds);
    const voiceWindows = (input.voiceWindows || []).filter(item => item.reliable && item.emphasis && item.span?.length === 2 && item.span.every(finite) && item.span[1] > item.span[0] && item.span[0] <= window[1] && item.span[1] >= window[0]);
    const joined = motionEvents.filter(event => voiceWindows.some(voice => event.peak >= voice.span[0] && event.peak <= voice.span[1]));
    const qualityReasons = [];
    if (!validSpan) qualityReasons.push("没有定位到对应视频时间段");
    if (!textOK) qualityReasons.push("缺少可靠的当前语句");
    if (!linked) qualityReasons.push("观点归属未确认；本次仅依据当前语句评价");
    if (!timingOK && validSpan) qualityReasons.push(input.timingQuality === "manual" ? "手动补录没有可靠的发声时间" : "语句时间范围不够可靠");
    if (coverage < CONFIG.minCoverage) qualityReasons.push("时间窗内视觉抽样缺失较多");
    const sharedReason = qualityReasons.filter(reason => !reason.startsWith("观点归属")).join("；");
    const excerpt = String(input.text || "").trim().slice(0, 26);
    const role = ctx.roleLabel;
    const movingShare = handSamples.length ? handSamples.filter(sample => sample.moving).length / handSamples.length : 0;
    const positionNames = { torso_level: "躯干高度", above_shoulder: "肩部以上", below_waist: "腰部以下" };
    const positions = {};
    handSamples.flatMap(sample => sample.hands).forEach(hand => { if (positionNames[hand.position]) positions[hand.position] = (positions[hand.position] || 0) + 1; });
    const mainPosition = Object.keys(positions).sort((a, b) => positions[b] - positions[a])[0];
    const directionNames = { outward: "向外展开", inward: "向身体收回", upward: "向上移动", downward: "向下移动" };
    const sideNames = { left: "左手", right: "右手" };
    const motionDescription = event => `${stamp(event.peak)} ${event.motions?.length > 1 && !event.direction ? event.motions.map(hand => `${sideNames[hand.side] || "手部"}${directionNames[hand.direction] || "位置变化"}`).join("、") : `${event.sides?.length === 2 ? "双手" : sideNames[event.sides?.[0]] || "手部"}${directionNames[event.direction] || "位置变化"}`}`;
    const gestureObservation = handSamples.length ? `在 ${handSamples.length} 帧中获得可比较的手部轨迹${mainPosition ? `，手部主要位于${positionNames[mainPosition]}` : ""}。${motionEvents.length ? `${motionEvents.length} 个连续变化片段；${motionEvents.slice(0, 2).map(motionDescription).join("，")}。` : "这段已识别轨迹以小幅变化为主。"}` : `本段 ${samples.length} 次抽样未获得连续可比较的手部轨迹；这不证明手部出画或被遮挡。`;
    const smileKnown = faceSamples.filter(sample => finite(sample.smile));
    const browCount = faceSamples.filter(sample => sample.brow >= .4).length;
    const jawValues = faceSamples.map(sample => sample.jaw).filter(finite);
    const jawRange = jawValues.length ? Math.max(...jawValues) - Math.min(...jawValues) : null;
    const expressionObservation = faceSamples.length ? `获得 ${faceSamples.length} 帧面部结果。${sustainedSmile.length ? `${stamp(sustainedSmile[0].start)}–${stamp(sustainedSmile[0].end)} 有连续嘴角上提。` : smileKnown.length >= 3 ? "未检测到持续的双侧嘴角上提。" : "嘴角系数记录不完整。"}${browCount ? `眉部上提线索出现于 ${browCount} 帧。` : ""}${jawRange !== null && jawRange >= .1 ? "嘴部开合随发言有变化。" : ""}` : `本段 ${samples.length} 次抽样均未取得面部关键点；不能由此断言原视频没有清晰人脸。`;
    let gesture = resultPart("insufficient", sharedReason || "手部检测未形成可靠的连续轨迹，当前无法评价动作效果。", "先对照下面的原片帧；识别失败属于分析缺口，不作为演讲者扣分项。", motionEvents, gestureObservation);
    let expression = resultPart("insufficient", sharedReason || "人脸检测未成功或连续结果不足，当前无法评价表情效果。", "先对照原片中的人脸；不能用检测失败代替表情评价。", sustainedSmile, expressionObservation);
    if (handOK) {
      if (ctx.explicit && !ctx.ambiguous && ctx.goal === "solemn" && window[1] - window[0] >= 6 && motionEvents.length >= 3 && movingShare >= .6) {
        gesture = resultPart("conflict", `“${excerpt}…”这段有 ${motionEvents.length} 次连续动作变化，可能弱化你设置的克制表达目标。`, "回看这些变化是否各自承载信息；可减少没有对应内容的重复动作。", motionEvents, gestureObservation);
      } else if (joined.length && (ctx.goal === "emphasize" || ["emphasize", "cause", "contrast", "enumerate"].includes(ctx.kind))) {
        gesture = resultPart("supportive", `在这段${role}中，有 ${joined.length} 个动作片段与较强声音同窗出现，可能帮助突出“${excerpt}…”这层信息。`, "保留与关键句一起出现的动作；时间共现还不能证明每个动作都准确对应关键词。", joined, gestureObservation);
      } else {
        gesture = resultPart("neutral", motionEvents.length ? `这段${role}伴随 ${motionEvents.length} 个动作变化片段，与讲述结构没有发现可确定的冲突；具体动作功能可沿时间点复核。` : `“${excerpt}…”主要靠语句完成${role}，已识别手部保持小幅变化，与这种讲述方式基本协调。`, motionEvents.length ? "重点回看动作开始和收回的位置，确认它们是否对应句子的转折或收束。" : "可以保留这种幅度，不需要为了得分刻意增加手势。", motionEvents, gestureObservation);
      }
    } else if (sharedOK && handSamples.length >= 3) {
      gesture = resultPart("partial", `只能评价 ${stamp(handSamples[0].at)}–${stamp(handSamples[handSamples.length - 1].at)} 中已识别的局部轨迹，不能代表整句动作。`, "结合原片复核未识别的时间，不把漏检描述为遮挡。", motionEvents, gestureObservation);
    }
    if (faceOK) {
      if (ctx.explicit && !ctx.ambiguous && ctx.goal === "solemn" && sustainedSmile.length) {
        expression = resultPart("conflict", `“${excerpt}…”中持续的嘴角上提与“严肃克制”目标可能需要协调。`, "结合原句、引用和个人风格回看；这里不推断内在情绪或态度。", sustainedSmile, expressionObservation);
      } else if (ctx.goal === "warm" && sustainedSmile.length) {
        expression = resultPart("supportive", `欢迎或感谢内容与 ${stamp(sustainedSmile[0].start)} 起的持续嘴角上提同窗出现，可能增强亲和表达。`, "保留自然变化，检查它是否随欢迎或感谢语句开始、结束。", sustainedSmile, expressionObservation);
      } else {
        expression = resultPart("neutral", `当前是${role}，已识别的${sustainedSmile.length ? "嘴角变化" : jawRange !== null && jawRange >= .1 ? "口部开合和面部变化" : "面部动作"}没有提供明确冲突线索；“${excerpt}…”不要求固定微笑或夸张表情。`, "可保持自然表情；优先通过句子重音和停顿传达这一层意思。", sustainedSmile, expressionObservation);
      }
    } else if (sharedOK && faceSamples.length >= 3) {
      expression = resultPart("partial", `人脸在 ${faceSamples.length}/${samples.length} 次抽样中得到识别，现有表情证据仅覆盖部分时段，暂不评价整句。`, "图中人物可能清晰可见，模型仍会漏检；可回看对应帧，不据此评价演讲者。", sustainedSmile, expressionObservation);
    }
    const statuses = [gesture.status, expression.status];
    const status = statuses.includes("conflict") ? "conflict" : statuses.includes("supportive") ? "supportive" : statuses.every(item => item === "insufficient") ? "insufficient" : statuses.includes("neutral") ? "neutral" : "partial";
    const evidence = [...motionEvents, ...sustainedSmile].sort((a, b) => a.peak - b.peak);
    const limitations = ["规则候选，阈值尚未用本项目标注集校准；不输出准确率或合理性百分比。"];
    if (interval >= .75) limitations.push("视觉抽样较稀疏，只比较语句时段共现，不能确定击拍与重音的精确同步。");
    if (input.timingQuality === "browser-estimate") limitations.push("语句范围来自浏览器识别回调，为近似发声窗口。");
    if (cuts.some(at => at >= window[0] && at <= window[1])) limitations.push("已排除画面变化候选附近的手部位移，避免把切镜当作动作。");
    if (original.some(item => Object.values(item.pose?.hands || {}).some(hand => hand?.visible && !finite(hand.speed_body_per_second) && finite(hand.displacement_normalized)))) limitations.push("旧动作数据使用画面坐标位移，尚未按肩宽和时间归一化；镜头移动仍可能影响动作候选。");
    if (original.some(item => item.face?.view === "pose_guided_crop")) limitations.push("部分人脸来自放大裁剪，面部系数可能受低分辨率影响。");
    if (original.some(item => item.face?.visible && !item.face.blendshape_scores)) limitations.push("旧数据仅保留部分面部系数；未记录的系数按缺失处理。");
    return { version: VERSION, method: "context_conditioned_rules", status, label: LABELS[status], time_span: validSpan ? window : null,
      point_id: input.pointId || null, point_text: input.pointText || "", text: String(input.text || ""), context: ctx,
      quality: { observations: samples.length, face_samples: faceSamples.length, comparable_hand_samples: handSamples.length, coverage: round(coverage), face_coverage: round(faceCoverage), hand_coverage: round(handCoverage), sampling_interval_seconds: round(interval), timing_quality: input.timingQuality || "unknown", time_uncertainty_seconds: input.timeUncertainty ?? null, detector_absence_is_not_occlusion: true, reasons: qualityReasons },
      gesture, expression, events: evidence, evidence_frames: input.evidenceFrames || [], voice_windows: voiceWindows, slide: input.slide || null, limitations };
  }
  function forCase(data, decision, goal = "auto") {
    const beat = (data.intent_map?.beats || []).find(item => item.beat_id === decision.beat_id);
    const ids = new Set(decision.matched_observed_ids || decision.evidence_ids || []);
    const span = decision.actual_time_span;
    const units = (data.expression_map?.units || []).filter(unit => ids.has(unit.observed_id) || (!ids.size && span && unit.time_span?.[0] < span[1] && unit.time_span?.[1] > span[0]));
    const refined = data.visual_refinement?.windows?.[decision.beat_id];
    const fit = analyze({ timeSpan: span, pointId: decision.beat_id, pointText: beat?.target_meaning,
      text: units.map(unit => unit.text || "").join(" "), textReliable: units.some(unit => unit.reliability?.text >= .55),
      pointReliable: Boolean(span && decision.confidence >= .5 && decision.verdict !== "evidence_insufficient"), goal,
      timingQuality: "asr-segment", timeUncertainty: 1, samplingInterval: refined?.sampling_interval_seconds ?? data.visual_observations?.sampling_interval_seconds,
      observations: refined?.observations || data.visual_observations?.observations || [], evidenceFrames: refined?.evidence_frames || [], sceneChanges: refined ? refined.observations.filter(item => item.scene_change_candidate).map(item => item.timestamp) : (data.visual_observations?.scene_change_analysis?.candidates || []).map(item => item.timestamp),
      voiceWindows: units.map(unit => ({ span: unit.time_span, reliable: unit.reliability?.audio >= .5, emphasis: finite(unit.speech?.energy_relative) && unit.speech.energy_relative >= .6, basis: "句级响度高于本场基线（≥0.6σ）" })),
      slide: (data.slide_analysis?.decisions || []).find(item => item.beat_id === decision.beat_id) || null });
    if (refined) fit.limitations.push("本段已从原视频按约0.2秒重新取帧，采用人物与头部局部识别；未检出只代表模型没有输出。远景面部细节仍可能不稳定。");
    if (data.metadata?.can_evaluate_original_intent === false || data.metadata?.script_type !== "original_pre_speech_script") fit.limitations.push("观点可能由事后材料提取；本结果不证明符合演讲者原始意图。");
    return fit;
  }
  function forLive(session, segment, observations, audio) {
    const voiceWindows = (audio || []).filter(sample => finite(sample.at) && finite(sample.volumeDelta)).map(sample => ({ span: [Math.max(0, sample.at - .15), sample.at + .15], emphasis: sample.rms > .008 && sample.volumeDelta >= 4, reliable: sample.baselineReady === true, basis: "相对本场说话基线 ≥4dB" }));
    const at = segment.time_span?.[1] ?? segment.at;
    const slide = [...(session.slides || [])].reverse().find(item => item.at <= at && at - item.at <= 14);
    return analyze({ timeSpan: segment.time_span, pointId: segment.pointMatch?.pointId, pointText: segment.pointMatch?.pointText,
      text: segment.text, textReliable: !finite(segment.asrConfidence) || segment.asrConfidence >= .5,
      pointReliable: segment.pointMatch?.reliable === true, timingQuality: segment.timingQuality,
      timeUncertainty: segment.timingQuality === "browser-estimate" ? 1.5 : null, samplingInterval: .2,
      goal: session.expressionGoal || "auto", observations, voiceWindows,
      slide: slide ? { excerpt: slide.text || "", captured_at: slide.at, lexical_overlap: overlap(segment.text, slide.text || ""), source: "live_ocr" } : null });
  }
  function card(result, { seekAttribute = "data-fit-seek", compact = false } = {}) {
    if (!result) return '<p class="fit-empty">等待一段有时间对应的语句与画面。</p>';
    // Saved cloud records are data: restrict statuses and event coordinates before rendering.
    const safeStatus = value => Object.prototype.hasOwnProperty.call(LABELS, value) ? value : "insufficient";
    const safePart = part => ({ status: safeStatus(part?.status), label: LABELS[safeStatus(part?.status)], observation: String(part?.observation || ""), reason: String(part?.reason || "缺少该通道的复核证据。"), suggestion: String(part?.suggestion || "请结合原片人工复核。") });
    result = { ...result, status: safeStatus(result.status), text: String(result.text || ""),
      gesture: safePart(result.gesture), expression: safePart(result.expression),
      context: result.context || { goal: "auto", source: "历史记录" }, quality: result.quality || {},
      events: (Array.isArray(result.events) ? result.events : []).filter(event => event && ["smile", "motion"].includes(event.kind) && finite(event.peak) && event.peak >= 0),
      limitations: Array.isArray(result.limitations) ? result.limitations : [] };
    result.label = LABELS[result.status];
    const span = Array.isArray(result.time_span) && result.time_span.length === 2 && result.time_span.every(finite) && result.time_span[0] >= 0 && result.time_span[1] > result.time_span[0] ? result.time_span : null;
    const windowLabel = span ? `${stamp(span[0])}–${stamp(span[1])}` : "未定位时间";
    const point = result.point_id ? result.point_text : "当前语句尚未明确对应某个观点";
    const controls = span && seekAttribute ? `<button type="button" class="fit-seek" ${seekAttribute}="${span[0]}">↗ 回看 ${windowLabel}</button>` : `<span>${windowLabel}</span>`;
    const safeImage = url => typeof url === "string" && (/^\.\/context-evidence\/[a-zA-Z0-9_/-]+\.jpg$/.test(url) || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url)) ? url : null;
    const frames = (Array.isArray(result.evidence_frames) ? result.evidence_frames : []).filter(frame => frame && finite(frame.timestamp) && safeImage(frame.frame_url)).slice(0, 3);
    const proof = frames.length ? `<div class="fit-proof-heading"><b>对应原片 · 起 / 中 / 末</b><span>点击回到视频时刻</span></div><div class="fit-proof-strip">${frames.map(frame => `<button type="button" class="fit-proof" ${seekAttribute || "data-static-time"}="${frame.timestamp}"><div><img class="fit-source-frame" src="${esc(frame.frame_url)}" alt="原视频 ${stamp(frame.timestamp)} 的完整画面" loading="lazy" />${safeImage(frame.person_url) ? `<img class="fit-person-frame" src="${esc(frame.person_url)}" alt="同一帧的人物区域" loading="lazy" />` : ""}</div><span>${stamp(frame.timestamp)} <small>${safeImage(frame.person_url) ? "原片 / 人物局部" : "完整原片画面"}</small></span></button>`).join("")}</div>` : "";
    const body = [ ["动作", result.gesture], ["表情", result.expression] ].map(([name, part]) => `<div class="fit-channel"><div><b>${name}</b><span class="fit-badge ${part.status}">${esc(part.label)}</span></div>${part.observation ? `<p class="fit-observation"><b>观察</b>${esc(part.observation)}</p>` : ""}<p class="fit-judgment"><b>评价</b>${esc(part.reason)}</p><small>${esc(part.suggestion)}</small></div>`).join("");
    const eventsHtml = result.events.slice(0, 12).map(event => seekAttribute ? `<button type="button" ${seekAttribute}="${Math.max(span?.[0] || 0, event.peak - .5)}" class="fit-event"><i class="${event.kind}"></i>${stamp(event.peak)} · ${event.kind === "smile" ? "嘴角上提片段" : "手部变化"}</button>` : `<span class="fit-event"><i class="${event.kind}"></i>${stamp(event.peak)} · ${event.kind === "smile" ? "嘴角上提片段" : "手部变化"}</span>`).join("");
    const slideText = result.slide ? result.slide.source === "live_ocr" ? `投影文字：${String(result.slide.excerpt).slice(0, 100)}（只作上下文，不判定指向准确性）` : `投影参考：${result.slide.label || "已关联同一观点的 PPT 分析"}；手势指向是否正确仍需回看。` : "本段没有可用的投影文字对应。";
    return `<section class="context-fit ${compact ? "compact" : ""}" data-fit-version="${esc(result.version || "legacy")}"><div class="fit-heading"><span class="fit-eyebrow">内容 × 声音 × 动作</span><span class="fit-badge ${result.status}">${esc(result.label)}</span></div><p class="fit-context"><b>${esc(result.context.roleLabel || GOALS[result.context.goal])}</b><span>${esc(result.context.source)} · ${windowLabel}</span></p><blockquote>${esc(result.text.slice(0, compact ? 100 : 220) || "未取得当前语句")}</blockquote>${compact ? "" : `<p class="fit-point">关联观点：${esc(point)}</p>`}${result.version !== VERSION ? `<p class="fit-archive-note">这是旧版本保存的结果，尚未按本次修正重新分析原录像；旧版的漏检原因及适配结论需要复核。</p>` : ""}${proof}<div class="fit-channels">${body}</div><div class="fit-quality"><span>人脸检出 ${esc(result.quality.face_samples ?? 0)}/${esc(result.quality.observations ?? 0)}</span><span>手部轨迹 ${esc(result.quality.comparable_hand_samples ?? 0)}/${esc(result.quality.observations ?? 0)}</span><span>抽样间隔约 ${esc(result.quality.sampling_interval_seconds ?? "—")}s</span></div>${eventsHtml ? `<div class="fit-events">${eventsHtml}</div>` : ""}<details class="fit-method"><summary>依据与判断边界</summary><p>${esc(slideText)}</p><ul>${result.limitations.map(item => `<li>${esc(item)}</li>`).join("")}</ul><small>规则版本 ${esc(result.version || "legacy")} · 事件时间可追溯</small></details><footer><span>语境适配初筛 · 待人工复核</span>${controls}</footer></section>`;
  }
  function summaryText(result) {
    return `${stamp(result.time_span?.[0])}–${stamp(result.time_span?.[1])} ${result.label}；语句：“${result.text}”；动作观察：${result.gesture.observation || ""}；动作评价：${result.gesture.reason}；表情观察：${result.expression.observation || ""}；表情评价：${result.expression.reason}`;
  }
  return { VERSION, LABELS, GOALS, CONFIG, analyze, forCase, forLive, matchPoint, overlap, card, summaryText };
});
