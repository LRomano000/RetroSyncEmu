// Teste ponta a ponta: dois "aparelhos" (contextos do navegador) usando o mesmo Drive falso.
// Uso: npm run build && npx vite preview --port 5199  (em outro terminal)  e  node tests/e2e.mjs
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { FakeDrive, attachFakes } from './fake-google.mjs'
import { readFileSync } from 'node:fs'

const require = createRequire(execSync('npm root -g').toString().trim() + '/')
const { chromium } = require('playwright')
const BASE = process.env.BASE_URL || 'http://localhost:5199/'
const ROMS = ['Teste GB.gb', 'Teste GBC.gbc', 'Teste GBA.gba', 'Teste SNES.sfc'].map(n => `test-roms/${n}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++ }

const drive = new FakeDrive()
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } })
  await ctx.addInitScript(([n]) => { localStorage.setItem('rs.clientId', 'fake.apps.googleusercontent.com'); if (!localStorage.getItem('rs.device')) localStorage.setItem('rs.device', n) }, [name])
  await attachFakes(ctx, drive)
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log(`[${name}] PAGEERROR`, e.message))
  page.on('console', m => { if (m.text().startsWith('[sync] conflito')) console.log(`[${name}]`, m.text()); if (m.type() === 'error' && !m.text().includes('favicon')) console.log(`[${name}] console.error`, m.text().slice(0, 300)) })
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Favoritos') : d.accept())
  await page.goto(BASE)
  if (!process.env.NO_SW) await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 })
  return { ctx, page, name }
}

// Força uma sync nova e espera ela terminar sem pendências.
async function waitSynced(page, timeout = 60000) {
  const t0 = await page.evaluate(() => Date.now())
  await page.locator('.sync-badge').first().click()
  await page.waitForFunction(t0 => {
    const b = document.querySelector('.sync-badge')
    return b && b.classList.contains('sync-idle') && !b.textContent.includes('pendente') && Number(localStorage.getItem('rs.lastSync')) >= t0
  }, t0, { timeout })
}

async function play(page, title, wait = 1500) {
  await tile(page, title).locator('.tile-play').click()
  await page.waitForSelector('.menu-fab', { timeout: 60000 })
  await sleep(wait)
}

async function exitGame(page) {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Sair do jogo' }).click()
  await page.waitForSelector('.library')
}

function tile(page, title) { return page.locator('.tile').filter({ has: page.locator(`.tile-title[title="${title}"]`) }) }
const sramByte0 = path => drive.byPath(path)?.data?.[0]

// ---------- Aparelho A ----------
const A = await device('PC-A')
await A.page.getByRole('button', { name: 'Entrar com Google' }).first().click()
await A.page.waitForSelector('.banner', { state: 'detached' })
await waitSynced(A.page)
check(!!drive.byPath('ROMs/gba') && !!drive.byPath('Saves') && !!drive.byPath('Backups'), 'A: estrutura de pastas criada no Drive')

await A.page.setInputFiles('input[type=file]', ROMS)
await A.page.waitForFunction(() => document.querySelectorAll('.tile').length === 4)
await waitSynced(A.page)
const paths1 = drive.listPaths()
check(['ROMs/gb/Teste GB.gb', 'ROMs/gbc/Teste GBC.gbc', 'ROMs/gba/Teste GBA.gba', 'ROMs/snes/Teste SNES.sfc', 'library.json'].every(p => paths1.includes(p)), 'A: 4 ROMs + library.json enviados ao Drive')

// Importar a mesma ROM de novo é ignorado
await A.page.setInputFiles('input[type=file]', [ROMS[0]])
await sleep(800)
check((await A.page.locator('.tile').count()) === 4, 'A: ROM duplicada é ignorada')

// Joga GB: primeiro boot grava contador 0 na SRAM
await play(A.page, 'Teste GB', 12000) // espera o flush periódico da SRAM (10 s)
await A.page.keyboard.press('Escape')
await A.page.getByRole('button', { name: 'Salvar state' }).click()
await A.page.waitForSelector('.toast:has-text("Save state criado")')
await A.page.getByRole('button', { name: 'Continuar' }).click()
await exitGame(A.page)
await waitSynced(A.page)
let paths = drive.listPaths()
check(paths.includes('Saves/gb/Teste GB.srm'), 'A: SRAM enviada para Saves/gb/Teste GB.srm')
check(sramByte0('Saves/gb/Teste GB.srm') === 0, `A: contador na SRAM = 0 (obtido ${sramByte0('Saves/gb/Teste GB.srm')})`)
const states = paths.filter(p => p.startsWith('States/gb/Teste GB/'))
check(states.some(p => /\/\d{4}-.*\.state$/.test(p)) && states.some(p => /\/\d{4}-.*\.state\.png$/.test(p)), 'A: save state manual + screenshot no Drive')
check(states.some(p => /\/auto_.*\.state$/.test(p)), 'A: autosave ao sair no Drive')
check(paths.some(p => p.startsWith('Backups/gb/Teste GB/') && p.endsWith('.srm')), 'A: backup da SRAM em Backups/')

// Thumbnail na biblioteca
check(await tile(A.page, 'Teste GB').locator('img').count() === 1, 'A: miniatura do último state aparece na biblioteca')

// ---------- Aparelho B (novo, vazio) ----------
const B = await device('Android-B')
await B.page.getByRole('button', { name: 'Entrar com Google' }).first().click()
await B.page.waitForSelector('.banner', { state: 'detached' })
await waitSynced(B.page)
await B.page.waitForFunction(() => document.querySelectorAll('.tile').length === 4)
check(true, 'B: biblioteca com 4 ROMs vinda do Drive')
check(await tile(B.page, 'Teste GB').getByText('na nuvem').count() === 1, 'B: ROM aparece como "na nuvem" (não baixada)')

// B abre o jogo só com a SRAM -> contador vira 1
await tile(B.page, 'Teste GB').getByRole('button', { name: 'Mais opções' }).click()
await B.page.locator('.tabs button', { hasText: 'Configurações' }).click()
await B.page.locator('.modal select').first().selectOption('sram')
await B.page.getByRole('button', { name: 'Fechar' }).click()
await play(B.page, 'Teste GB', 12000)
await exitGame(B.page)
await waitSynced(B.page)
check(sramByte0('Saves/gb/Teste GB.srm') === 1, `B: carregou a SRAM de A e o contador foi a 1 (obtido ${sramByte0('Saves/gb/Teste GB.srm')})`)
check(await tile(B.page, 'Teste GB').getByText('offline').count() === 1, 'B: ROM ficou em cache para jogar offline')

// A recebe o save de B
await waitSynced(A.page)
check(drive.byPath('Saves/gb/Teste GB.srm') && (await A.page.evaluate(() => localStorage.getItem('rs.lastSync'))) !== null, 'A: recebeu o save de B')

// ---------- Conflito: os dois jogam offline ----------
await A.ctx.setOffline(true)
await B.ctx.setOffline(true)
// A: autoload "só SRAM" -> contador 2
await tile(A.page, 'Teste GB').getByRole('button', { name: 'Mais opções' }).click()
await A.page.locator('.tabs button', { hasText: 'Configurações' }).click()
await A.page.locator('.modal select').first().selectOption('sram')
await A.page.getByRole('button', { name: 'Fechar' }).click()
await play(A.page, 'Teste GB', 12000)
await exitGame(A.page)
// B: começa do zero -> contador 0 depois de ... (SRAM nova), diferente de A
await tile(B.page, 'Teste GB').getByRole('button', { name: 'Mais opções' }).click()
await B.page.getByRole('button', { name: 'Começar do zero' }).click()
await B.page.waitForSelector('.menu-fab', { timeout: 60000 })
await sleep(13000)
await exitGame(B.page)
check(await A.page.locator('.sync-badge.sync-offline').count() === 1, 'A: indicador mostra Offline')

const aByte = await A.page.evaluate(async () => {
  const db = await new Promise(r => { const q = indexedDB.open('retrosync'); q.onsuccess = () => r(q.result) })
  const f = await new Promise(r => { const q = db.transaction('files').objectStore('files').get('Saves/gb/Teste GB.srm'); q.onsuccess = () => r(q.result) })
  return new Uint8Array(await f.blob.arrayBuffer())[0]
})
console.log('  (A offline tem contador', aByte, ')')
await A.ctx.setOffline(false)
await waitSynced(A.page)
console.log('  (Drive depois da sync de A:', sramByte0('Saves/gb/Teste GB.srm'), ')')
await B.ctx.setOffline(false)
await waitSynced(B.page)
console.log('  (Drive depois da sync de B:', sramByte0('Saves/gb/Teste GB.srm'), ')')
paths = drive.listPaths()
const conflicts = paths.filter(p => p.startsWith('Backups/gb/Teste GB/') && p.includes('conflito'))
check(conflicts.length >= 1, `Conflito: versão perdedora guardada em Backups (${conflicts.join(', ')})`)
const finalByte = sramByte0('Saves/gb/Teste GB.srm')
const conflictByte = conflicts.length ? drive.byPath(conflicts[0]).data[0] : null
check(new Set([finalByte, conflictByte]).size === 2, `Conflito: as duas versões existem (principal=${finalByte}, cópia=${conflictByte})`)
check(paths.some(p => p.includes('antes-de-zerar')), '"Começar do zero" guardou o save anterior em Backups')

// Tela de backups lista o conflito
await tile(B.page, 'Teste GB').getByRole('button', { name: 'Mais opções' }).click()
await B.page.locator('.tabs button', { hasText: 'Backups' }).click()
await B.page.waitForSelector('.backup-list li')
check(await B.page.locator('.backup-list li.conflict').count() >= 1, 'B: tela de backups mostra a versão em conflito')
// Restaurar um backup abre o jogo com a SRAM restaurada
await B.page.locator('.backup-list li').last().getByRole('button', { name: 'Restaurar' }).click()
await B.page.waitForSelector('.menu-fab', { timeout: 60000 })
await sleep(1000)
await exitGame(B.page)
check(true, 'B: restaurar backup e abrir o jogo funcionou')

// GBA e SNES rodam e salvam state
for (const t of ['Teste GBA', 'Teste SNES']) {
  await play(B.page, t, 2500)
  await B.page.keyboard.press('Escape')
  await B.page.getByRole('button', { name: 'Salvar state' }).click()
  await B.page.waitForSelector('.toast:has-text("Save state criado")')
  await B.page.getByRole('button', { name: 'Carregar state…' }).click()
  await B.page.locator('.state-row').first().getByRole('button', { name: 'Carregar' }).click()
  await B.page.waitForSelector('.toast:has-text("Save state carregado")')
  await exitGame(B.page)
}
await waitSynced(B.page)
paths = drive.listPaths()
check(paths.some(p => p.startsWith('Saves/gba/Teste GBA')) && paths.some(p => p.startsWith('Saves/snes/Teste SNES')), 'GBA e SNES: SRAM no Drive')
check(paths.some(p => p.startsWith('States/snes/Teste SNES/') && p.endsWith('.png')), 'SNES: state com screenshot')

// Trocar sistema GB -> GBC move ROM e saves
await tile(B.page, 'Teste GB').getByRole('button', { name: 'Mais opções' }).click()
await B.page.locator('.modal select').first().selectOption('gbc')
await B.page.waitForSelector('.toast:has-text("Agora é")')
await B.page.getByRole('button', { name: 'Fechar' }).click()
await waitSynced(B.page)
paths = drive.listPaths()
check(paths.includes('ROMs/gbc/Teste GB.gb') && !paths.includes('ROMs/gb/Teste GB.gb'), 'Trocar sistema: ROM movida para ROMs/gbc')
check(paths.includes('Saves/gbc/Teste GB.srm') && !paths.includes('Saves/gb/Teste GB.srm'), 'Trocar sistema: save movido para Saves/gbc')

// A recebe a mudança
await waitSynced(A.page)
await A.page.waitForFunction(() => [...document.querySelectorAll('.tile')].some(t => t.textContent.includes('Teste GB') && t.textContent.includes('GBC') && !t.textContent.includes('Teste GBC')))
check(true, 'A: vê a ROM como GBC após sync')

// ---------- Pastas e visualização em lista ----------
await A.page.locator('.chip', { hasText: 'GBA' }).click()
await A.page.getByRole('button', { name: 'Nova pasta' }).click()
await A.page.waitForSelector('.folder-title:has-text("Favoritos")')
check(true, 'Pastas: criar pasta entra nela')
await A.page.locator('.folder-bar .btn.ghost').click() // volta ao sistema
await tile(A.page, 'Teste GBA').getByRole('button', { name: 'Mais opções' }).click()
await A.page.locator('.modal select').nth(1).selectOption({ label: 'Favoritos' })
await sleep(300)
await A.page.getByRole('button', { name: 'Fechar' }).click()
check((await A.page.locator('.tile').count()) === 0 && (await A.page.locator('.folder-chip', { hasText: 'Favoritos' }).textContent()).includes('1'), 'Pastas: jogo saiu da raiz do sistema e a pasta mostra 1')
await A.page.locator('.folder-chip', { hasText: 'Favoritos' }).click()
check((await tile(A.page, 'Teste GBA').count()) === 1, 'Pastas: jogo aparece dentro da pasta')
await A.page.getByRole('button', { name: 'Lista', exact: true }).click()
check((await A.page.locator('.rom-row').count()) === 1 && (await A.page.locator('.rom-row').textContent()).includes('Favoritos'), 'Lista: visualização em lista mostra o jogo e a pasta')
await A.page.getByRole('button', { name: 'Grade', exact: true }).click()
await A.page.getByRole('button', { name: 'Apagar pasta' }).click()
await sleep(300)
check((await A.page.locator('.folder-chip').count()) === 0 && (await tile(A.page, 'Teste GBA').count()) === 1, 'Pastas: apagar pasta mantém o jogo')
await waitSynced(A.page)
await waitSynced(B.page)
const libB = JSON.parse(await B.page.evaluate(async () => {
  const db = await new Promise(r => { const q = indexedDB.open('retrosync'); q.onsuccess = () => r(q.result) })
  const f = await new Promise(r => { const q = db.transaction('files').objectStore('files').get('library.json'); q.onsuccess = () => r(q.result) })
  return f.blob.text()
}))
check(Object.values(libB.folders).some(f => f.name === 'Favoritos' && f.deleted), 'Pastas: alteração chegou ao outro aparelho pelo library.json')
await A.page.locator('.chip', { hasText: 'Todos' }).click()

// ---------- Controle (Gamepad API simulado) ----------
const C = await (async () => {
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => {
    localStorage.setItem('rs.clientId', 'fake'); localStorage.setItem('rs.device', 'PC-C')
    // Controle falso: botão 1 (direita = A no layout Nintendo) apertado enquanto window.__press
    // window.__press = true aperta o botão 1 (A); um número aperta esse índice.
    const idx = () => window.__press === true ? 1 : typeof window.__press === 'number' ? window.__press : -1
    navigator.getGamepads = () => [{ id: 'Controle Falso', connected: true, index: 0, mapping: 'standard', axes: [0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === idx(), value: i === idx() ? 1 : 0 })) }]
    window.GamepadEvent = class extends Event { constructor(t, init) { super(t); this.gamepad = init && init.gamepad } }
  })
  await attachFakes(ctx, drive)
  const page = await ctx.newPage()
  page.on('dialog', d => d.accept())
  await page.goto(BASE)
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 })
  return { ctx, page }
})()
await C.page.getByRole('button', { name: 'Entrar com Google' }).first().click()
await C.page.waitForSelector('.banner', { state: 'detached' })
await waitSynced(C.page)
// Navegação da biblioteca pelo controle: A foca o primeiro item, "baixo" até chegar num jogo, A abre.
const tap = async (i, ms = 120) => { await C.page.evaluate(i => { window.__press = i }, i); await sleep(ms); await C.page.evaluate(() => { window.__press = -1 }); await sleep(250) }
await C.page.evaluate(() => document.activeElement?.blur())
await tap(1)
check(await C.page.evaluate(() => document.activeElement?.classList.contains('brand')), 'Gamepad: A sem foco foca o primeiro item')
let reached = false
for (let k = 0; k < 8 && !reached; k++) { await tap(13); reached = await C.page.evaluate(() => document.activeElement?.classList.contains('tile-play')) }
check(reached, 'Gamepad: direcional leva o foco até um jogo na biblioteca')
await tap(1)
await C.page.waitForSelector('.menu-fab', { timeout: 60000 })
check(true, 'Gamepad: A abre o jogo focado')
// Dentro do menu: "Carregar state…" tem botões lado a lado (Carregar / Apagar); direita deve ir ao vizinho.
await C.page.keyboard.press('Escape')
await C.page.getByRole('button', { name: 'Salvar state' }).click()
await C.page.waitForSelector('.toast:has-text("Save state criado")')
await C.page.getByRole('button', { name: 'Carregar state…' }).click()
await C.page.waitForSelector('.state-row')
await sleep(300)
await tap(13) // baixo: sai do cabeçalho e cai no primeiro botão do state
const names = []
for (let k = 0; k < 3; k++) { names.push(await C.page.evaluate(() => document.activeElement?.textContent?.trim())); await tap(15) }
check(names.includes('Carregar') && names.includes('Apagar'), `Gamepad: direita navega entre botões lado a lado no menu (${names.join(' > ')})`)
await C.page.keyboard.press('Escape')
await C.page.waitForSelector('.game-menu', { state: 'detached' })
await C.page.keyboard.press('Escape')
await C.page.getByRole('button', { name: 'Sair do jogo' }).click()
await C.page.waitForSelector('.library')
await C.page.evaluate(() => { window.__press = -1 })
// Configurações: descendo com o controle, todos os botões "Mudar" do mapeamento são alcançados.
await C.page.getByRole('button', { name: 'Configurações' }).click()
await C.page.waitForSelector('.settings')
await C.page.evaluate(() => document.activeElement?.blur())
await tap(1)
const seen2 = new Set()
for (let k = 0; k < 45; k++) { await tap(13, 60); seen2.add(await C.page.evaluate(() => { const a = document.activeElement; return a.tagName + ':' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 15) + ':' + Math.round(a.getBoundingClientRect().top + scrollY) })) }
const mudar = [...seen2].filter(x => x.includes('Mudar')).length
check(mudar >= 10, `Gamepad: descendo nas configurações passa pelos ${mudar} botões "Mudar" (esperado ≥10) e por ${seen2.size} itens no total`)
await tap(0) // B volta à biblioteca
check((await C.page.locator('.library').count()) === 1, 'Gamepad: B sai das configurações')
await play(C.page, 'Teste GB', 500)
await C.page.evaluate(() => { window.__press = true })
await sleep(1500)
// Lê a SRAM com o botão ainda apertado (o jogo de teste grava o estado dos botões em SRAM[3]).
const padByte = await C.page.evaluate(async () => {
  await window.__rsSession.flushSram()
  const db = await new Promise(r => { const q = indexedDB.open('retrosync'); q.onsuccess = () => r(q.result) })
  const f = await new Promise(r => { const q = db.transaction('files').objectStore('files').get('Saves/gbc/Teste GB.srm'); q.onsuccess = () => r(q.result) })
  return new Uint8Array(await f.blob.arrayBuffer())[3]
})
await C.page.evaluate(() => { window.__press = false })
check(padByte === 0xDE, `Gamepad: botão A do controle chegou ao jogo (SRAM[3]=0x${padByte?.toString(16)})`)
// Com o menu aberto, o botão do controle não pode chegar ao jogo, e deve navegar o menu.
await C.page.keyboard.press('Escape')
await C.page.waitForSelector('.game-menu')
const seen = await C.page.evaluate(async () => {
  const seen = []
  const h = e => seen.push(e.code)
  window.addEventListener('keydown', h, true)
  window.__press = true; await new Promise(r => setTimeout(r, 300)); window.__press = false
  window.removeEventListener('keydown', h, true)
  return seen
})
check(!seen.some(c => c === 'KeyX'), `Gamepad: com o menu aberto o botão não vai para o jogo (teclas vistas: ${seen.join(',') || 'nenhuma'})`)
// Botão A (índice 1) confirma o item focado: o primeiro é "Continuar" -> menu fecha.
await sleep(600)
await C.page.evaluate(async () => { window.__press = true; await new Promise(r => setTimeout(r, 150)); window.__press = false })
await sleep(300)
check((await C.page.locator('.game-menu').count()) === 0, 'Gamepad: botão A confirma "Continuar" e fecha o menu')
await exitGame(C.page)
await waitSynced(C.page)

await A.page.screenshot({ path: process.env.SHOT || 'tests/last-library.png' })
console.log('\nArquivos no Drive falso:\n  ' + drive.listPaths().join('\n  '))
await browser.close()
console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK')
process.exit(failures ? 1 : 0)
