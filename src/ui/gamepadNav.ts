/**
 * Navegação do app pelo controle fora do jogo (biblioteca, modais, configurações).
 * Direcional/analógico move o foco para o elemento mais próximo na direção; A confirma; B volta/fecha.
 * Dentro do jogo quem cuida do controle é a GameSession.
 */
import { pressedButtons } from '../emulator/gamepad'
import { padMapping } from '../library/library'
import { view } from './store'

type Dir = 'up' | 'down' | 'left' | 'right'
const REPEAT_DELAY = 400
const REPEAT_RATE = 130
const FOCUSABLE = 'button, select, input, a[href], [tabindex]:not([tabindex="-1"])'

/** Camada ativa: o modal/menu mais ao topo, senão a página inteira. */
function activeRoot(): HTMLElement {
  const layers = [...document.querySelectorAll<HTMLElement>('.game-menu, .modal')]
  return layers.at(-1) ?? document.body
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && el.offsetParent !== null
  })
}

/** Move o foco na direção dada, escolhendo o elemento mais próximo "à frente". */
export function spatialMove(root: HTMLElement, dir: Dir): boolean {
  const items = focusables(root)
  if (!items.length) return false
  const cur = document.activeElement as HTMLElement | null
  if (!cur || !items.includes(cur)) { focusEl(items[0]); return true }
  const a = cur.getBoundingClientRect()
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 }
  // 1ª escolha: elementos que se sobrepõem no eixo lateral (mesma coluna ao descer/subir,
  // mesma linha ao ir para os lados), o mais próximo à frente. 2ª: o mais próximo em distância.
  let best: HTMLElement | null = null
  let bestScore = Infinity
  let bestOverlap: HTMLElement | null = null
  let bestOverlapFwd = Infinity
  for (const el of items) {
    if (el === cur) continue
    const b = el.getBoundingClientRect()
    const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    const dx = bc.x - ac.x, dy = bc.y - ac.y
    const vertical = dir === 'down' || dir === 'up'
    // Para frente: a borda mais próxima do candidato precisa estar além do centro do atual.
    const forward = dir === 'down' ? b.top - ac.y : dir === 'up' ? ac.y - b.bottom : dir === 'right' ? b.left - ac.x : ac.x - b.right
    if (forward < -2) continue
    const side = vertical ? Math.abs(dx) : Math.abs(dy)
    const overlap = vertical
      ? Math.min(a.right, b.right) - Math.max(a.left, b.left)
      : Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    if (overlap > 0) {
      // Desempate entre candidatos à mesma distância (ex.: botões lado a lado): o mais alinhado.
      const f = Math.max(forward, 0) + side * 0.05
      if (f < bestOverlapFwd) { bestOverlapFwd = f; bestOverlap = el }
    }
    const score = Math.max(forward, 0) + side * 2
    if (score < bestScore) { bestScore = score; best = el }
  }
  if (bestOverlap) best = bestOverlap
  if (!best) return false
  focusEl(best)
  return true
}

function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function confirm() {
  const root = activeRoot()
  const cur = document.activeElement as HTMLElement | null
  if (!cur || !focusables(root).includes(cur)) { const f = focusables(root)[0]; if (f) focusEl(f); return }
  if (cur instanceof HTMLSelectElement) return // selects mudam com esquerda/direita
  cur.click()
}

function back() {
  const root = activeRoot()
  if (root.classList.contains('modal')) {
    root.querySelector<HTMLElement>('[aria-label="Fechar"]')?.click()
  } else if (view.value.name === 'settings') {
    view.value = { name: 'library' }
  } else {
    document.querySelector<HTMLElement>('.folder-bar .btn.ghost')?.click() // sai de uma pasta, se estiver numa
  }
}

function horizontal(dir: 'left' | 'right') {
  const cur = document.activeElement
  if (cur instanceof HTMLSelectElement) {
    const n = cur.options.length
    cur.selectedIndex = (cur.selectedIndex + (dir === 'right' ? 1 : n - 1)) % n
    cur.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  spatialMove(activeRoot(), dir)
}

export function startGamepadNav() {
  const held = new Map<string, number>()
  let armed = false
  let anyPad = false
  const act = (name: string) => {
    document.body.classList.add('gp-nav')
    if (name === 'up' || name === 'down') spatialMove(activeRoot(), name)
    else if (name === 'left' || name === 'right') horizontal(name)
    else if (name === 'confirm') confirm()
    else if (name === 'back') back()
  }
  document.addEventListener('mousemove', () => document.body.classList.remove('gp-nav'), { passive: true })
  document.addEventListener('touchstart', () => document.body.classList.remove('gp-nav'), { passive: true })

  const loop = () => {
    requestAnimationFrame(loop)
    if (view.value.name === 'player') { held.clear(); armed = false; return }
    const pads = (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g && g.connected)
    if (!pads.length) { anyPad = false; return }
    if (!anyPad) { anyPad = true; armed = false }
    const down = new Set<string>()
    for (const gp of pads) {
      const pressed = pressedButtons(gp)
      // Usa o mapeamento do GBA como referência para A/B e direcional (igual em todos os sistemas por padrão).
      const m = padMapping('gba')
      const has = (b: keyof typeof m, std: number) => pressed.has(m[b] ?? std)
      if (has('up', 12) || (gp.axes[1] ?? 0) < -0.5) down.add('up')
      if (has('down', 13) || (gp.axes[1] ?? 0) > 0.5) down.add('down')
      if (has('left', 14) || (gp.axes[0] ?? 0) < -0.5) down.add('left')
      if (has('right', 15) || (gp.axes[0] ?? 0) > 0.5) down.add('right')
      if (has('a', 1) || has('start', 9)) down.add('confirm')
      if (has('b', 0)) down.add('back')
    }
    if (!armed) { if (down.size === 0) armed = true; return }
    const now = performance.now()
    for (const name of ['up', 'down', 'left', 'right', 'confirm', 'back']) {
      if (down.has(name)) {
        const next = held.get(name)
        if (next === undefined) { held.set(name, now + REPEAT_DELAY); act(name) }
        else if (now >= next && !['confirm', 'back'].includes(name)) { held.set(name, now + REPEAT_RATE); act(name) }
      } else held.delete(name)
    }
  }
  requestAnimationFrame(loop)
}
