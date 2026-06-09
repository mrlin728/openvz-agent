// voice-core.js —— 语音共享机制引擎（mechanism，不含模式策略）
//
// 职责：点云球渲染 + 麦克风采集 + 云端 ASR 传输/转录引擎 + 会话生命周期。
// 不含任何「怎么用」的策略——自动发送断句、barge-in 打断检测、PTT 门控分别在
// voice-continuous.js / voice-ptt.js。两个模式共用同一个 core 会话（保持「叠加」语义）。
//
// 模式通过下列钩子注入策略（由编排层 voice-panel.js 组装、可组合多个模式）：
//   setOnFrame(vol)          每帧音量回调（barge-in 检测 / 活动计时）
//   setOnTranscript(msg,fin) 收到一条 transcript 后的策略（断句/发送触发）
//   setOnSessionStop()       会话停止时各模式清理自己的计时器/标志
//   setOnSuspendForTTS()     进入 TTS 挂起时各模式重置检测状态
//   setOnResume(fromBargein) 会话恢复时各模式重置状态/启动续播计时
//   setOnState()             会话状态变化后编排层同步 UI（如按钮高亮）
//
// 点云算法移植自 ACUI (Remix)/Voice Component.html

// ─── 球面采样（Fibonacci） ───
function fibSphere(n, radius) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r * radius, y: y * radius, z: Math.sin(theta) * r * radius });
  }
  return pts;
}

const BASE_PTS  = fibSphere(3200, 1.0);
const BASE_PTS2 = fibSphere(1200, 0.88);

