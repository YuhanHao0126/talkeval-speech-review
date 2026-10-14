(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const STORAGE_KEY = "talkeval-live-sessions-v1";
  const MEDIA_DB = "talkeval-live-recordings-v1";
  const CLOUD_API = "https://talkeval-speech-review.expelliarmus-yh05.chatgpt.site";
  const MAX_SESSIONS = 30;
  const state = {
    cases: [], selectedCase: null, points: [], session: null, timer: null,
    cameraStream: null, screenStream: null, audioContext: null, analyser: null,
    mediaRecorder: null, recordingChunks: [], recordingChunkCount: 0,
    recordingLocalWrites: Promise.resolve(), recordingCloudWrites: Promise.resolve(),
    recordingLocalError: "", recordingCloudError: "", remoteSessions: [], replayUrl: null,
    speech: null, speechOn: false, lastSpeechAt: 0, lastUtteranceAt: 0,
    audioSamples: [], voiceBaseline: [], currentVolume: null, currentPitch: null,
    faceTask: null, poseTask: null, visionLoading: false, visualRaf: null,
    lastVisionAt: 0, previousWrists: null, visualSummary: [],
    ocrWorker: null, ocrLoading: null, ocrBusy: false, ocrTimer: null, lastOcrAt: 0,
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const elapsed = () => state.session ? Math.max(0, (Date.now() - state.session.startedAt) / 1000) : 0;
  const stamp = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const readSessions = () => {
    try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(value) ? value : []; }
    catch { return []; }
  };
  function allSavedSessions() {
    const sessions = new Map();
    [...readSessions(), ...state.remoteSessions].forEach((session) => sessions.set(session.id, { ...sessions.get(session.id), ...session }));
    return [...sessions.values()];
  }
  function openMediaDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("此浏览器不支持本机录像存储")); return; }
      const request = indexedDB.open(MEDIA_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("recordings")) request.result.createObjectStore("recordings");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开本机录像存储"));
    });
  }
  async function storeRecordingChunk(id, index, blob) {
    const db = await openMediaDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("recordings", "readwrite");
        transaction.objectStore("recordings").put(blob, `${id}:${String(index).padStart(8, "0")}`);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("保存录像失败"));
        transaction.onabort = () => reject(transaction.error || new Error("保存录像已中断"));
      });
    } finally { db.close(); }
  }
  async function loadRecordingParts(id, expectedChunks = 0) {
    const db = await openMediaDb();
    try {
      const result = await new Promise((resolve, reject) => {
        const store = db.transaction("recordings", "readonly").objectStore("recordings");
        const prefix = `${id}:`;
        const request = store.getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error("读取录像失败"));
      });
      if (!result.length) {
        const legacy = await new Promise((resolve, reject) => {
          const request = db.transaction("recordings", "readonly").objectStore("recordings").get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("读取录像失败"));
        });
        return legacy ? [legacy] : [];
      }
      return result.slice(0, expectedChunks || result.length);
    } finally { db.close(); }
  }
  async function loadRecording(id, expectedChunks = 0) {
    const chunks = await loadRecordingParts(id, expectedChunks);
    return chunks.length ? new Blob(chunks, { type: chunks.find((chunk) => chunk.type)?.type || "video/webm" }) : null;
  }
  async function deleteRecording(id) {
    const db = await openMediaDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("recordings", "readwrite");
        const store = transaction.objectStore("recordings");
        store.delete(id);
        const request = store.openKeyCursor(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`));
        request.onsuccess = () => { if (request.result) { store.delete(request.result.primaryKey); request.result.continue(); } };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("清理旧录像失败"));
      });
    } finally { db.close(); }
  }
  function startVideoRecording(stream, sessionId) {
    if (!("MediaRecorder" in window)) throw new Error("此浏览器不支持现场录像");
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.recordingChunks = []; state.recordingChunkCount = 0;
    state.recordingLocalWrites = Promise.resolve(); state.recordingCloudWrites = Promise.resolve();
    state.recordingLocalError = ""; state.recordingCloudError = "";
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data?.size) return;
      const index = state.recordingChunkCount++;
      const chunk = event.data;
      state.recordingLocalWrites = state.recordingLocalWrites.then(() => storeRecordingChunk(sessionId, index, chunk)).catch((error) => { state.recordingLocalError = error.message || "本机录像保存失败"; });
      state.recordingCloudWrites = state.recordingCloudWrites.then(() => state.recordingCloudError ? null : uploadCloudChunk(sessionId, index, chunk)).catch((error) => { state.recordingCloudError = error.message || "云端录像上传失败"; });
    });
    recorder.start(5000);
    state.mediaRecorder = recorder;
    state.session.videoId = sessionId;
    state.session.videoMimeType = recorder.mimeType || mimeType || "video/webm";
  }
  async function finishVideoRecording() {
    const recorder = state.mediaRecorder;
    if (!recorder) return null;
    if (recorder.state !== "inactive") {
      await new Promise((resolve) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.stop();
      });
    }
    await Promise.all([state.recordingLocalWrites, state.recordingCloudWrites]);
    state.mediaRecorder = null;
    state.recordingChunks = [];
    if (!state.recordingChunkCount) throw new Error("录像文件为空");
    const localReady = !state.recordingLocalError;
    const cloudReady = !state.recordingCloudError;
    if (!localReady && !cloudReady) throw new Error(state.recordingLocalError || "录像无法保存");
    return { chunks: state.recordingChunkCount, localReady, cloudReady };
  }
  async function cloudFetch(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${CLOUD_API}${path}`, { ...options, signal: controller.signal, mode: "cors", credentials: "omit" });
      if (!response.ok) {
        let message = `云端服务返回 ${response.status}`;
        try { message = (await response.json()).error || message; } catch { /* Non-JSON error response. */ }
        throw new Error(message);
      }
      return response;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("连接云端超时");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function uploadCloudChunk(sessionId, index, blob) {
    const response = await cloudFetch(`/api/sessions/${encodeURIComponent(sessionId)}/chunks/${index}`, { method: "PUT", headers: { "Content-Type": blob.type || "video/webm" }, body: blob });
    return response.json();
  }
  async function saveCloudSession(session) {
    const publicRecord = { ...session, audio: [], videoChunks: session.videoChunks || 0 };
    const response = await cloudFetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(publicRecord) });
    return response.json();
  }
  async function syncSavedSession(session) {
    if (!session?.videoId) throw new Error("本条记录没有可上传的本机录像。");
    const parts = await loadRecordingParts(session.videoId, session.videoChunks);
    if (!parts.length) throw new Error("当前设备找不到本机录像。");
    for (let index = 0; index < parts.length; index += 1) await uploadCloudChunk(session.id, index, parts[index]);
    const updated = { ...session, videoChunks: parts.length, cloudVideoReady: true, cloudStored: true, cloudUploadError: "" };
    const result = await saveCloudSession(updated);
    updated.cloudVideoReady = Boolean(result.session?.cloudVideoReady);
    if (!updated.cloudVideoReady) throw new Error("云端还没有收到全部录像分段。");
    const local = [updated, ...readSessions().filter((item) => item.id !== updated.id)].slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    state.remoteSessions = [updated, ...state.remoteSessions.filter((item) => item.id !== updated.id)];
    renderReplay(updated); renderSessions(); renderMemory();
    return updated;
  }
  async function refreshCloudSessions() {
    try {
      const response = await cloudFetch("/api/sessions");
      const result = await response.json();
      state.remoteSessions = Array.isArray(result.sessions) ? result.sessions : [];
      setText("#cloud-session-status", `公开云端 · ${state.remoteSessions.length} 场`);
    } catch (error) {
      setText("#cloud-session-status", "云端暂不可用");
      console.warn("云端历史暂不可用：", error.message);
    }
    renderSessions(); renderMemory();
  }
  const setText = (id, text) => { const node = $(id); if (node) node.textContent = text; };

  function switchView(which) {
    const review = which === "review";
    $("#review-view").hidden = !review;
    $("#live-view").hidden = review;
    $("#review-tab").classList.toggle("active", review);
    $("#live-tab").classList.toggle("active", !review);
    if (!review) { renderMemory(); renderSessions(); }
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  }
  function grams(value) {
    const text = normalize(value);
    const out = new Set();
    const latin = text.match(/[a-z0-9]{2,}/g) || [];
    latin.forEach((word) => out.add(word));
    const cjk = [...text].filter((char) => /[\u3400-\u9fff]/u.test(char));
    for (let i = 0; i < cjk.length - 1; i += 1) out.add(cjk[i] + cjk[i + 1]);
    if (out.size < 3) [...text].forEach((char) => out.add(char));
    return out;
  }
  function scorePoint(point, transcript) {
    const expected = point.features || grams(point.text);
    const heard = grams(transcript);
    if (!expected.size || !heard.size) return 0;
    let hits = 0;
    expected.forEach((gram) => { if (heard.has(gram)) hits += 1; });
    return hits / expected.size;
  }
  function textSimilarity(left, right) {
    const a = grams(left); const b = grams(right);
    if (!a.size || !b.size) return 0;
    let shared = 0; a.forEach((gram) => { if (b.has(gram)) shared += 1; });
    return shared / (a.size + b.size - shared);
  }
  function setPoints(items, { caseId = null, title = "" } = {}) {
    state.selectedCase = caseId;
    state.points = items.map((item, index) => ({
      id: item.beat_id || `point-${index + 1}`,
      text: String(item.target_meaning || item.text || "").trim(),
      features: grams(item.target_meaning || item.text || ""),
      index,
      evidence: [],
      maxScore: 0,
      applause: [],
    })).filter((item) => item.text);
    if (title && !$("#coach-topic").value.trim()) $("#coach-topic").value = title;
    renderPoints(); renderMemory();
    setText("#coach-cue-title", state.points.length ? "重点清单已就绪" : "请添加核心观点");
    setText("#coach-cue-copy", state.points.length ? "开始后会根据转写寻找观点中的词汇线索；每条提醒都是待确认提示。" : "每行填写一个核心观点，或选择一个案例作为参考提纲。");
    updateStartAvailability();
  }

  async function loadCases() {
    try {
      const response = await fetch("./data/cases.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.cases = data.cases || [];
      const select = $("#coach-case");
      state.cases.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.case_id; option.textContent = item.title || item.case_id;
        select.appendChild(option);
      });
    } catch (error) {
      setText("#coach-model-status", `案例提纲读取失败：${error.message}`);
    }
  }

  async function chooseCase(caseId) {
    if (caseId === "custom") {
      $("#coach-topic").value = "";
      $("#coach-outline").value = "";
      setPoints([]);
      return;
    }
    const meta = state.cases.find((item) => item.case_id === caseId);
    if (!meta) return;
    try {
      const response = await fetch(`./data/cases/${encodeURIComponent(caseId)}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const beats = data.intent_map?.beats || [];
      $("#coach-topic").value = data.intent_map?.title || meta.topic || meta.title || "";
      $("#coach-speaker").value = meta.speaker_id || "";
      $("#coach-outline").value = beats.map((beat) => beat.target_meaning).join("\n");
      setPoints(beats, { caseId, title: data.intent_map?.title || meta.title });
    } catch (error) {
      setText("#coach-cue-copy", `无法加载参考提纲：${error.message}`);
    }
  }

  function updateStartAvailability() {
    $("#coach-start").disabled = !$("#coach-consent").checked || !state.points.length || Boolean(state.session);
  }

  function transcriptText() {
    if (!state.session) return "";
    return state.session.segments.map((item) => item.text).join(" ");
  }

  function pointScores() {
    const text = transcriptText();
    return state.points.map((point) => {
      const score = scorePoint(point, text);
      point.maxScore = Math.max(point.maxScore, score);
      return { point, score };
    });
  }

  function renderPoints() {
    const host = $("#coach-beats-list");
    setText("#coach-beat-count", `${state.points.length} 个`);
    if (!state.points.length) {
      host.innerHTML = `<p class="quiet-copy">填写核心观点后显示。</p>`;
      setText("#coach-progress-text", "0 / 0 个重点已检测到");
      setText("#coach-progress-fill", "");
      $("#coach-progress-fill").style.width = "0%";
      return;
    }
    const scores = state.session ? pointScores() : state.points.map((point) => ({ point, score: point.maxScore || 0 }));
    const confirmed = scores.filter(({ score }) => score >= 0.34).length;
    const hints = scores.filter(({ score }) => score >= 0.15).length;
    setText("#coach-progress-text", `${confirmed} / ${state.points.length} 个重点出现较多词汇线索`);
    setText("#coach-active-index", state.session ? `已发现 ${hints} 条线索` : "待开始");
    $("#coach-progress-fill").style.width = `${Math.round((confirmed / state.points.length) * 100)}%`;
    host.innerHTML = scores.map(({ point, score }) => {
      const status = score >= 0.34 ? ["候选已覆盖", "covered"] : score >= 0.15 ? ["出现部分线索", "partial"] : ["尚未发现", "pending"];
      const evidence = point.evidence.slice(-2).map((entry) => `${stamp(entry.at)}「${esc(entry.text)}」`).join(" · ") || "等待口头证据";
      const lastVoice = point.evidence[point.evidence.length - 1]?.voice;
      const voiceCue = lastVoice ? ` · 句间隔 ${lastVoice.pause === null ? "—" : `${lastVoice.pause.toFixed(1)}秒`}，响度相对基线 ${lastVoice.volumeDelta === null ? "待测" : `${lastVoice.volumeDelta >= 0 ? "+" : ""}${lastVoice.volumeDelta.toFixed(1)}dB`}` : "";
      const applause = point.applause.map((item) => item.source === "demo" ? "模拟掌声" : "现场记录").join("、");
      return `<article class="coach-beat ${status[1]}"><div class="beat-status-row"><span class="beat-number">${String(point.index + 1).padStart(2, "0")}</span><span class="beat-status">${status[0]} · ${Math.round(score * 100)}%</span></div><strong>${esc(point.text)}</strong><p>${evidence}${esc(voiceCue)}</p>${applause ? `<small class="reaction-note">${esc(applause)}</small>` : ""}${state.session ? `<div class="beat-actions"><button type="button" data-react="${esc(point.id)}">＋ 记录掌声/反应</button></div>` : ""}</article>`;
    }).join("");
    host.querySelectorAll("[data-react]").forEach((button) => button.addEventListener("click", () => recordReaction(button.dataset.react)));
    updateCue(scores);
  }

  function updateCue(scores = pointScores()) {
    if (!state.points.length) return;
    const first = scores.find(({ score }) => score < 0.34);
    const candidateNow = scores.find(({ score }) => score >= 0.15 && score < 0.34);
    if (!state.session) return;
    if (!first) {
      setText("#coach-cue-title", "主要观点均出现较多线索");
      setText("#coach-cue-copy", "结束前可以用一句话总结核心结论，并留出停顿让听众消化。自动匹配仍需你确认意思是否准确。");
      return;
    }
    const position = first.point.index + 1;
    if (candidateNow && candidateNow.point.id === first.point.id) {
      setText("#coach-cue-title", `第 ${position} 个重点已有线索`);
      const lastVoice = first.point.evidence[first.point.evidence.length - 1]?.voice;
      const voiceAdvice = lastVoice?.volumeDelta !== null && lastVoice?.volumeDelta < -2 ? "这句音量低于本场基线，可在观点前停顿一下，再用更清楚的音量说结论。" : "可以在观点前停顿一下，再用一句简短结论明确说出。";
      setText("#coach-cue-copy", `考虑把观点“${first.point.text.slice(0, 45)}${first.point.text.length > 45 ? "…" : ""}”再明确说一次。${voiceAdvice}`);
    } else {
      setText("#coach-cue-title", `还需要再强调第 ${position} 个核心要点`);
      setText("#coach-cue-copy", `下一步可以直接说出：“${first.point.text.slice(0, 54)}${first.point.text.length > 54 ? "…" : ""}”。这是基于词汇重合的提醒，请按你的真实意思判断。`);
    }
    const history = historyForPoint(first.point);
    const slowHints = [];
    if (history.misses >= 2) slowHints.push(`历史练习中这个重点有 ${history.misses} 次未出现足够词汇线索，可提前安排一句明确总结`);
    if (history.observed > 0) slowHints.push(`历史有 ${history.observed} 次现场反应手动记录；讲完结论后可留出停顿观察听众`);
    if (slowHints.length) setText("#coach-cue-copy", `${slowHints.join("；")}。当前提示基于公开历史记录与词汇匹配，不代表因果或语义判定。`);
  }

  function getSpeakerId() { return $("#coach-speaker").value.trim().toLowerCase().replace(/\s+/g, "-") || "anonymous"; }
  function pointKey(point) { return normalize(point.text).slice(0, 90); }
  function historyForPoint(point) {
    const key = pointKey(point); const id = getSpeakerId();
    const matches = allSavedSessions().filter((session) => session.speakerId === id).flatMap((session) => (session.points || []).filter((item) => pointKey(item) === key));
    const misses = matches.filter((item) => item.score < 0.15).length;
    const applause = matches.flatMap((item) => item.applause || []);
    return { count: matches.length, misses, observed: applause.filter((x) => x.source === "observed").length, demo: applause.filter((x) => x.source === "demo").length };
  }

  function renderMemory() {
    const id = getSpeakerId();
    const sessions = allSavedSessions().filter((session) => session.speakerId === id);
    setText("#coach-memory-count", `${sessions.length} 次历史练习`);
    if (!sessions.length) {
      $("#coach-memory").innerHTML = `<p>尚无此记忆 ID 的历史记录。结束本场后将保存观点线索、声音趋势和人工标记的反应。</p>`;
      return;
    }
    const pace = sessions.map((item) => item.metrics?.pace).filter(Number.isFinite);
    const avgPace = pace.length ? Math.round(pace.reduce((a, b) => a + b, 0) / pace.length) : null;
    const recurring = new Map();
    sessions.forEach((session) => (session.points || []).forEach((point) => {
      const key = pointKey(point); const entry = recurring.get(key) || { text: point.text, miss: 0, applause: [] };
      if (point.score < 0.15) entry.miss += 1;
      entry.applause.push(...(point.applause || [])); recurring.set(key, entry);
    }));
    const repeated = [...recurring.values()].filter((item) => item.miss >= 2).sort((a, b) => b.miss - a.miss)[0];
    const reactions = sessions.flatMap((session) => (session.points || []).flatMap((point) => point.applause || []));
    const observed = reactions.filter((item) => item.source === "observed").length;
    const demo = reactions.filter((item) => item.source === "demo").length;
    const observedPoint = [...recurring.values()].filter((item) => item.applause.some((entry) => entry.source === "observed"))
      .sort((a, b) => b.applause.filter((entry) => entry.source === "observed").length - a.applause.filter((entry) => entry.source === "observed").length)[0];
    const notes = [];
    notes.push(`<p>历史 ${sessions.length} 场${avgPace ? `；近场平均语速约 ${avgPace} 字/分钟` : ""}。</p>`);
    if (repeated) notes.push(`<p class="memory-alert">反复遗漏提示：曾有 ${repeated.miss} 场未检测到“${esc(repeated.text.slice(0, 42))}${repeated.text.length > 42 ? "…" : ""}”的足够词汇线索。</p>`);
    if (observedPoint) notes.push(`<p>历史现场反应记录较多的重点：“${esc(observedPoint.text.slice(0, 42))}${observedPoint.text.length > 42 ? "…" : ""}”（${observedPoint.applause.filter((entry) => entry.source === "observed").length} 次手动观察）。这次讲完相近结论后可留出停顿观察听众；这是经验提示，不代表因果判断。</p>`);
    if (observed || demo) notes.push(`<p>观众反应标记：现场观察 ${observed} 次，模拟信号 ${demo} 次（分开统计，不视为自动识别掌声）。</p>`);
    if (avgPace) notes.push(`<p>本场可以先把主要观点写成一句短句，在观点后停顿，再补例子；对照历史语速观察节奏变化。</p>`);
    $("#coach-memory").innerHTML = notes.join("");
  }

  function snapshotMetrics() {
    const active = state.session?.segments || [];
    const windowSeconds = Math.min(30, Math.max(1, elapsed()));
    const cutoff = elapsed() - windowSeconds;
    const recent = active.filter((item) => item.at >= cutoff);
    const chars = recent.reduce((sum, item) => sum + wordUnits(item.text), 0);
    const pace = Math.round(chars * (60 / windowSeconds));
    const pitches = state.audioSamples.map((item) => item.pitch).filter((x) => x > 60 && x < 450);
    const pitch = pitches.length ? Math.round(pitches[pitches.length - 1]) : null;
    const baseline = state.voiceBaseline.length ? state.voiceBaseline.reduce((a, b) => a + b, 0) / state.voiceBaseline.length : null;
    return { pace: recent.length ? pace : 0, volume: state.currentVolume, volumeDelta: state.currentVolume !== null && baseline !== null ? state.currentVolume - baseline : null, pitch, pause: state.session?.segments.length ? Math.max(0, elapsed() - state.lastUtteranceAt) : null };
  }
  function wordUnits(text) {
    const cjk = (String(text).match(/[\u3400-\u9fff]/gu) || []).length;
    const latin = (String(text).match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
    return cjk + latin;
  }
  function updateMetrics() {
    if (!state.session) return;
    const metrics = snapshotMetrics();
    setText("#coach-pace", metrics.pace ? String(metrics.pace) : "0");
    const baseline = state.voiceBaseline.length ? state.voiceBaseline.reduce((a, b) => a + b, 0) / state.voiceBaseline.length : null;
    if (metrics.volume !== null) {
      const delta = baseline === null ? 0 : metrics.volume - baseline;
      setText("#coach-volume", `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} dB`);
      setText("#coach-volume-note", baseline === null ? "相对音量估计" : delta > 4 ? "高于本场说话基线" : delta < -4 ? "低于本场说话基线" : "接近本场说话基线");
    }
    setText("#coach-pitch", metrics.pitch ? `${metrics.pitch} Hz` : "—");
    setText("#coach-pause", metrics.pause === null ? "—" : `${metrics.pause.toFixed(1)} 秒`);
  }

  function estimatePitch(buffer, sampleRate) {
    let energy = 0;
    for (let i = 0; i < buffer.length; i += 1) energy += buffer[i] * buffer[i];
    if (energy / buffer.length < 0.000025) return null;
    const minLag = Math.max(2, Math.floor(sampleRate / 400));
    const maxLag = Math.min(Math.floor(sampleRate / 65), Math.floor(buffer.length / 2));
    let bestLag = -1; let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - lag; i += 2) correlation += buffer[i] * buffer[i + lag];
      if (correlation > best) { best = correlation; bestLag = lag; }
    }
    return bestLag > 0 ? sampleRate / bestLag : null;
  }

  function startAudioAnalysis(stream) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("此浏览器不支持 Web Audio 音量分析");
    state.audioContext = new Context();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 4096; state.analyser.smoothingTimeConstant = 0.25;
    source.connect(state.analyser);
    const data = new Float32Array(state.analyser.fftSize);
    const tick = () => {
      if (!state.session || !state.analyser) return;
      state.analyser.getFloatTimeDomainData(data);
      let energy = 0; for (let i = 0; i < data.length; i += 1) energy += data[i] * data[i];
      const rms = Math.sqrt(energy / data.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -90;
      if (rms > 0.008) {
        if (state.voiceBaseline.length < 40) state.voiceBaseline.push(db);
        state.currentVolume = db;
      } else if (state.lastUtteranceAt) {
        state.currentVolume = db;
      }
      const now = performance.now();
      if (now - (state.lastPitchAt || 0) > 850) {
        const pitch = estimatePitch(data, state.audioContext.sampleRate);
        state.currentPitch = pitch;
        state.audioSamples.push({ at: elapsed(), rms, pitch }); state.audioSamples = state.audioSamples.slice(-600);
        state.lastPitchAt = now;
      }
      updateMetrics();
      requestAnimationFrame(tick);
    };
    state.audioContext.resume().catch(() => {});
    requestAnimationFrame(tick);
  }

  function getSpeechRecognition() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function startSpeechRecognition() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setText("#coach-speech-support", "此浏览器没有语音识别；请使用下方输入框记录语句。");
      return;
    }
    const recognition = new Recognition();
    state.speech = recognition;
    recognition.lang = $("#coach-language").value; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const item = event.results[i]; const text = item[0]?.transcript?.trim();
        if (!text) continue;
        if (item.isFinal) addSegment(text, "browser-asr"); else interim += text;
      }
      if (interim) setText("#coach-transcript", `${transcriptText()} ${interim}`.trim());
      state.speechOn = true;
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") setText("#coach-speech-support", `语音识别状态：${event.error}；可手动输入。`);
    };
    recognition.onend = () => {
      if (state.session && state.speechOn) { try { recognition.start(); } catch { /* Restart may be rejected while already transitioning. */ } }
    };
    try {
      recognition.start();
      setText("#coach-speech-support", "语音识别已启动；结果可能由浏览器语音服务处理。");
    } catch {
      setText("#coach-speech-support", "语音识别未启动；可手动输入语句。");
    }
  }

  function addSegment(text, source = "manual") {
    const clean = String(text || "").trim();
    if (!clean || !state.session) return;
    const at = elapsed();
    const metrics = snapshotMetrics();
    const segment = { at: Number(at.toFixed(1)), text: clean, source, voice: metrics, visual: currentVisualCue() };
    state.session.segments.push(segment);
    state.lastUtteranceAt = at; state.lastSpeechAt = at;
    const scores = pointScores();
    scores.forEach(({ point }) => {
      const segmentScore = scorePoint(point, clean);
      if (segmentScore >= 0.12) point.evidence.push({ at: segment.at, text: clean, score: Number(segmentScore.toFixed(3)), visual: segment.visual });
    });
    state.session.timeline.push({ at: segment.at, type: "speech", text: clean, activePoint: scores.find(({ score }) => score < 0.34)?.point?.id || null, scores: scores.map(({ point, score }) => ({ id: point.id, score: Number(score.toFixed(3)) })), voice: metrics, visual: segment.visual });
    updateTranscript(); renderPoints(); updateMetrics();
  }
  function updateTranscript() {
    const segments = state.session?.segments || [];
    const last = segments.slice(-5).map((item) => `${stamp(item.at)} ${item.text}`).join("\n");
    setText("#coach-transcript", last || "等待语音识别…");
    setText("#coach-transcript-count", `${segments.length} 句`);
  }

  function currentVisualCue() {
    return state.visualSummary.length ? state.visualSummary[state.visualSummary.length - 1] : { face: "未检测", gesture: "未检测" };
  }
  function setVisualStatus(text, cue = null) {
    setText("#visual-status", text);
    if (cue) setText("#visual-now", cue);
  }

  async function loadVision() {
    if (state.faceTask && state.poseTask) { runVisionLoop(); return; }
    if (state.visionLoading) return;
    state.visionLoading = true;
    setText("#coach-model-status", "正在加载本地视觉模型（首次加载会下载模型文件）…");
    try {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
      const files = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      const faceModel = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
      const poseModel = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
      state.faceTask = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: faceModel, delegate: "CPU" }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
      state.poseTask = await vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: poseModel, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1 });
      setText("#coach-model-status", "视觉模型已就绪；面部动作与手腕移动在本机抽样分析。");
      setVisualStatus("视觉观察中", "等待有效人脸与身体关键点。分数表示可见动作强度，不代表情绪或得当程度。");
      runVisionLoop();
    } catch (error) {
      setText("#coach-model-status", `视觉模型未能加载：${error.message}；本场仍可用语音和手动转写。`);
      setVisualStatus("模型不可用", "无法取得视觉模型；请确保网络允许加载 MediaPipe CDN 和模型文件。摄像头画面仍只显示在本机浏览器。");
    } finally { state.visionLoading = false; }
  }

  function runVisionLoop() {
    if (state.visualRaf) cancelAnimationFrame(state.visualRaf);
    const video = $("#coach-video"); const canvas = $("#coach-overlay"); const context = canvas.getContext("2d");
    const loop = () => {
      if (!state.session || !state.faceTask || !state.poseTask) return;
      if (video.readyState >= 2 && performance.now() - state.lastVisionAt >= 400) {
        state.lastVisionAt = performance.now();
        try {
          const now = performance.now();
          const face = state.faceTask.detectForVideo(video, now);
          const pose = state.poseTask.detectForVideo(video, now);
          const categories = face.faceBlendshapes?.[0]?.categories || [];
          const get = (name) => categories.find((item) => item.categoryName === name)?.score || 0;
          const smile = Math.max(get("mouthSmileLeft"), get("mouthSmileRight"));
          const brow = Math.max(get("browInnerUp"), get("browOuterUpLeft"), get("browOuterUpRight"));
          const jaw = get("jawOpen");
          const faceCue = smile > 0.48 ? "检测到嘴角上提动作" : brow > 0.52 ? "检测到眉部上提动作" : jaw > 0.58 ? "检测到张口幅度较大" : face.faceLandmarks?.length ? "检测到面部，当前动作幅度较小" : "未检测到清晰人脸";
          const landmarks = pose.landmarks?.[0] || [];
          const left = landmarks[15]; const right = landmarks[16];
          let movement = 0;
          if (left && right && left.visibility > .25 && right.visibility > .25) {
            const prev = state.previousWrists;
            if (prev) movement = Math.max(Math.hypot(left.x - prev.left.x, left.y - prev.left.y), Math.hypot(right.x - prev.right.x, right.y - prev.right.y));
            state.previousWrists = { left: { x: left.x, y: left.y }, right: { x: right.x, y: right.y } };
          }
          const gestureCue = movement > .035 ? "观察到手腕位置明显变化" : left && right ? "手腕位置相对稳定" : "手部未完整进入画面";
          const activePoint = pointScores().find(({ score }) => score < .34)?.point;
          const cue = { at: Number(elapsed().toFixed(1)), face: faceCue, gesture: gestureCue, smile: Number(smile.toFixed(2)), brow: Number(brow.toFixed(2)), jaw: Number(jaw.toFixed(2)), wristMovement: Number(movement.toFixed(3)), pointId: activePoint?.id || null };
          state.visualSummary.push(cue); state.visualSummary = state.visualSummary.slice(-300);
          setVisualStatus("视觉观察中", `${faceCue}；${gestureCue}。这是动作线索，是否适合当前重点需要结合语境复核。`);
          if (state.session && Math.round(elapsed()) % 5 === 0) {
            const previous = state.session.timeline[state.session.timeline.length - 1];
            if (!previous || previous.type !== "visual" || elapsed() - previous.at > 4) state.session.timeline.push({ at: Number(elapsed().toFixed(1)), type: "visual", pointId: cue.pointId, visual: cue });
          }
          canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 360;
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "rgba(91,210,192,.85)";
          landmarks.forEach((point, index) => {
            if ([11, 12, 13, 14, 15, 16, 23, 24].includes(index) && point.visibility > .3) {
              context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, index === 15 || index === 16 ? 7 : 4, 0, Math.PI * 2); context.fill();
            }
          });
        } catch (error) { setVisualStatus("视觉分析暂不可用", error.message); }
      }
      state.visualRaf = requestAnimationFrame(loop);
    };
    state.visualRaf = requestAnimationFrame(loop);
  }

  async function shareScreen() {
    if (!state.session) { setText("#screen-status", "请先开始演讲"); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { setText("#screen-status", "浏览器不支持屏幕共享"); return; }
    try {
      state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      $("#screen-video").srcObject = state.screenStream;
      setText("#screen-status", "正在读取");
      state.screenStream.getVideoTracks()[0].addEventListener("ended", stopScreen);
      if (!state.ocrWorker) loadOcrWorker().catch((error) => setText("#screen-status", `OCR 无法加载：${error.message}`));
      state.ocrTimer = setInterval(() => runOcr().catch((error) => setText("#screen-status", `识别失败：${error.message}`)), 12000);
      runOcr().catch(() => {});
    } catch (error) { setText("#screen-status", error.name === "NotAllowedError" ? "未授权屏幕共享" : `共享失败：${error.message}`); }
  }
  function stopScreen() {
    if (state.ocrTimer) clearInterval(state.ocrTimer); state.ocrTimer = null;
    state.screenStream?.getTracks().forEach((track) => track.stop()); state.screenStream = null;
    $("#screen-video").srcObject = null; setText("#screen-status", "未共享");
  }
  async function loadOcrWorker() {
    if (state.ocrWorker) return state.ocrWorker;
    if (state.ocrLoading) return state.ocrLoading;
    setText("#screen-status", "正在加载 OCR 文字识别…");
    state.ocrLoading = (async () => {
      const tesseract = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
      state.ocrWorker = await tesseract.createWorker(["chi_sim", "eng"]);
      setText("#screen-status", "OCR 已就绪");
      return state.ocrWorker;
    })();
    try { return await state.ocrLoading; }
    finally { state.ocrLoading = null; }
  }
  function slideFit(text, point) {
    if (!point || !text) return null;
    const slides = grams(text); const target = point.features;
    let matched = 0; target.forEach((part) => { if (slides.has(part)) matched += 1; });
    return target.size ? matched / target.size : 0;
  }
  async function runOcr() {
    if (!state.screenStream || state.ocrBusy || !$("#screen-video").videoWidth) return;
    state.ocrBusy = true;
    try {
      if (!state.ocrWorker) await loadOcrWorker();
      const video = $("#screen-video"); const canvas = document.createElement("canvas");
      const ratio = Math.min(1, 1280 / video.videoWidth); canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = await state.ocrWorker.recognize(canvas);
      const text = (result.data.text || "").replace(/\s+/g, " ").trim();
      const scores = pointScores(); const active = scores.find(({ score }) => score < .34)?.point;
      const fit = slideFit(text, active);
      const prior = state.session.slides[state.session.slides.length - 1];
      const changed = Boolean(text) && (!prior || textSimilarity(text, prior.text) < .72);
      const pageNo = prior ? prior.pageNo + (changed ? 1 : 0) : (text ? 1 : 0);
      const event = { at: Number(elapsed().toFixed(1)), text: text.slice(0, 1000), pointId: active?.id || null, lexicalFit: fit === null ? null : Number(fit.toFixed(3)), changed, pageNo };
      state.session.timeline.push({ ...event, type: "slide" }); state.session.slides.push(event);
      setText("#screen-slide-label", `${changed ? `检测到页面变化 · 第 ${pageNo} 页` : `第 ${pageNo || "?"} 页文字抽样`} · ${stamp(event.at)}`);
      setText("#screen-current-text", text || "未识别出文字；此页可能以图像或图表为主。");
      setText("#screen-match-note", fit === null ? "等待当前核心观点。OCR 仅抽取文字，不判断内容是否真正支持观点。" : `与下一待讲重点的词汇重合约 ${Math.round(fit * 100)}%；这不是语义判定。`);
      setText("#screen-status", "已读取一帧");
      $("#screen-history").insertAdjacentHTML("afterbegin", `<div class="screen-history-item"><b>${stamp(event.at)}${changed ? ` · 第${pageNo}页变化` : ""}</b><span>${esc(text.slice(0, 115) || "未识别到文字")}</span></div>`);
      $("#screen-history").querySelectorAll(".screen-history-item").forEach((node, index) => { if (index > 4) node.remove(); });
    } finally { state.ocrBusy = false; }
  }

  function recordReaction(pointId) {
    if (!state.session) return;
    const point = state.points.find((item) => item.id === pointId);
    if (!point) return;
    const source = $("#coach-reaction-mode").value;
    const event = { at: Number(elapsed().toFixed(1)), source };
    point.applause.push(event);
    state.session.timeline.push({ ...event, type: "reaction", pointId, pointText: point.text });
    renderPoints(); renderMemory();
  }

  async function startSession() {
    if (!$("#coach-consent").checked || !state.points.length || state.session) return;
    state.points = state.points.map((point) => ({ ...point, evidence: [], maxScore: 0, applause: [] }));
    state.audioSamples = []; state.voiceBaseline = []; state.visualSummary = []; state.previousWrists = null;
    state.lastUtteranceAt = 0; state.currentVolume = null; state.currentPitch = null;
    const topic = $("#coach-topic").value.trim() || "未命名演讲";
    const sessionId = `live-${Date.now()}`;
    state.session = { id: sessionId, topic, caseId: state.selectedCase, speakerId: getSpeakerId(), startedAt: Date.now(), endedAt: null, segments: [], timeline: [], slides: [], points: [], metrics: {}, report: "" };
    $("#coach-report").hidden = true;
    $("#screen-history").innerHTML = "";
    $("#screen-video").srcObject = null;
    setText("#coach-status", "正在申请摄像头和麦克风…");
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 540 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      $("#coach-video").srcObject = state.cameraStream;
      startVideoRecording(state.cameraStream, sessionId);
      $("#coach-camera-placeholder").hidden = true;
      startAudioAnalysis(state.cameraStream);
      setText("#coach-status", "演讲进行中"); $("#coach-led").classList.add("active");
      $("#coach-start").disabled = true; $("#coach-stop").disabled = false;
      state.speechOn = true; startSpeechRecognition(); loadVision();
      state.timer = setInterval(() => { setText("#coach-timer", stamp(elapsed())); updateMetrics(); }, 500);
      renderPoints(); renderMemory();
    } catch (error) {
      state.cameraStream?.getTracks().forEach((track) => track.stop()); state.cameraStream = null;
      $("#coach-video").srcObject = null;
      state.session = null; setText("#coach-status", `无法开始：${error.message}`);
      $("#coach-start").disabled = false;
    }
  }

  function makeReport(session) {
    const minutes = Math.max(0.1, (session.endedAt - session.startedAt) / 60000);
    const chars = session.segments.reduce((sum, item) => sum + wordUnits(item.text), 0);
    const scores = session.points.map((point) => ({ ...point, score: scorePoint(point, session.segments.map((item) => item.text).join(" ")) }));
    const full = scores.filter((point) => point.score >= .34).length;
    const partial = scores.filter((point) => point.score >= .15 && point.score < .34).length;
    const missing = scores.filter((point) => point.score < .15).length;
    const pace = Math.round(chars / minutes);
    const audio = session.audio || [];
    const pitches = audio.map((item) => item.pitch).filter((item) => item > 60 && item < 450);
    const pitchRange = pitches.length ? `${Math.round(Math.min(...pitches))}–${Math.round(Math.max(...pitches))} Hz` : "样本不足";
    const volume = audio.filter((item) => item.rms > .008).map((item) => item.rms);
    const volumeRange = volume.length ? `${Math.min(...volume).toFixed(3)}–${Math.max(...volume).toFixed(3)} RMS` : "样本不足";
    const slides = session.slides || [];
    const visual = session.visual || [];
    const reactions = scores.flatMap((point) => point.applause || []);
    const observed = reactions.filter((item) => item.source === "observed").length;
    const demo = reactions.filter((item) => item.source === "demo").length;
    const lines = [
      `《${session.topic}》现场演讲复盘`,
      `时间：${new Date(session.startedAt).toLocaleString("zh-CN")}；时长约 ${Math.round(minutes * 10) / 10} 分钟；记忆 ID：${session.speakerId}`,
      "",
      `一、观点推进：本次共 ${session.points.length} 个核心观点。词汇线索较多 ${full} 个，出现部分线索 ${partial} 个，未发现足够词汇线索 ${missing} 个。该结果来自提纲与转写的词汇重合，不能单独证明语义已经传达。`,
      ...scores.map((point, index) => `  ${index + 1}. ${point.score >= .34 ? "候选覆盖" : point.score >= .15 ? "部分线索" : "需复核/补充"}（${Math.round(point.score * 100)}%）：${point.text}${point.evidence?.length ? `；证据：${point.evidence.slice(-3).map((entry) => `“${entry.text}”`).join("、")}${point.evidence[point.evidence.length - 1].visual ? `；相邻动作线索：${point.evidence[point.evidence.length - 1].visual.face}，${point.evidence[point.evidence.length - 1].visual.gesture}` : ""}${Number.isFinite(point.evidence[point.evidence.length - 1].voice?.volumeDelta) ? `；该句响度相对基线 ${point.evidence[point.evidence.length - 1].voice.volumeDelta.toFixed(1)} dB` : ""}` : "；未记录到对应转写证据"}`),
      "",
      `二、声音节奏：估算语速约 ${pace} 字/分钟；采集的音高大致 ${pitchRange}；音量 RMS 范围 ${volumeRange}。观点卡片会附上对应句子的相对响度和句间隔，供检查重点是否通过声音突出。声音强弱与音高为浏览器实时音频抽样，不等同于专业声学测量；停顿以转写片段间隔粗略估计。`,
      `三、表情与动作：累计 ${visual.length} 条视觉动作观察。${visual.length ? `最近观察为“${visual[visual.length - 1].face}；${visual[visual.length - 1].gesture}”。` : "本场没有可用视觉观察。"}模型记录面部动作类别与手腕位移，不判断表情/动作是否得当；请对照对应观点人工回看。`,
      `四、PPT 配合：读取到 ${slides.length} 次 OCR 抽样，约检测到 ${slides.filter((slide) => slide.changed).length} 次页面变化。${slides.length ? slides.filter((slide) => slide.changed).map((slide) => `第${slide.pageNo}页约在 ${stamp(slide.at)} 切换（与下一待讲重点词汇重合 ${slide.lexicalFit === null ? "未比较" : `${Math.round(slide.lexicalFit * 100)}%`}）`).join("；") : "本场未共享投影。"}抽帧间隔约 12 秒，因此切换时刻只是近似位置；文字重合不能判断图表含义、切换是否恰当或页面是否真正支持观点。`,
      `五、观众反应：现场观察标记 ${observed} 次；模拟标记 ${demo} 次。两类均为演讲者手动记录，并非自动掌声识别。`,
      "",
      `建议：${missing ? `下次把未发现足够线索的第 ${scores.findIndex((point) => point.score < .15) + 1} 个观点改写成一句易复述的结论，并在演讲提纲中安排明确强调。` : "主要观点均出现较多词汇线索；可以复听关键观点段，确认意思、例子与总结一致。"}${slides.length ? " PPT 节奏与观点对应仍需结合录像逐段确认。" : " 若要检查 PPT 配合，可在演讲期间共享幻灯片窗口。"}`,
      "",
      "数据范围：本次已授权公开上传录像（含人脸和声音）、转写内容及分析报告；所有访客均可查看。当前云端同步状态会显示在复盘列表中。浏览器语音识别可能使用在线服务。",
    ];
    return { text: lines.join("\n"), scores, pace, pitchRange, volumeRange, observed, demo };
  }

  async function stopSession() {
    if (!state.session) return;
    setText("#coach-status", "正在保存录像和复盘…"); state.speechOn = false;
    try { state.speech?.stop(); } catch { /* Already stopped. */ }
    state.speech = null;
    if (state.timer) clearInterval(state.timer); state.timer = null;
    if (state.visualRaf) cancelAnimationFrame(state.visualRaf); state.visualRaf = null;
    stopScreen();
    let videoSaved = false;
    let videoError = "";
    let recordingResult = null;
    try { recordingResult = await finishVideoRecording(); videoSaved = recordingResult.localReady; if (!videoSaved) videoError = state.recordingLocalError; }
    catch (error) { videoError = error.message || "录像保存失败"; state.session.videoId = null; }
    state.cameraStream?.getTracks().forEach((track) => track.stop()); state.cameraStream = null;
    $("#coach-video").srcObject = null; $("#coach-camera-placeholder").hidden = false;
    if (state.audioContext) { await state.audioContext.close().catch(() => {}); state.audioContext = null; }
    state.session.endedAt = Date.now(); state.session.points = state.points.map((point) => ({ id: point.id, text: point.text, score: scorePoint(point, transcriptText()), evidence: point.evidence, applause: point.applause }));
    state.session.audio = state.audioSamples; state.session.visual = state.visualSummary;
    state.session.videoSaved = videoSaved;
    state.session.videoChunks = recordingResult?.chunks || 0;
    state.session.cloudVideoReady = Boolean(recordingResult?.cloudReady);
    if (state.recordingCloudError) state.session.cloudUploadError = state.recordingCloudError;
    const summary = makeReport(state.session); state.session.report = summary.text;
    const saved = { ...state.session, metrics: { pace: summary.pace, pitchRange: summary.pitchRange, volumeRange: summary.volumeRange } };
    const allSessions = [saved, ...readSessions()];
    const sessions = allSessions.slice(0, MAX_SESSIONS);
    allSessions.slice(MAX_SESSIONS).forEach((item) => { if (item.videoId) deleteRecording(item.videoId).catch(() => {}); });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); }
    catch (error) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 5).map((item) => ({ ...item, audio: [], visual: (item.visual || []).slice(-80), timeline: (item.timeline || []).slice(-250) })))); }
      catch { setText("#coach-status", `报告生成成功，但浏览器存储空间不足：${error.message}`); }
    }
    let cloudSaved = false;
    try {
      await saveCloudSession(saved);
      cloudSaved = true;
      saved.cloudStored = true;
      saved.cloudUploadError = "";
      state.remoteSessions = [saved, ...state.remoteSessions.filter((item) => item.id !== saved.id)].slice(0, 100);
      const refreshed = [saved, ...readSessions().filter((item) => item.id !== saved.id)].slice(0, MAX_SESSIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
    } catch (error) {
      saved.cloudStored = false;
      saved.cloudUploadError = state.recordingCloudError || error.message || "云端同步失败";
      const refreshed = readSessions().map((item) => item.id === saved.id ? saved : item);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed)); } catch { /* Keep the in-memory report visible. */ }
    }
    state.session = null; state.audioSamples = []; state.voiceBaseline = []; state.visualSummary = []; state.previousWrists = null;
    state.points = state.points.map((point, index) => ({ ...point, index }));
    setText("#coach-status", cloudSaved ? (saved.cloudVideoReady ? "已保存并公开同步" : "报告已公开；录像待上传") : (videoSaved ? "录像已保存在本设备" : `复盘已保存；录像未保存：${videoError}`)); $("#coach-led").classList.remove("active");
    $("#coach-start").disabled = !$("#coach-consent").checked; $("#coach-stop").disabled = true;
    $("#coach-report").hidden = false; $("#coach-report-text").value = summary.text;
    renderReplay(saved); renderSessions(); renderMemory();
    setText("#coach-cue-title", "本场复盘已保存");
    setText("#coach-cue-copy", cloudSaved ? (saved.cloudVideoReady ? "本场录像、报告和分析时间线已上传到公开云端，其他电脑也会看到这条记录。" : `报告已上传到公开云端；录像上传未完成${saved.cloudUploadError ? `：${saved.cloudUploadError}` : ""}。`) : `本场记录暂存在本设备，未能同步到公开云端${saved.cloudUploadError ? `：${saved.cloudUploadError}` : ""}。请稍后重试或下载录像。`);
    $("#coach-report").scrollIntoView({ behavior: "smooth", block: "start" });
    refreshCloudSessions();
  }

  function renderReplay(session) {
    const points = session.points || [];
    const timeline = session.timeline || [];
    const content = points.map((point, index) => `<article class="replay-point"><b>${index + 1}. ${esc(point.text)}</b><span>${point.score >= .34 ? "候选覆盖" : point.score >= .15 ? "部分线索" : "需复核"} · ${Math.round(point.score * 100)}%</span><p>${(point.evidence || []).slice(-3).map((entry) => `${stamp(entry.at)}「${esc(entry.text)}」`).join("；") || "无转写证据"}</p></article>`).join("");
    const events = timeline.slice(-60).map((item) => `<div class="replay-event"><time>${stamp(item.at)}</time><span>${item.type === "speech" ? `语音：${esc(item.text)}` : item.type === "slide" ? `PPT OCR：${esc(item.text || "无文字")}` : item.type === "reaction" ? `${item.source === "demo" ? "模拟" : "现场观察"}反应：${esc(item.pointText || "观点")}` : `视觉：${esc(item.visual?.face || "")}；${esc(item.visual?.gesture || "")}`}</span></div>`).join("");
    $("#coach-replay-detail").innerHTML = `<section class="recording-replay"><div class="coach-panel-head"><div><p class="eyebrow">SESSION VIDEO</p><h3>演讲录像</h3></div><div class="report-actions"><button id="coach-sync-session" class="secondary-button" ${session.videoId && !session.cloudVideoReady ? "" : "hidden"}>重试公开同步</button><button id="coach-download-video" class="secondary-button">下载录像</button></div></div><video id="coach-replay-video" controls playsinline preload="metadata" hidden></video><p id="coach-replay-video-note" class="quiet-copy" hidden></p></section><div class="replay-grid"><div><h3>观点证据</h3>${content || "无观点"}</div><div><h3>时间线</h3><div class="replay-events">${events || "无事件"}</div></div></div>`;
    const video = $("#coach-replay-video");
    const note = $("#coach-replay-video-note");
    const downloadButton = $("#coach-download-video");
    if (state.replayUrl) URL.revokeObjectURL(state.replayUrl);
    state.replayUrl = null; video.removeAttribute("src"); video.load();
    video.hidden = !session.videoId; note.hidden = !session.videoId;
    downloadButton.disabled = !session.videoId;
    if (!session.videoId) { note.textContent = "此历史记录没有录像。"; return; }
    if (session.cloudVideoReady) {
      video.hidden = false; note.hidden = false;
      video.src = `${CLOUD_API}/api/sessions/${encodeURIComponent(session.id)}/video`;
      note.textContent = "录像已存入公开云端，其他设备可直接播放。";
      return;
    }
    note.textContent = "正在读取本机录像…";
    loadRecording(session.videoId, session.videoChunks).then((blob) => {
      if (!blob) { note.textContent = "此设备上找不到录像文件；录像不会随文字报告自动同步。"; return; }
      state.replayUrl = URL.createObjectURL(blob); video.src = state.replayUrl;
      note.textContent = `录像已保存在本机浏览器 · ${Math.round(blob.size / 1024 / 1024)} MB${session.cloudUploadError ? ` · 云端同步失败：${session.cloudUploadError}` : ""}`;
    }).catch((error) => { note.textContent = `读取录像失败：${error.message}`; });
  }
  function renderSessions() {
    const sessions = allSavedSessions().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 100);
    setText("#saved-session-count", `${sessions.length} 场`);
    const host = $("#saved-session-list");
    if (!sessions.length) { host.innerHTML = `<p class="quiet-copy">连接公开云端后，这里会显示所有设备保存的演讲复盘。</p>`; return; }
    host.innerHTML = sessions.map((session) => `<button class="saved-session" type="button" data-session="${esc(session.id)}"><span><b>${esc(session.topic)}</b><small>${new Date(session.startedAt).toLocaleString("zh-CN")} · ${esc(session.speakerId)}${session.cloudVideoReady ? " · 公开录像" : session.videoId ? " · 本机录像" : ""}${session.cloudStored === false ? " · 仅本机" : ""}</small></span><span>查看复盘 ↗</span></button>`).join("");
    host.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => {
      const session = sessions.find((item) => item.id === button.dataset.session); if (!session) return;
      $("#coach-report").hidden = false; $("#coach-report-text").value = session.report || "此旧记录没有报告正文。"; renderReplay(session);
      $("#coach-report").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function downloadSessionVideo(session) {
    if (!session?.videoId) return;
    const blob = session.cloudVideoReady
      ? await (await cloudFetch(`/api/sessions/${encodeURIComponent(session.id)}/video`)).blob()
      : await loadRecording(session.videoId, session.videoChunks);
    if (!blob) { setText("#coach-replay-video-note", "此设备上找不到录像文件。"); return; }
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    const safeTopic = String(session.topic || "speech").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 48);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `talkeval-${safeTopic}.${extension}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function currentReportSession() {
    const report = $("#coach-report-text").value;
    const sessions = allSavedSessions();
    return sessions.find((item) => item.report === report) || sessions[0];
  }

  $("#review-tab").addEventListener("click", () => switchView("review"));
  $("#live-tab").addEventListener("click", () => switchView("live"));
  $("#coach-case").addEventListener("change", (event) => chooseCase(event.target.value));
  $("#coach-outline").addEventListener("change", (event) => setPoints(event.target.value.split(/\n+/).map((text) => ({ text }))));
  $("#coach-topic").addEventListener("input", updateStartAvailability);
  $("#coach-speaker").addEventListener("input", renderMemory);
  $("#coach-consent").addEventListener("change", updateStartAvailability);
  $("#coach-start").addEventListener("click", startSession);
  $("#coach-stop").addEventListener("click", stopSession);
  $("#share-screen").addEventListener("click", shareScreen);
  $("#coach-add-text").addEventListener("click", () => {
    const input = $("#coach-manual-text"); addSegment(input.value, "manual"); input.value = ""; input.focus();
  });
  $("#coach-manual-text").addEventListener("keydown", (event) => { if (event.key === "Enter") $("#coach-add-text").click(); });
  $("#coach-copy-report").addEventListener("click", () => navigator.clipboard?.writeText($("#coach-report-text").value).then(() => setText("#coach-cue-copy", "报告已复制。")).catch(() => {}));
  $("#coach-download-report").addEventListener("click", () => download("talkeval-live-report.txt", $("#coach-report-text").value, "text/plain;charset=utf-8"));
  $("#coach-replay-detail").addEventListener("click", (event) => {
    if (event.target.closest("#coach-download-video")) downloadSessionVideo(currentReportSession()).catch((error) => setText("#coach-replay-video-note", `下载失败：${error.message}`));
    if (event.target.closest("#coach-sync-session")) {
      const button = event.target.closest("#coach-sync-session");
      const session = currentReportSession();
      button.disabled = true; button.textContent = "正在上传…";
      syncSavedSession(session).then(() => setText("#coach-cue-copy", "录像和报告已同步到公开云端，其他设备现在可以查看。"))
        .catch((error) => { button.disabled = false; button.textContent = "重试公开同步"; setText("#coach-replay-video-note", `同步失败：${error.message}`); });
    }
  });
  $("#coach-download-json").addEventListener("click", () => {
    const session = currentReportSession();
    if (session) download("talkeval-live-session.json", JSON.stringify(session, null, 2), "application/json;charset=utf-8");
  });

  loadCases().then(renderSessions);
  refreshCloudSessions();
  updateStartAvailability();
  renderMemory();
})();
