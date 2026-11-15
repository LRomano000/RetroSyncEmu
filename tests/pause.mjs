// Testa pausa/despausa do menu e carregamento de save state (bug: pausa invertida após carregar state).
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { FakeDrive, attachFakes } from './fake-google.mjs'
const require = createRequire(execSync('npm root -g').toString().trim() + '/')
const { chromium } = require('playwright')
const BASE = process.env.BASE_URL || 'http://localhost:5199/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) failures++ }
const drive = new FakeDrive()
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext()
await ctx.addInitScript(() => localStorage.setItem('rs.clientId', 'fake'))
await attachFakes(ctx, drive)
const page = await ctx.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
page.on('dialog', d => d.accept())
await page.goto(BASE)
await page.getByRole('button', { name: 'Entrar com Google' }).first().click()
await page.waitForSelector('.banner', { state: 'detached' })
await page.setInputFiles('input[type=file]', ['test-roms/Teste GBA.gba'])
await page.waitForSelector('.tile')
await page.locator('.tile-play').click()
await page.waitForSelector('.menu-fab', { timeout: 60000 })
await sleep(1000)

// Rodando = dois save states seguidos são diferentes; pausado = iguais.
async function running() {
  return page.evaluate(async () => {
    const s = window.__rsSession
    const h = async () => { const b = new Uint8Array(await (await s.n.saveState()).state.arrayBuffer()); let x = 0; for (const v of b) x = (x * 31 + v) >>> 0; return x }
    const a = await h(); await new Promise(r => setTimeout(r, 300)); return a !== await h()
  })
}
// Byte da SRAM gravada pelo app (IndexedDB) depois de forçar uma gravação.
async function savedByte(path, off) {
  return page.evaluate(async ([path, off]) => {
    await window.__rsSession.flushSram()
    const db = await new Promise(r => { const q = indexedDB.open('retrosync'); q.onsuccess = () => r(q.result) })
    const f = await new Promise(r => { const q = db.transaction('files').objectStore('files').get(path); q.onsuccess = () => r(q.result) })
    return f ? new Uint8Array(await f.blob.arrayBuffer())[off] : null
  }, [path, off])
}
async function sramLive(path, off) {
  const a = await savedByte(path, off); await sleep(300); const b = await savedByte(path, off); await sleep(300); const c = await savedByte(path, off)
  return a !== null && !(a === b && b === c)
}
const menuOpen = () => page.locator('.game-menu').count().then(n => n > 0)

check(await running(), 'jogo rodando após abrir')
await page.keyboard.press('Escape')
check(await menuOpen() && !(await running()), 'menu aberto -> pausado')
await page.getByRole('button', { name: 'Salvar state' }).click()
await page.waitForSelector('.toast:has-text("Save state criado")')
check(!(await running()), 'continua pausado depois de salvar state com o menu aberto')
await page.getByRole('button', { name: 'Continuar' }).click()
check(await running(), 'Continuar -> rodando')

for (let round = 1; round <= 3; round++) {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Carregar state…' }).click()
  await page.locator('.state-row').first().getByRole('button', { name: 'Carregar' }).click()
  await page.waitForSelector('.toast:has-text("Save state carregado")')
  await sleep(300)
  check(!(await menuOpen()) && await running(), `rodada ${round}: carregou state -> menu fechado e rodando`)
  await page.keyboard.press('Escape')
  check(!(await running()), `rodada ${round}: abrir menu -> pausado`)
  await page.keyboard.press('Escape')
  check(await running(), `rodada ${round}: fechar menu (Esc) -> rodando`)
}
// Trocar de aba/janela não deve inverter a pausa
await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
await sleep(300)
check(await running(), 'blur/focus da janela não deixa o jogo pausado')

check(await sramLive('Saves/gba/Teste GBA.srm', 0), 'GBA: SRAM continua sendo salva depois de carregar state')

// GB: SRAM depois de carregar state pelo menu e ao abrir o jogo com o último state
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Sair do jogo' }).click()
await page.waitForSelector('.library')
await page.setInputFiles('input[type=file]', ['test-roms/Teste GB.gb'])
await page.waitForFunction(() => document.querySelectorAll('.tile').length === 2)
const gbTile = page.locator('.tile').filter({ has: page.locator('.tile-title[title="Teste GB"]') })
await gbTile.locator('.tile-play').click()
await page.waitForSelector('.menu-fab', { timeout: 60000 }); await sleep(800)
check(await sramLive('Saves/gb/Teste GB.srm', 4), 'GB: SRAM salva normalmente (sem state)')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Salvar state' }).click()
await page.waitForSelector('.toast:has-text("Save state criado")')
await page.getByRole('button', { name: 'Carregar state…' }).click()
await page.locator('.state-row').first().getByRole('button', { name: 'Carregar' }).click()
await page.waitForSelector('.toast:has-text("Save state carregado")')
check(await sramLive('Saves/gb/Teste GB.srm', 4), 'GB: SRAM continua sendo salva depois de carregar state pelo menu')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Sair do jogo' }).click()
await page.waitForSelector('.library')
await gbTile.locator('.tile-play').click()
await page.waitForSelector('.menu-fab', { timeout: 60000 }); await sleep(800)
check(await page.locator('.toast:has-text("Save state carregado")').count() === 1, 'GB: reabriu carregando o último state')
check(await sramLive('Saves/gb/Teste GB.srm', 4), 'GB: SRAM continua sendo salva ao abrir com state')

await browser.close()
console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK')
process.exit(failures ? 1 : 0)