// ─── 正弦噪声 ───
function sn(x, y, z, t) {
  return (
    Math.sin(x * 2.3 + t * 1.1) * Math.cos(y * 1.9 + t * 0.8) * 0.38 +
    Math.sin(y * 3.1 + t * 1.4) * Math.cos(z * 2.7 + t * 0.6) * 0.30 +
    Math.sin(z * 1.7 + t * 0.9) * Math.cos(x * 3.3 + t * 1.2) * 0.30 +
    Math.sin(x * 5.1 + y * 4.3 + t * 2.1) * 0.14
  );
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpArr(a, b, t) { return a.map((v, i) => lerp(v, b[i], t)); }

// ─── 状态配置 ───
// idle = 麦克风关闭（灰色）  listening = 麦克风开启待命（白色）
// recognizing = 正在识别（蓝色）  done = 识别完成（绿色，2s 后回 listening）
// speaking = AI 正在说话（紫色，可打断）
const STATE_CFG = {
  idle:        { amp: 0.003, spd: 0.10, r: [50,68,80],    g: [50,68,80],    b: [55,73,85]   },
  listening:   { amp: 0.055, spd: 0.75, r: [185,215,245], g: [185,215,245], b: [195,225,255] },
  recognizing: { amp: 0.55,  spd: 4.50, r: [25,75,165],   g: [95,155,230],  b: [195,230,255] },
  done:        { amp: 0.10,  spd: 1.20, r: [30,105,65],   g: [145,200,135], b: [45,90,60]   },
  processing:  { amp: 0.15,  spd: 1.10, r: [100,60,200],  g: [80,60,180],   b: [220,190,255] },
  error:       { amp: 0.10,  spd: 0.70, r: [200,240,255], g: [20,30,40],    b: [20,30,40]   },
  event:       { amp: 0.60,  spd: 4.00, r: [255,200,50],  g: [200,160,30],  b: [50,80,150]   },
  speaking:    { amp: 0.09,  spd: 1.00, r: [130,95,185],  g: [105,80,170],  b: [225,200,255] },
};

// 共享阈值：core 的 speaking→recognizing 视觉分支 + continuous 的打断检测都用它。
// 放 core 作单一来源，continuous 从这里 import，避免两处各写一份。
export const BARGEIN_THRESHOLD = 0.09; // 振幅阈值（高于环境噪声和 AEC 残留）

const CLOUD_WS_URL  = 'ws://127.0.0.1:3721/voice/cloud';
const VOICE_PROVIDER_KEY = 'bailongma-voice-provider';

// 4096 samples @ 16kHz = 256ms/块；保留 1500ms ≈ 6 块（打断预缓冲上限）
const BARGEIN_PRE_BUFFER_MS = 1500;
const BARGEIN_MAX_CHUNKS    = Math.ceil(BARGEIN_PRE_BUFFER_MS * 16000 / 1000 / 4096);
// 重连预缓冲上限 ≈8s，防长断连无限堆积
const RECONNECT_MAX_CHUNKS  = Math.ceil(8000 * 16000 / 1000 / 4096);

export function createVoiceCore({ canvas, transcript, getChatInput, getSendMessage, getLang }) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, cx = 0, cy = 0, scale = 0;

  function resizeCanvasToDisplay() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const nextW = Math.max(1, Math.round(rect.width * dpr));
    const nextH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    W = nextW; H = nextH; cx = W / 2; cy = H / 2;
    scale = Math.min(W, H) * 0.34;
  }

  // ─── 渲染状态 ───
  let sk = 'idle';
  let animState = {
    amp: STATE_CFG.idle.amp, spd: STATE_CFG.idle.spd,
    col: [STATE_CFG.idle.r, STATE_CFG.idle.g, STATE_CFG.idle.b],
    t: 0, rotY: 0, rotX: 0.25,
  };
  let rafId = null;
  let eventFlashCount = 0;
  let doneTimer = null;

  // ─── 模式注入钩子（由编排层组装，可组合多个模式） ───
  let onFrame = null;        // (vol) 每帧：barge-in 检测 / 活动计时
  let onTranscript = null;   // (msg, isFinal) 收到 transcript 后的策略
  let onSessionStop = null;  // () 会话停止，各模式清理
  let onSuspendForTTS = null;// () 进入 TTS 挂起，各模式重置检测状态
  let onResume = null;       // (fromBargein) 会话恢复，各模式重置/续播
  let onState = null;        // () 会话状态变化，编排层同步 UI

  function setStatus(newSk) { sk = newSk; }
  const getStatus = () => sk;

  function triggerDone() {
    setStatus('done');
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => {
      doneTimer = null;
      if (sk === 'done') setStatus(micActive ? 'listening' : 'idle');
    }, 2000);
  }

  function drawFrame() {
    resizeCanvasToDisplay();
    const cfg = STATE_CFG[sk];
    const s = animState;
    const ls = 0.025;

    s.amp = lerp(s.amp, cfg.amp, ls * 8);
    s.spd = lerp(s.spd, cfg.spd, ls * 6);
    s.col = [
      lerpArr(s.col[0], cfg.r, ls * 1.5),
      lerpArr(s.col[1], cfg.g, ls * 1.5),
      lerpArr(s.col[2], cfg.b, ls * 1.5),
    ];

    if (micData) {
      micData.analyser.getByteFrequencyData(micData.dataArray);
      const sum = micData.dataArray.reduce((a, b) => a + b, 0);
      const vol = (sum / micData.dataArray.length) / 255;

      // 模式策略：barge-in 检测 + 活动计时（continuous）。core 只把 vol 抛出去，
      // 不含任何打断/自动发送逻辑。在视觉块之前调用，保持与原始顺序一致。
      onFrame?.(vol);

      if (vol > 0.02) {
        s.amp = lerp(s.amp, 0.08 + vol * 1.2, 0.4);
        s.spd = lerp(s.spd, 1.0 + vol * 5.0, 0.2);
        // speaking 状态下用户开口 → 视觉反馈但不覆盖状态（等 barge-in 触发后自然切换）
        if (sk !== 'recognizing' && sk !== 'event' && sk !== 'speaking')
          setStatus(vol > 0.15 ? 'recognizing' : 'listening');
        else if (sk === 'speaking' && vol > BARGEIN_THRESHOLD)
          setStatus('recognizing');
      } else if (sk !== 'idle' && sk !== 'event' && sk !== 'processing' && sk !== 'done' && sk !== 'speaking') {
        setStatus('idle');
      }
    }

    // 声音事件闪烁效果自动恢复
    if (sk === 'event') {
      eventFlashCount--;
      if (eventFlashCount <= 0) setStatus(micActive ? 'listening' : 'idle');
    }

    s.t    += 0.016 * s.spd;
    s.rotY += 0.008;
    s.rotX  = 0.22 + Math.sin(s.t * 0.15) * 0.06;

    ctx.clearRect(0, 0, W, H);

    const cY = Math.cos(s.rotY), sY = Math.sin(s.rotY);
    const cX = Math.cos(s.rotX), sX = Math.sin(s.rotX);

    const project = (orig) => {
      const d = 1.0 + sn(orig.x, orig.y, orig.z, s.t) * s.amp;
      const px = orig.x * d, py = orig.y * d, pz = orig.z * d;
      const rx  =  px * cY + pz * sY;
      const ry0 = py;
      const rz  = -px * sY + pz * cY;
      const ry  = ry0 * cX - rz * sX;
      const rz2 = ry0 * sX + rz * cX;
      return { sx: cx + rx * scale, sy: cy - ry * scale, z: rz2 };
    };

    const allPts = [
      ...BASE_PTS.map(p  => ({ ...project(p), inner: false })),
      ...BASE_PTS2.map(p => ({ ...project(p), inner: true  })),
    ];
    allPts.sort((a, b) => a.z - b.z);

    for (const pt of allPts) {
      const depth = (pt.z + 1.5) / 3.0;
      const r = Math.round(lerp(s.col[0][0], s.col[0][2], depth));
      const g = Math.round(lerp(s.col[1][0], s.col[1][2], depth));
      const b = Math.round(lerp(s.col[2][0], s.col[2][2], depth));
      const alpha = 0.25 + depth * 0.75;
      const dotR = pt.inner ? (0.4 + depth * 0.5) : (0.6 + depth * 0.8 + s.amp * 2);
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(drawFrame);
  }

  function startRenderLoop() {
    if (!rafId) drawFrame();
  }

  // ─── 会话运行时状态（两个模式共用的单一会话） ───
  let micData = null;
  let micActive = false;
  let userWantedMic = false;
  let suspendedByMedia = false;
  let ttsStartTime = 0;
  // Cloud 专用
  let cloudAudioCtx = null;
  let cloudProcessor = null;
  let cloudWs = null;
  let cloudWsIntentional = false; // stopCloudStream 主动关闭时置 true，避免触发重连
  // 打断预缓冲：TTS 期间把 PCM 写入环形缓冲，打断后一并发给 ASR
  let bargeinBuffer = [];   // Int16Array 块的环形队列
  let bargeinBuffering = false; // true = 正在 TTS，写缓冲而非发 WS
  // 重连预缓冲：WS 断开/重连的死区里把 PCM 暂存，连上后立即补发，避免丢字。
  let reconnectBuffer = []; // Int16Array 块
  // PTT 按住期间禁用自动发送的门控位（PTT 写、continuous 读）
  let pttHolding = false;

  function syncState() { onState?.(); }

  // ─── 转录累积 / 去重（两模式共用机制） ───
  let lastTranscriptText = '';
  // 多句累积：Paraformer 按句回调，需拼接完整段落
  let accumulatedText = '';
  // 已定稿句子列表 [{seg, text}]。seg 为云端给的句子唯一标识（如 begin_time）：
  // 同一句的多帧 final 共用同一 seg，据此去重，避免被反复追加成「X，X，X，…」。
  let committed = [];
  const committedText = () => committed.map(s => s.text).join('，');
  function resetTranscriptAccumulation() {
    committed = [];
    accumulatedText = '';
  }

  // 收到一条 transcript 消息：写入累积/显示，返回是否为 final。两条 WS 路径共用，
  // 保证去重逻辑只有一份。
  function applyTranscript(msg) {
    const text = (msg.text || '').trim();
    if (!text) return false;
    const seg = (msg.seg === undefined || msg.seg === null) ? null : msg.seg;
    if (msg.is_final) {
      const last = committed[committed.length - 1];
      // 与上一句同 seg（或文本完全相同）→ 视为同一句的重复/修正帧，替换而非追加
      if (last && ((seg !== null && last.seg === seg) || last.text === text)) {
        last.text = text;
      } else {
        committed.push({ seg, text });
      }
      accumulatedText = committedText();
      lastTranscriptText = accumulatedText;
      if (transcript) transcript.textContent = accumulatedText;
      const input = getChatInput?.();
      if (input) input.value = accumulatedText;
      return true;
    }
    // interim：仅用于实时显示，不写入 committed
    const base = committedText();
    lastTranscriptText = base ? base + '，' + text : text;
    if (transcript) transcript.textContent = lastTranscriptText;
    return false;
  }

  // ─── 语音识别结果发送（实际投递动作；何时调由模式策略决定） ───
  function sendRecognizedVoiceText() {
    if (!lastTranscriptText) return;
    const input = getChatInput?.();
    if (input) input.value = lastTranscriptText;
    getSendMessage?.({ channel: '语音识别', label: 'You · 语音识别' });
    // 发出后清空累积：已发的内容不能再被后续语音追加/重发。
    // （此处只清文字层，reconnectBuffer 是尚未识别的原始音频，由音频层自管理）
    resetTranscriptAccumulation();
    lastTranscriptText = '';
    if (transcript) transcript.textContent = '';
  }

  // ─── 麦克风捕获（两种模式共用） ───
  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
      micData = { analyser, dataArray, stream, actx, src };
      return stream;
    } catch (e) {
      // 权限拒绝时球体变红，不在 transcript 显示文字
      setStatus('error');
      return null;
    }
  }

  function stopMic() {
    micData?.stream.getTracks().forEach(t => t.stop());
    micData = null;
  }

  // ─── Cloud ASR 传输（后端代理） ───
  function connectCloudWs() {
    cloudWsIntentional = false; // 新连接建立时清除上一次主动关闭的标记
    const ws = new WebSocket(CLOUD_WS_URL);
    ws.binaryType = 'arraybuffer';
    cloudWs = ws;

    ws.onopen = () => {
      if (cloudWs !== ws) return;
      const provider = localStorage.getItem(VOICE_PROVIDER_KEY) || 'aliyun';
      const lang = getLang?.()?.split('-')[0] || 'zh';
      ws.send(JSON.stringify({ type: 'config', provider, lang }));
      setStatus('listening');
      // 补发重连死区里暂存的音频，避免断连期间说的话丢失
      if (reconnectBuffer.length) {
        for (const chunk of reconnectBuffer) {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk.buffer);
        }
        reconnectBuffer = [];
      }
      // 注意：此处不重置 accumulatedText，由调用方在首次启动时负责清空
    };

    ws.onmessage = (ev) => {
      if (cloudWs !== ws) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'transcript') {
          if (!(msg.text || '').trim()) return;
          const isFinal = applyTranscript(msg);
          if (isFinal) triggerDone();
          onTranscript?.(msg, isFinal);
        } else if (msg.type === 'error') {
          setStatus('error');
          if (transcript) transcript.textContent = msg.message || '云端识别错误';
        }
      } catch {}
    };

    ws.onerror = () => { if (cloudWs === ws) setStatus('error'); };

    ws.onclose = () => {
      if (cloudWs !== ws) return; // 已被新连接取代，忽略旧连接的 close 事件
      cloudWs = null;
      if (!cloudWsIntentional && micActive) {
        // 非主动断开（超时/网络抖动）且用户仍在录音 → 自动重连，保留已识别文字
        setTimeout(() => { if (micActive) connectCloudWs(); }, 800);
      } else {
        cloudWsIntentional = false;
        if (micActive) setStatus('idle');
      }
    };
  }

  function startCloudStream(stream) {
    const targetSR = 16000;
    if (micData?.actx?.sampleRate !== targetSR) {
      cloudAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: targetSR });
      const src = cloudAudioCtx.createMediaStreamSource(stream);
      setupCloudProcessor(src, cloudAudioCtx);
    } else {
      setupCloudProcessor(micData.src, micData.actx);
    }

    // 首次启动清空累积文字；重连时由 connectCloudWs 直接调用，不经过此处
    resetTranscriptAccumulation();
    reconnectBuffer = [];
    if (transcript) transcript.textContent = '';
    connectCloudWs();
  }

  function setupCloudProcessor(srcNode, audioCtx) {
    const bufferSize = 4096;
    cloudProcessor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    srcNode.connect(cloudProcessor);
    cloudProcessor.connect(audioCtx.destination);

    cloudProcessor.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
      }
      if (bargeinBuffering) {
        // TTS 播放中：写入环形缓冲而非发送，供打断时回放
        bargeinBuffer.push(i16);
        if (bargeinBuffer.length > BARGEIN_MAX_CHUNKS) bargeinBuffer.shift();
        return;
      }
      if (!cloudWs || cloudWs.readyState !== WebSocket.OPEN) {
        // WS 重连死区：暂存音频，连上后由 onopen 补发，绝不丢字
        reconnectBuffer.push(i16);
        if (reconnectBuffer.length > RECONNECT_MAX_CHUNKS) reconnectBuffer.shift();
        return;
      }
      cloudWs.send(i16.buffer);
    };
  }

  function stopCloudStream({ preserveProcessor = false } = {}) {
    cloudWsIntentional = true; // 标记为主动关闭，防止 onclose 触发重连
    try {
      if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(JSON.stringify({ type: 'flush' }));
        setTimeout(() => { try { cloudWs?.close(); } catch {} }, 200);
      } else {
        cloudWs?.close();
      }
    } catch {}
    cloudWs = null;

    if (!preserveProcessor) {
      try { cloudProcessor?.disconnect(); } catch {}
      cloudProcessor = null;
      try { if (cloudAudioCtx) { cloudAudioCtx.close(); cloudAudioCtx = null; } } catch {}
    }
  }

  // 向云端 ASR 请求立即给最终结果（PTT 松手 / 关闭时调用）
  function flushAsr() {
    try {
      if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
        cloudWs.send(JSON.stringify({ type: 'flush' }));
      }
    } catch {}
  }

  // ─── 会话生命周期 ───
  // 开启会话：开麦 + 接 ASR 流。返回 stream（失败返回 null）。
  async function startSession() {
    micActive = true;
    userWantedMic = true;
    suspendedByMedia = false;
    syncState();
    const stream = await startMic();
    if (!stream) {
      micActive = false;
      userWantedMic = false;
      syncState();
      return null;
    }
    startCloudStream(stream);
    return stream;
  }

  // 停止会话（= 原 stopVoiceInput 的 core 部分）。模式自有的计时器/标志由 onSessionStop 清。
  function stopSession({ keepIntent = false } = {}) {
    if (doneTimer) { clearTimeout(doneTimer); doneTimer = null; }
    pttHolding = false;
    onSessionStop?.(); // 各模式清理自己的计时器/检测状态
    lastTranscriptText = '';
    resetTranscriptAccumulation();
    reconnectBuffer = [];
    micActive = false;
    if (!keepIntent) userWantedMic = false;
    bargeinBuffer = [];
    bargeinBuffering = false;
    stopCloudStream();
    stopMic();
    setStatus('idle');
    if (transcript) transcript.textContent = '';
    syncState();
  }

  // 视频/音乐模式：完全停止 mic（不需要打断能力），保留用户意图
  function suspendForMedia() {
    if (!micActive) return;
    suspendedByMedia = true;
    stopSession({ keepIntent: true });
  }

  // TTS 模式：只停云端 ASR WebSocket，保持 mic 硬件 + ScriptProcessor。
  // 开启预缓冲：打断时可回放最近 1.5s 的音频，避免开头几个字丢失。
  function suspendForTTS() {
    if (!micActive) return;
    suspendedByMedia = true;
    ttsStartTime = Date.now();
    onSuspendForTTS?.(); // 各模式重置自己的打断检测计数
    bargeinBuffer = [];
    bargeinBuffering = true;
    stopCloudStream({ preserveProcessor: true }); // 保留 Processor，只断 WS
    setStatus('speaking');
  }

  // 会话恢复（= 原 resumeVoiceInputFromMedia）。fromBargein=true 表示由打断检测触发。
  async function resumeSession(fromBargein = false) {
    if (!suspendedByMedia || !userWantedMic) return;
    suspendedByMedia = false;

    // 拿走缓冲区快照并立刻停止写入，避免 WS 重连期间继续堆积
    const bufferedChunks = bargeinBuffer.slice();
    bargeinBuffer = [];
    bargeinBuffering = false;

    onResume?.(fromBargein); // 各模式重置检测状态 / 启动续播计时

    if (micActive && micData && cloudProcessor) {
      // TTS 模式：ScriptProcessor 仍存活，只需重连 WebSocket
      setStatus('listening');
      resetTranscriptAccumulation();
      if (transcript) transcript.textContent = '';
      const bargeinWs = new WebSocket(CLOUD_WS_URL);
      bargeinWs.binaryType = 'arraybuffer';
      cloudWs = bargeinWs;
      bargeinWs.onopen = () => {
        if (cloudWs !== bargeinWs) return;
        const provider = localStorage.getItem(VOICE_PROVIDER_KEY) || 'aliyun';
        const lang = getLang?.()?.split('-')[0] || 'zh';
        bargeinWs.send(JSON.stringify({ type: 'config', provider, lang }));
        // 先把预缓冲的历史音频一次性发出，补回打断前说的内容
        for (const chunk of bufferedChunks) {
          if (bargeinWs.readyState === WebSocket.OPEN) bargeinWs.send(chunk.buffer);
        }
      };
      bargeinWs.onmessage = (ev) => {
        if (cloudWs !== bargeinWs) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'transcript') {
            if (!(msg.text || '').trim()) return;
            const isFinal = applyTranscript(msg);
            if (isFinal) triggerDone();
            onTranscript?.(msg, isFinal);
          } else if (msg.type === 'error') {
            setStatus('error');
            if (transcript) transcript.textContent = msg.message || '云端识别错误';
          }
        } catch {}
      };
      bargeinWs.onerror = () => { if (cloudWs === bargeinWs) setStatus('error'); };
      bargeinWs.onclose = () => {
        if (cloudWs !== bargeinWs) return;
        cloudWs = null;
        if (!cloudWsIntentional && micActive) {
          setTimeout(() => { if (micActive) connectCloudWs(); }, 800);
        } else {
          cloudWsIntentional = false;
          if (micActive) setStatus('idle');
        }
      };
    } else {
      // 视频/音乐模式，或 Processor 已被销毁：完整重启
      micActive = true;
      syncState();
      const stream = await startMic();
      if (!stream) {
        micActive = false;
        userWantedMic = false;
        syncState();
        return;
      }
      startCloudStream(stream);
    }
  }

  return {
    // 渲染 / 状态
    setStatus,
    getStatus,
    triggerDone,
    startRenderLoop,
    // 会话生命周期
    startSession,
    stopSession,
    suspendForMedia,
    suspendForTTS,
    resumeSession,
    flushAsr,
    sendRecognizedVoiceText,
    resetTranscriptAccumulation,
    // 运行时状态访问
    get micActive() { return micActive; },
    get userWantedMic() { return userWantedMic; },
    set userWantedMic(v) { userWantedMic = v; },
    get suspendedByMedia() { return suspendedByMedia; },
    get ttsStartTime() { return ttsStartTime; },
    get pttHolding() { return pttHolding; },
    set pttHolding(v) { pttHolding = v; },
    hasLiveProcessor: () => Boolean(micActive && micData && cloudProcessor),
    getText: () => lastTranscriptText,
    setText: (v) => { lastTranscriptText = v; },
    // 模式钩子注册（编排层组装，支持组合多个模式）
    setOnFrame: (cb) => { onFrame = cb; },
    setOnTranscript: (cb) => { onTranscript = cb; },
    setOnSessionStop: (cb) => { onSessionStop = cb; },
    setOnSuspendForTTS: (cb) => { onSuspendForTTS = cb; },
    setOnResume: (cb) => { onResume = cb; },
    setOnState: (cb) => { onState = cb; },
  };
}
