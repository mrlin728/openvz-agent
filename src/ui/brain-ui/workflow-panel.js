// Brain UI 工作流面板 —— 可视化自进化工作流引擎的执行轨迹。
// 监听后端 workflow_progress 事件（经 app.js 转成 window 'bailongma:workflow' CustomEvent），
// 实时渲染：目标 → 步骤 → 每步评分 → 总分；并列出已保存的可复用工作流，一键复用。

export const createWorkflowPanel = () => `
<div class="wf-panel" id="wf-panel" aria-hidden="true">
  <div class="wf-header">
    <div class="wf-brand">
      <span class="wf-badge">⚙</span>
      <div class="wf-heads">
        <div class="wf-title">工作流引擎</div>
        <div class="wf-goal" id="wf-goal">给我一个目标，我会自动拆分 → 执行 → 评分 → 改进</div>
      </div>
    </div>
    <div class="wf-header-right">
      <span class="wf-overall" id="wf-overall" hidden></span>
      <button class="wf-close" id="wf-close" type="button" title="关闭">×</button>
    </div>
  </div>

  <div class="wf-steps" id="wf-steps">
    <div class="wf-empty" id="wf-empty">还没有运行中的工作流。对我说：「用工作流帮我完成〔某目标〕」。</div>
  </div>

  <div class="wf-saved">
    <div class="wf-saved-head">
      <span>可复用工作流</span>
      <button class="wf-refresh" id="wf-refresh" type="button" title="刷新">↻</button>
    </div>
    <div class="wf-saved-list" id="wf-saved-list"></div>
  </div>
</div>
<button class="wf-launcher" id="wf-launcher" type="button" title="工作流引擎">⚙<span>工作流</span></button>
`;

export function initWorkflowPanel() {
  const panel = document.getElementById('wf-panel');
  const launcher = document.getElementById('wf-launcher');
  if (!panel || !launcher) return;

  const $ = (id) => document.getElementById(id);
  const stepsEl = $('wf-steps');
  const emptyEl = $('wf-empty');
  const goalEl = $('wf-goal');
  const overallEl = $('wf-overall');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const scoreClass = (n) => (n >= 75 ? 'ok' : n >= 55 ? 'mid' : 'low');

  const open = () => { panel.classList.add('visible'); panel.setAttribute('aria-hidden', 'false'); loadSaved(); };
  const close = () => { panel.classList.remove('visible'); panel.setAttribute('aria-hidden', 'true'); };
  launcher.addEventListener('click', () => (panel.classList.contains('visible') ? close() : open()));
  $('wf-close')?.addEventListener('click', close);
  $('wf-refresh')?.addEventListener('click', loadSaved);

  // steps 以 id 为 key 渲染/更新
  const stepRow = (s) => {
    const score = typeof s.score === 'number' ? s.score : null;
    return `
    <div class="wf-step" data-step="${s.id}">
      <span class="wf-dot ${s.state || 'pending'}"></span>
      <div class="wf-step-main">
        <div class="wf-step-title">${s.id}. ${esc(s.title)}</div>
        <div class="wf-bar"><i style="width:${score ?? 0}%" class="${score == null ? '' : scoreClass(score)}"></i></div>
      </div>
      <span class="wf-step-score ${score == null ? '' : scoreClass(score)}">${score == null ? (s.state === 'running' ? '…' : '') : score}</span>
    </div>`;
  };

  let steps = new Map();
  const renderSteps = () => {
    if (steps.size === 0) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    stepsEl.querySelectorAll('.wf-step').forEach((n) => n.remove());
    for (const s of steps.values()) stepsEl.insertAdjacentHTML('beforeend', stepRow(s));
  };

  function handle(d) {
    if (!d) return;
    // 计划完成（run 或 plan_workflow 预览）
    if (d.type === 'plan_done' || d.phase === 'planned') {
      goalEl.textContent = d.goal || '';
      overallEl.hidden = true;
      steps = new Map((d.steps || []).map((s) => [s.id, { id: s.id, title: s.title, state: 'pending' }]));
      renderSteps();
      open();
      return;
    }
    if (d.type === 'step_exec' && d.step) {
      const s = steps.get(d.step.id) || { id: d.step.id, title: d.step.title };
      s.state = 'running';
      steps.set(s.id, s);
      renderSteps();
      return;
    }
    if (d.type === 'step_scored' && d.step) {
      const s = steps.get(d.step.id) || { id: d.step.id, title: d.step.title };
      s.score = d.verdict?.score ?? 0;
      s.state = (s.score >= 75) ? 'pass' : 'retry';
      steps.set(s.id, s);
      renderSteps();
      return;
    }
    if (d.type === 'replay_step' && d.step) {
      const s = { id: d.step.id, title: d.step.title, state: 'running' };
      steps.set(s.id, s); renderSteps(); open();
      return;
    }
    if (d.type === 'done' || d.type === 'replay_done') {
      const n = d.overallScore;
      if (typeof n === 'number') {
        overallEl.hidden = false;
        overallEl.className = `wf-overall ${scoreClass(n)}`;
        overallEl.textContent = `总分 ${n}`;
      }
      loadSaved();
      return;
    }
  }

  window.addEventListener('bailongma:workflow', (e) => { try { handle(e.detail); } catch (_) {} });

  async function loadSaved() {
    const list = $('wf-saved-list');
    if (!list) return;
    try {
      const r = await fetch('/workflows');
      const j = await r.json();
      const items = (j && j.workflows) || [];
      if (items.length === 0) { list.innerHTML = '<div class="wf-saved-empty">还没有已保存的工作流。</div>'; return; }
      list.innerHTML = items.map((w) => `
        <button class="wf-saved-item" data-name="${esc(w.name)}" type="button" title="复用这个工作流">
          <span class="wf-saved-name">${esc(w.name)}</span>
          <span class="wf-saved-meta">${w.steps ?? '—'} 步 · ${w.overallScore ?? '—'}</span>
        </button>`).join('');
      list.querySelectorAll('.wf-saved-item').forEach((btn) => {
        btn.addEventListener('click', () => replay(btn.getAttribute('data-name')));
      });
    } catch { list.innerHTML = '<div class="wf-saved-empty">加载失败。</div>'; }
  }

  // 复用：把「复用工作流 X」丢进对话输入并发送，交给 Agent 调 replay_workflow。
  function replay(name) {
    const input = document.getElementById('msg-input');
    const send = document.getElementById('send-btn');
    if (!input || !send) return;
    input.value = `复用工作流「${name}」`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    send.click();
    close();
  }
}
