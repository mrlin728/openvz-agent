import { el, setText } from './dom.js'

function source(data = {}) { return data.url || data.src || '' }
function mediaElement(data = {}) {
  if (String(data.type || '').toLowerCase() === 'audio') return el('audio', { class: 'm-player', src: source(data), controls: true, autoplay: data.autoplay === true })
  return el('video', { class: 'm-player', src: source(data), poster: data.poster || '', controls: true, autoplay: data.autoplay === true, playsinline: true })
}

export const media = {
  render(data = {}, ctx = {}) {
    return el('figure', { class: 'k-media' }, [mediaElement(data), el('button', { class: 'i-close', title: '关闭', text: '×', onclick: () => ctx.emit?.('dismiss', {}) }), data.title ? el('figcaption', { class: 'm-cap', text: data.title }) : null])
  },
  enter() {},
  exit(el_) { try { el_.querySelector('.m-player')?.pause?.() } catch {} },
  morph(el_, prev = {}, next = {}) {
    const root = el_.querySelector('.k-media')
    const player = el_.querySelector('.m-player')
    if (!root || !player || String(prev.type || 'video') !== String(next.type || 'video')) { if (root) root.replaceChildren(mediaElement(next)); return }
    if (source(prev) !== source(next)) player.src = source(next)
    if (player.tagName === 'VIDEO' && prev.poster !== next.poster) player.poster = next.poster || ''
    let cap = el_.querySelector('.m-cap')
    if (next.title && !cap) root.appendChild(el('figcaption', { class: 'm-cap', text: next.title }))
    else if (!next.title && cap) cap.remove()
    else if (cap) setText(cap, next.title)
  },
}
