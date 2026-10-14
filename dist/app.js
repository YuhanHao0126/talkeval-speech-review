const state = { cases: [], selectedCase: null, selectedBeat: null };
const DATA_ROOT = "./data";

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
  return "稿件来源待确认";
}

function sourceReviewDetail(metadata) {
  if (metadata.script_source === "provided_script_or_outline") return "重点由系统从已匹配的讲稿或大纲提取，建议核对";
  if (["sidecar_captions", "embedded_video_subtitles"].includes(metadata.script_source)) return "重点根据视频字幕提取，建议核对";
  if (metadata.script_source === "faster_whisper_transcription" || metadata.script_type === "transcript_proxy") return "未匹配讲稿 · 重点根据视频转写提取，优先核对";
  if (metadata.script_type === "reference_script_proxy") return "重点由系统从参考材料提取，建议核对";
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

function renderStats() {
  const totals = { cases: state.cases.length, full: 0, partial: 0, omitted: 0 };
  state.cases.forEach((item) => {
    const counts = item.verdict_counts || {};
    totals.full += counts.sufficiently_realized || 0;
    totals.partial += counts.partially_realized || 0;
    totals.omitted += counts.omitted || 0;
  });
  document.querySelector("#global-stats").innerHTML = [
    ["案例总数", totals.cases, "已载入的真实演讲"],
    ["完整表达", totals.full, "观点级结果"],
    ["部分表达", totals.partial, "需要回看的片段"],
    ["疑似遗漏", totals.omitted, "需要人工核验"],
  ].map(([label, value, hint]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-hint">${hint}</div></div>`).join("");
}

function renderCaseList() {
  document.querySelector("#case-count").textContent = state.cases.length;
  const list = document.querySelector("#case-list");
  if (!state.cases.length) {
    list.innerHTML = `<div class="loading-card">还没有分析产物。请先运行 analyze-real-data。</div>`;
    return;
  }
  list.innerHTML = state.cases.map((item, index) => {
    const counts = item.verdict_counts || {};
    const pills = [
      ["sufficiently_realized", counts.sufficiently_realized || 0],
      ["partially_realized", counts.partially_realized || 0],
      ["omitted", counts.omitted || 0],
    ].filter(([, value]) => value > 0).map(([key, value]) => `<span class="mini-pill pill-${verdictClass(key)}">${verdictText[key]} ${value}</span>`).join("");
    return `<button class="case-button ${state.selectedCase === item.case_id ? "active" : ""}" data-case="${esc(item.case_id)}">
      <span class="case-index">${String(index + 1).padStart(2, "0")}</span><span class="case-title">${esc(item.title || item.case_id)}</span>
      <span class="case-speaker">${esc(item.speaker_id || "未登记演讲者")}</span>
      <span class="case-pills"><span class="mini-pill pill-uncertain">${esc(item.source_review_label || sourceReviewLabel(item.script_source, item.script_type))}</span>${pills || `<span class="mini-pill pill-uncertain">未完成</span>`}</span>
    </button>`;
  }).join("");
  list.querySelectorAll("[data-case]").forEach((button) => button.addEventListener("click", () => selectCase(button.dataset.case)));
}

function metric(label, value) {
  return `<div><div class="metric-line"><span>${label}</span><span class="metric-value">${pct(value)}</span></div><div class="metric-bar"><div class="metric-fill" style="width:${pct(value)}"></div></div></div>`;
}

function renderTimeline(data) {
  const units = data.expression_map?.units || [];
  const duration = Number(data.expression_map?.duration || 1);
  const matched = new Set((data.alignment?.decisions || []).flatMap((item) => item.matched_observed_ids || []));
  const selected = state.selectedBeat;
  const selectedIds = new Set(selected?.matched_observed_ids || []);
  const blocks = units.map((unit) => {
    const start = Number(unit.time_span?.[0] || 0);
    const end = Number(unit.time_span?.[1] || start);
    const left = (start / duration) * 100;
    const width = Math.max(.18, ((end - start) / duration) * 100);
    const cls = selectedIds.has(unit.observed_id) ? "selected" : (matched.has(unit.observed_id) ? "matched" : "");
    return `<button class="timeline-unit ${cls}" style="left:${left}%;width:${width}%" title="${esc(time(start))} ${esc(unit.text)}" data-start="${start}"><span>${esc(unit.text)}</span></button>`;
  }).join("");
  return `<div class="timeline-track">${blocks}</div><div class="timeline-axis"><span>00:00</span><span>${time(duration)}</span></div>`;
}

function selectVideoTime(start) {
  const video = document.querySelector("#case-video");
  if (video) { video.currentTime = Number(start); video.play().catch(() => {}); }
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
  const detailSummary = `<div class="detail-summary"><div><strong>${decisions.length}</strong><span>目标观点</span></div><div><strong>${verdictCounts.sufficiently_realized || 0}</strong><span>完整表达</span></div><div><strong>${verdictCounts.partially_realized || 0}</strong><span>部分表达</span></div></div>`;
  const badges = [
    `<span class="badge badge-neutral">${esc(sourceReviewLabel(metadata.script_source, metadata.script_type))}</span>`,
    `<span class="badge badge-neutral">${esc(sourceReviewDetail(metadata))}</span>`,
    `<span class="badge badge-neutral">ASR：${esc(data.run_metadata?.asr_backend || "未知")}</span>`,
    `<span class="badge badge-neutral">语义：${esc(data.run_metadata?.semantic_backend || "未知")}</span>`,
  ].join("");
  const hasVideo = Boolean(data.video_url);
  const video = hasVideo ? `<video id="case-video" class="video-frame" controls preload="metadata"><source src="${esc(data.video_url)}" type="video/mp4"><a href="${esc(data.video_url)}" target="_blank" rel="noopener noreferrer">在新标签页打开视频</a></video>` : `<div class="video-placeholder"><div><strong>视频暂未公开发布</strong><span>原始素材仍处于使用权限审核状态，时间戳与文本证据可正常查看。</span></div></div>`;
  const cards = decisions.map((decision, index) => {
    const beat = (data.intent_map?.beats || []).find((item) => item.beat_id === decision.beat_id) || {};
    const active = state.selectedBeat?.beat_id === decision.beat_id;
    const span = decision.actual_time_span;
    const evidence = (decision.evidence_ids || []).map((id) => (data.expression_map?.units || []).find((unit) => unit.observed_id === id)).filter(Boolean);
    const evidenceText = evidence.map((item) => item.text).join(" ") || "未找到可引用的实际转写";
    return `<article class="decision-card ${active ? "active" : ""}" data-beat-index="${index}">
      <div class="decision-heading"><div class="decision-title"><span class="beat-id">${esc(decision.beat_id)}</span><h3>${esc(beat.target_meaning || "目标观点")}</h3></div><span class="badge badge-${verdictClass(decision.verdict)}">${esc(verdictText[decision.verdict] || decision.verdict)}</span></div>
      <div class="decision-reason">${esc(decision.reason || "暂无判定理由")}</div>
      <div class="metrics">${metric("语义相似度", decision.semantic_similarity)}${metric("必要命题覆盖", decision.claim_coverage)}${metric("置信度", decision.confidence)}</div>
      <div class="evidence-box"><div class="evidence-heading"><span>TRANSCRIPT EVIDENCE</span><span class="decision-time" data-start="${span ? span[0] : ""}">${span ? `${time(span[0])} – ${time(span[1])}` : "未定位"}</span></div><p class="evidence-text">${esc(evidenceText)}</p></div>
    </article>`;
  }).join("");
  document.querySelector("#detail-column").innerHTML = `
    <section class="detail-header panel"><div class="detail-title-row"><div><p class="eyebrow">SELECTED SPEECH</p><h2>${esc(title)}</h2><p class="detail-subtitle">${esc(subtitle)}</p></div>${detailSummary}</div><div class="detail-toolbar"><div class="detail-badges">${badges}</div><a class="report-link" href="${esc(data.report_url || "#")}" target="_blank" rel="noreferrer">打开 Markdown 报告 ↗</a></div></section>
    <section class="video-panel panel"><div class="video-heading"><div><p class="eyebrow">${hasVideo ? "VIDEO REVIEW" : "EVIDENCE POSITION"}</p><h3>${hasVideo ? "原始片段回看" : "时间证据定位"}</h3></div><p>${hasVideo ? "点击下方证据时间可跳转" : "公开视频授权后可接入回放"}</p></div>${video}</section>
    <section class="timeline-panel panel"><div class="timeline-header"><div><p class="eyebrow">EXPRESSION TIMELINE</p><h3>实际表达时间轴</h3><p>蓝色片段表示当前观点的证据，浅色片段表示其他转写单元。</p></div><span class="timeline-duration">时长 ${time(data.expression_map?.duration)}</span></div>${renderTimeline(data)}</section>
    <section class="decisions-panel panel"><div class="panel-heading"><div><p class="eyebrow">INTENT ALIGNMENT</p><h3>核心观点判定</h3></div><span class="case-count">${decisions.length} 个观点</span></div><div class="decision-list">${cards || `<div class="loading-card">没有判定结果</div>`}</div></section>
    <details class="raw-panel panel"><summary>查看原始 JSON（调试用）</summary><pre>${esc(JSON.stringify(data.alignment, null, 2))}</pre></details>`;
  document.querySelectorAll(".decision-card").forEach((card) => card.addEventListener("click", () => {
    const decision = decisions[Number(card.dataset.beatIndex)];
    state.selectedBeat = decision;
    renderDetail(data);
  }));
  document.querySelectorAll("[data-start]").forEach((node) => node.addEventListener("click", (event) => {
    event.stopPropagation();
    if (node.dataset.start) selectVideoTime(node.dataset.start);
  }));
}

async function selectCase(caseId) {
  state.selectedCase = caseId;
  state.selectedBeat = null;
  renderCaseList();
  document.querySelector("#detail-column").innerHTML = `<div class="loading-card panel">正在读取案例证据…</div>`;
  try {
    const data = await getJson(`${DATA_ROOT}/cases/${encodeURIComponent(caseId)}.json`);
    renderDetail(data);
    document.querySelector("#connection-status").textContent = "分析结果已连接";
  } catch (error) {
    document.querySelector("#detail-column").innerHTML = `<div class="error-state">无法读取案例：${esc(error.message)}</div>`;
  }
}

async function loadCases() {
  try {
    const data = await getJson(`${DATA_ROOT}/cases.json`);
    state.cases = data.cases || [];
    renderStats();
    renderCaseList();
    document.querySelector("#connection-status").textContent = `已连接 · ${state.cases.length} 个案例`;
    if (!state.selectedCase && state.cases.length) selectCase(state.cases[0].case_id);
  } catch (error) {
    document.querySelector("#connection-status").textContent = "读取失败";
    document.querySelector("#case-list").innerHTML = `<div class="error-state">${esc(error.message)}<br>请确认已经运行 analyze-real-data。</div>`;
  }
}

document.querySelector("#refresh-button").addEventListener("click", loadCases);
loadCases();
