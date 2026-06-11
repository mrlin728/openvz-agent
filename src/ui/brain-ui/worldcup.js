// 世界杯模式控制 — 开关 iframe 大屏、与其他全屏模式互斥、状态上报。
// 赛况内容本体在 worldcup-broadcast-v2.html（自带 /worldcup 取数、自动刷新、1080p 缩放），
// 这里不做任何数据渲染。

import { apiUrl } from './api-client.js';
import { setHotspotMode, moveVoicePanelToBody, restoreVoicePanel } from './hotspot.js';

const FRAME_SRC = apiUrl('/src/ui/brain-ui/worldcup-broadcast-v2.html');

const $ = (id) => document.getElementById(id);
let worldcupActive = false;
let closeTimer = null;

// 退场动画时长：iframe 内 wcb-glitch-out 420ms + 最大错峰 300ms，面板淡出与尾段重叠
const EXIT_ANIMATION_MS = 680;

function reportWorldcupState(visible, source = 'brain-ui') {
  fetch(apiUrl('/worldcup-state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !!visible, source }),
  }).catch(() => {});
}

export function setWorldcupMode(visible, { source = 'brain-ui' } = {}) {
  const nextVisible = !!visible;
  if (worldcupActive === nextVisible) {
    reportWorldcupState(nextVisible, source);
    return;
  }
  worldcupActive = nextVisible;

  const frame = $('worldcup-frame');
  if (nextVisible) {
    // 取消可能还在等退场动画的卸载（快速关了又开）
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    // 与其他全屏模式互斥
    setHotspotMode(false, { source: 'worldcup_open' });
    for (const mode of ['video-mode', 'image-mode', 'music-mode']) {
      document.body.classList.remove(mode);
    }
    if (frame) frame.src = FRAME_SRC;   // 重新加载即重播出场动画
    moveVoicePanelToBody();
    document.body.classList.add('worldcup-mode');
  } else {
    // 先让 iframe 播退场动画，再淡出面板并卸载页面
    // （卸载停掉 iframe 内的轮询，避免 viewed 状态被无限续期）
    const frameLoaded = !!(frame && frame.src && !frame.src.includes('about:blank'));
    if (frameLoaded) {
      try { frame.contentWindow?.postMessage({ type: 'worldcup-exit' }, '*'); } catch {}
    }
    const finishClose = () => {
      closeTimer = null;
      if (frame) frame.src = 'about:blank';
      document.body.classList.remove('worldcup-mode');
      restoreVoicePanel();
    };
    if (frameLoaded) closeTimer = setTimeout(finishClose, EXIT_ANIMATION_MS);
    else finishClose();
  }

  window.dispatchEvent(new CustomEvent('bailongma:worldcup-mode', {
    detail: { active: nextVisible },
  }));
  reportWorldcupState(nextVisible, source);
}

export function toggleWorldcup(source = 'brain-ui') {
  setWorldcupMode(!worldcupActive, { source });
}

export async function initWorldcup() {
  const exitBtn = $('wc-exit-btn');
  if (exitBtn) exitBtn.addEventListener('click', () => toggleWorldcup());

  // 热点面板打开时让位（事件解耦，避免 hotspot.js 反向 import 形成循环）
  window.addEventListener('bailongma:hotspot-mode', (event) => {
    if (event?.detail?.active && worldcupActive) setWorldcupMode(false, { source: 'hotspot_open' });
  });
}
