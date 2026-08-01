import crypto from 'node:crypto'
import { sceneStore } from '../../scene/scene-store.js'
import { execUIRegister } from './ui.js'

function idFor(component = 'legacy-card') {
  const base = String(component || 'legacy-card').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
  return `${base}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

function sceneIntent(hint = {}) {
  if (hint.modal || hint.placement === 'stage' || hint.placement === 'center') return 'confront'
  if (hint.placement === 'notification') return 'ambient'
  return 'inform'
}

function project(component, props = {}, hint = {}) {
  const key = String(component || '').toLowerCase()
  const legacy = { component: component || 'LegacyCard', props, hint }
  if (key.includes('weather')) return { kind: 'weather', data: { ...props, _legacy: legacy } }
  if (key.includes('image')) return { kind: 'image', data: { url: props.url || props.src || props.image || '', title: props.title || '', alt: props.alt || '', _legacy: legacy } }
  if (key.includes('video')) return { kind: 'media', data: { type: 'video', url: props.url || props.src || '', title: props.title || '', poster: props.poster || '', _legacy: legacy } }
  if (key.includes('selfcheckstep')) return { kind: 'progress', data: { label: props.label || props.title || '自检', value: props.value ?? props.progress ?? 0, max: props.max ?? 100, status: props.status || 'active', note: props.note || '', _legacy: legacy } }
  if (key.includes('selfcheck')) return { kind: 'selfcheck', data: { ...props, _legacy: legacy } }
  if (key.includes('awakening')) return { kind: 'awakening', data: { ...props, _legacy: legacy } }
  if (key.includes('security')) {
    return { kind: 'choice', data: { prompt: props.prompt || props.title || '确认安全设置变更', options: props.options || [{ value: 'confirm', label: '确认' }, { value: 'cancel', label: '取消' }], pending: props.pending || props, _legacy: legacy } }
  }
  return { kind: 'text', data: { title: props.title || component || 'OpenVZ Agent', body: props.body || props.text || props.message || JSON.stringify(props, null, 2), _legacy: legacy } }
}

export function execLegacyUIShow({ component, props = {}, hint = {}, mode, template, code } = {}) {
  const effectiveComponent = component || (mode ? `Legacy ${mode}` : 'LegacyCard')
  const effectiveProps = mode ? { ...props, title: effectiveComponent, body: template || code || '' } : props
  const id = idFor(effectiveComponent)
  const surface = project(effectiveComponent, effectiveProps, hint)
  sceneStore.set(id, { ...surface, intent: sceneIntent(hint), focus: Boolean(hint.modal) })
  return JSON.stringify({ ok: true, id, adapter: 'scene', kind: surface.kind })
}

export function execLegacyUIHide({ id } = {}) {
  if (!id) return '错误：未提供 id'
  const changed = sceneStore.set(id, null)
  return JSON.stringify({ ok: true, id, changed, adapter: 'scene' })
}

export function execLegacyUIUpdate({ id, props } = {}) {
  if (!id) return '错误：未提供 id'
  if (!props || typeof props !== 'object' || Array.isArray(props)) return '错误：props 必须为对象'
  const current = sceneStore.get(id)
  if (!current) return `错误：卡片 "${id}" 不存在或已关闭`
  const legacy = current.data?._legacy || { component: current.kind, props: {}, hint: {} }
  const surface = project(legacy.component, { ...(legacy.props || {}), ...props }, legacy.hint)
  sceneStore.set(id, { ...surface, intent: current.intent, focus: current.focus, order: current.order })
  return JSON.stringify({ ok: true, id, adapter: 'scene' })
}

export function execLegacyUIPatch({ id, op, data = {} } = {}) {
  if (!id || !op) return '错误：ui_patch 需要 id 和 op'
  const current = sceneStore.get(id)
  if (!current) return `错误：卡片 "${id}" 不存在或已关闭`
  sceneStore.set(id, { ...current, data: { ...current.data, ...(op === 'setState' && data && typeof data === 'object' ? data : {}), _legacyPatch: { op, data, at: new Date().toISOString() } } })
  return JSON.stringify({ ok: true, id, op, adapter: 'scene' })
}

export function execLegacyUIRegister(args = {}) {
  const result = execUIRegister(args)
  return typeof result === 'string' ? result : JSON.stringify(result)
}

export const __internal = { project, sceneIntent }
