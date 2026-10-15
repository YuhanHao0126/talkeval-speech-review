/* Shared, deterministic context-fit baseline. All verdicts are review candidates. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TalkEvalFit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "context-rules-2026.10.15-v1";
  const LABELS = { supportive: "可能支持表达", neutral: "自然 / 中性候选", conflict: "可能冲突 · 请复核", insufficient: "证据不足" };
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
    // Negated/quoted tone words are not grounds for an automatic tone judgement.
    const ambiguous = /[“”「」]|不是|并非|不必|不要|不需要|not\b|don't\b/i.test(text);
    const warm = !ambiguous && /谢谢|感谢|欢迎|大家好|大家下午好|很高兴|很开心|\bthank(?:s| you)\b|\bwelcome\b|\bglad\b/i.test(text);
    const emphasis = !ambiguous && /关键|重点|记住|最重要|必须|强调|结论|核心|首先|其次|第一|第二|一方面|另一方面|\bimportant\b|\bremember\b|\bfirst\b|\bsecond\b|\bkey point\b/i.test(text);
    return { goal: explicit ? goal : warm ? "warm" : emphasis ? "emphasize" : "explain", source: explicit ? "演讲者设置" : warm || emphasis ? "转写词汇线索" : "一般说明语境", explicit, ambiguous };
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
    const hands = Object.values(raw.pose?.hands || {}).filter(hand => hand?.visible);
    const comparable = hands.filter(hand => ["clear_motion", "small_motion"].includes(hand.movement));
    return { at: raw.timestamp, faceVisible: face.visible === true, smile,
      handVisible: hands.length > 0, comparable: comparable.length > 0,
      moving: comparable.some(hand => hand.movement === "clear_motion"),
      motion: Math.max(0, ...comparable.map(hand => finite(hand.speed_body_per_second) ? hand.speed_body_per_second : finite(hand.displacement_normalized) ? hand.displacement_normalized : 0)),
      source: raw };
  }
  function events(samples, interval, predicate, kind) {
    const result = [];
    let current = null;
    for (const sample of samples) {
      if (!predicate(sample)) { current = null; continue; }
      if (!current || sample.at - current.end > interval * 1.8) {
        current = { id: `${kind}-${round(sample.at)}`, kind, start: sample.at, end: sample.at, peak: sample.at, count: 1, magnitude: kind === "smile" ? sample.smile : sample.motion };
        result.push(current);
      } else {
        current.end = sample.at; current.count++;
        const magnitude = kind === "smile" ? sample.smile : sample.motion;
        if (magnitude > current.magnitude) { current.magnitude = magnitude; current.peak = sample.at; }
      }
    }
    return result.map(item => ({ ...item, duration: round(item.end - item.start), magnitude: round(item.magnitude) }));
  }
  function resultPart(status, reason, suggestion, evidence = []) { return { status, label: LABELS[status], reason, suggestion, evidence }; }
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
    const sharedOK = timingOK && textOK && linked && coverage >= CONFIG.minCoverage;
    const handOK = sharedOK && handSamples.length >= CONFIG.minSamples && handCoverage >= CONFIG.minCoverage;
    const smileSamples = faceSamples.filter(sample => finite(sample.smile));
    const needsSmile = ctx.goal === "warm" || ctx.goal === "solemn";
    const faceOK = sharedOK && faceSamples.length >= CONFIG.minSamples && faceCoverage >= CONFIG.minCoverage && (!needsSmile || (smileSamples.length >= CONFIG.minSamples && timeCoverage(smileSamples) >= CONFIG.minCoverage));
    const motionEvents = events(samples, interval, sample => sample.comparable && sample.moving, "motion");
    const smileEvents = events(samples, interval, sample => sample.faceVisible && finite(sample.smile) && sample.smile >= CONFIG.smile, "smile");
    const sustainedSmile = smileEvents.filter(event => event.count >= CONFIG.minSamples && event.duration >= CONFIG.minSmileSeconds);
    const voiceWindows = (input.voiceWindows || []).filter(item => item.reliable && item.emphasis && item.span?.length === 2 && item.span.every(finite) && item.span[1] > item.span[0] && item.span[0] <= window[1] && item.span[1] >= window[0]);
    const joined = motionEvents.filter(event => voiceWindows.some(voice => event.peak >= voice.span[0] && event.peak <= voice.span[1]));
    const qualityReasons = [];
    if (!validSpan) qualityReasons.push("没有定位到对应视频时间段");
    if (!textOK) qualityReasons.push("缺少可靠的当前语句");
    if (!linked) qualityReasons.push("语句与观点的归属不够明确");
    if (!timingOK && validSpan) qualityReasons.push(input.timingQuality === "manual" ? "手动补录没有可靠的发声时间" : "语句时间范围不够可靠");
    if (coverage < CONFIG.minCoverage) qualityReasons.push("时间窗内视觉抽样缺失较多");
    const sharedReason = qualityReasons.join("；");
    let gesture = resultPart("insufficient", sharedReason || "手部出画、遮挡或连续可比较样本不足。", "让至少一只手与肩部进入画面，再回看完整语句。");
    let expression = resultPart("insufficient", sharedReason || "清晰人脸样本不足，暂不判断与内容是否适配。", "保持面部可见；结合原片确认这句话的语气。");
    if (handOK) {
      const movingShare = handSamples.filter(sample => sample.moving).length / handSamples.length;
      if (ctx.explicit && !ctx.ambiguous && ctx.goal === "solemn" && window[1] - window[0] >= 6 && motionEvents.length >= 3 && movingShare >= .6) {
        gesture = resultPart("conflict", "当前设置为“严肃克制”，这句话中出现多次明显手部变化，可能削弱克制的表达目标。", "回看动作是否仍在辅助内容；可尝试减少连续动作后比较。", motionEvents);
      } else if (ctx.goal === "emphasize" && joined.length) {
        gesture = resultPart("supportive", "强调语境中，手部变化与较强声音出现在同一语句时段，可能帮助突出重点。", "回看动作峰值与关键词是否一致；本结果只确认时段共现。", joined);
      } else {
        gesture = resultPart("neutral", motionEvents.length ? "有可见手部变化，但现有证据尚不能确定其说明或强调功能。" : "这一段手部变化较小；说明性表达不必依赖频繁动作。", "按内容需要保留动作，不必为了评分增加手势。", motionEvents);
      }
    }
    if (sharedOK && needsSmile && !faceOK && faceSamples.length >= CONFIG.minSamples) expression = resultPart("insufficient", "当前语境需要连续嘴角动作证据，但有效系数或可见时长不足。", "回看原片；后续采集会保留完整面部系数，缺失值不会当作没有动作。");
    if (faceOK) {
      if (ctx.explicit && !ctx.ambiguous && ctx.goal === "solemn" && sustainedSmile.length) {
        expression = resultPart("conflict", "当前设置为“严肃克制”，同时出现持续的嘴角上提动作，两者可能需要协调。", "结合语义、引用和个人表达习惯回看；该提示不代表情绪或态度判断。", sustainedSmile);
      } else if (ctx.goal === "warm" && sustainedSmile.length) {
        expression = resultPart("supportive", "欢迎或感谢语境中出现持续的嘴角上提动作，可能支持友好的表达。", "保留自然变化，并确认与实际语气一致。", sustainedSmile);
      } else {
        expression = resultPart("neutral", "面部可见，但当前语境没有足够证据要求某种特定表情。", "结合完整语句回看；张口可能来自发音，不能单独作为表达效果。", sustainedSmile);
      }
    }
    const statuses = [gesture.status, expression.status];
    const status = statuses.includes("conflict") ? "conflict" : statuses.includes("supportive") ? "supportive" : statuses.every(item => item === "insufficient") ? "insufficient" : "neutral";
    const evidence = [...motionEvents, ...sustainedSmile].sort((a, b) => a.peak - b.peak);
    const limitations = ["规则候选，阈值尚未用本项目标注集校准；不输出准确率或合理性百分比。"];
    if (interval >= .75) limitations.push("视觉抽样较稀疏，只比较语句时段共现，不能确定击拍与重音的精确同步。");
    if (input.timingQuality === "browser-estimate") limitations.push("语句范围来自浏览器识别回调，为近似发声窗口。");
    if (cuts.some(at => at >= window[0] && at <= window[1])) limitations.push("已排除画面变化候选附近的手部位移，避免把切镜当作动作。");
    if (original.some(item => Object.values(item.pose?.hands || {}).some(hand => hand?.visible && !finite(hand.speed_body_per_second)))) limitations.push("旧动作数据使用画面坐标位移，尚未按肩宽和时间归一化；镜头移动仍可能影响动作候选。");
    if (original.some(item => item.face?.view === "pose_guided_crop")) limitations.push("部分人脸来自放大裁剪，面部系数可能受低分辨率影响。");
    if (original.some(item => item.face?.visible && !item.face.blendshape_scores)) limitations.push("旧数据仅保留部分面部系数；未记录的系数按缺失处理。");
    return { version: VERSION, method: "context_conditioned_rules", status, label: LABELS[status], time_span: validSpan ? window : null,
      point_id: input.pointId || null, point_text: input.pointText || "", text: String(input.text || ""), context: ctx,
      quality: { observations: samples.length, face_samples: faceSamples.length, comparable_hand_samples: handSamples.length, coverage: round(coverage), face_coverage: round(faceCoverage), hand_coverage: round(handCoverage), sampling_interval_seconds: round(interval), timing_quality: input.timingQuality || "unknown", time_uncertainty_seconds: input.timeUncertainty ?? null, reasons: qualityReasons },
      gesture, expression, events: evidence, voice_windows: voiceWindows, slide: input.slide || null, limitations };
  }
  function forCase(data, decision, goal = "auto") {
    const beat = (data.intent_map?.beats || []).find(item => item.beat_id === decision.beat_id);
    const ids = new Set(decision.matched_observed_ids || decision.evidence_ids || []);
    const span = decision.actual_time_span;
    const units = (data.expression_map?.units || []).filter(unit => ids.has(unit.observed_id) || (!ids.size && span && unit.time_span?.[0] < span[1] && unit.time_span?.[1] > span[0]));
    const fit = analyze({ timeSpan: span, pointId: decision.beat_id, pointText: beat?.target_meaning,
      text: units.map(unit => unit.text || "").join(" "), textReliable: units.some(unit => unit.reliability?.text >= .55),
      pointReliable: Boolean(span && decision.confidence >= .5 && decision.verdict !== "evidence_insufficient"), goal,
      timingQuality: "asr-segment", timeUncertainty: 1, samplingInterval: data.visual_observations?.sampling_interval_seconds,
      observations: data.visual_observations?.observations || [], sceneChanges: (data.visual_observations?.scene_change_analysis?.candidates || []).map(item => item.timestamp),
      voiceWindows: units.map(unit => ({ span: unit.time_span, reliable: unit.reliability?.audio >= .5, emphasis: finite(unit.speech?.energy_relative) && unit.speech.energy_relative >= .6, basis: "句级响度高于本场基线（≥0.6σ）" })),
      slide: (data.slide_analysis?.decisions || []).find(item => item.beat_id === decision.beat_id) || null });
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
    const safePart = part => ({ status: safeStatus(part?.status), label: LABELS[safeStatus(part?.status)], reason: String(part?.reason || "缺少该通道的复核证据。"), suggestion: String(part?.suggestion || "请结合原片人工复核。") });
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
    const body = [ ["动作", result.gesture], ["表情", result.expression] ].map(([name, part]) => `<div class="fit-channel"><div><b>${name}</b><span class="fit-badge ${part.status}">${esc(part.label)}</span></div><p>${esc(part.reason)}</p><small>${esc(part.suggestion)}</small></div>`).join("");
    const eventsHtml = result.events.slice(0, 12).map(event => seekAttribute ? `<button type="button" ${seekAttribute}="${Math.max(span?.[0] || 0, event.peak - .5)}" class="fit-event"><i class="${event.kind}"></i>${stamp(event.peak)} · ${event.kind === "smile" ? "嘴角上提片段" : "手部变化"}</button>` : `<span class="fit-event"><i class="${event.kind}"></i>${stamp(event.peak)} · ${event.kind === "smile" ? "嘴角上提片段" : "手部变化"}</span>`).join("");
    const slideText = result.slide ? result.slide.source === "live_ocr" ? `投影文字：${String(result.slide.excerpt).slice(0, 100)}（只作上下文，不判定指向准确性）` : `投影参考：${result.slide.label || "已关联同一观点的 PPT 分析"}；手势指向是否正确仍需回看。` : "本段没有可用的投影文字对应。";
    return `<section class="context-fit ${compact ? "compact" : ""}" data-fit-version="${VERSION}"><div class="fit-heading"><span class="fit-eyebrow">内容 × 声音 × 动作</span><span class="fit-badge ${result.status}">${esc(result.label)}</span></div><p class="fit-context"><b>${esc(GOALS[result.context.goal])}</b><span>${esc(result.context.source)} · ${windowLabel}</span></p><blockquote>${esc(result.text.slice(0, compact ? 100 : 220) || "未取得当前语句")}</blockquote>${compact ? "" : `<p class="fit-point">关联观点：${esc(point)}</p>`}<div class="fit-channels">${body}</div><div class="fit-quality"><span>人脸 ${esc(result.quality.face_samples ?? 0)}/${esc(result.quality.observations ?? 0)}</span><span>可比较手部 ${esc(result.quality.comparable_hand_samples ?? 0)}/${esc(result.quality.observations ?? 0)}</span><span>抽样间隔约 ${esc(result.quality.sampling_interval_seconds ?? "—")}s</span></div>${eventsHtml ? `<div class="fit-events">${eventsHtml}</div>` : ""}<details class="fit-method"><summary>依据与判断边界</summary><p>${esc(slideText)}</p><ul>${result.limitations.map(item => `<li>${esc(item)}</li>`).join("")}</ul><small>规则版本 ${VERSION} · 事件时间可追溯</small></details><footer><span>语境适配初筛 · 待人工复核</span>${controls}</footer></section>`;
  }
  function summaryText(result) {
    return `${stamp(result.time_span?.[0])}–${stamp(result.time_span?.[1])} ${result.label}；语句：“${result.text}”；动作：${result.gesture.reason}；表情：${result.expression.reason}`;
  }
  return { VERSION, LABELS, GOALS, CONFIG, analyze, forCase, forLive, matchPoint, overlap, card, summaryText };
});
