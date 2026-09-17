const electronModule = require('electron')

// The harness used for Node scripts exports ELECTRON_RUN_AS_NODE. Re-launch
// this same file through the Electron binary so require('electron') exposes
// the real app APIs in every environment.
if (typeof electronModule === 'string') {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electronModule, [__filename], { stdio: 'inherit', env, windowsHide: true })
  process.exit(result.status ?? 1)
}

const assert = require('node:assert/strict')
const { app, BrowserWindow } = electronModule
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('disable-gpu')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-renderer-smoke-'))
app.setPath('userData', userData)

function waitFrame() {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

async function run() {
  app.disableHardwareAcceleration()
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.webContents.setBackgroundThrottling(false)

  try {
    await window.loadFile(path.join(projectRoot, 'out', 'renderer', 'index.html'))
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const waitFrame = () => new Promise((resolve) => setTimeout(resolve, 40))
        const readLayout = () => {
          const stage = document.querySelector('.layout-stage')
          const stageRect = stage.getBoundingClientRect()
          const panels = [...document.querySelectorAll('.panel')]
          const rects = panels.map((panel) => {
            const rect = panel.getBoundingClientRect()
            return { id: panel.dataset.panelId, x: rect.left - stageRect.left, y: rect.top - stageRect.top, width: rect.width, height: rect.height }
          })
          let noOverlap = true
          for (let index = 0; index < rects.length; index += 1) {
            for (let other = index + 1; other < rects.length; other += 1) {
              const a = rects[index]
              const b = rects[other]
              const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
              const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
              if (width > 0.5 && height > 0.5) noOverlap = false
            }
          }
          return {
            count: panels.length,
            mode: stage.dataset.layoutMode,
            allHaveArea: panels.every((panel) => panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0),
            forms: panels.every((panel) => Boolean(panel.querySelector('input[name="url"]'))),
            noOverlap,
            rects,
          }
        }
        const result = { version: document.querySelector('.app-version')?.textContent ?? '', layouts: [], interactions: {} }

        document.querySelector('#btn-start-one').click()
        await waitFrame()
        result.interactions.startsWithOne = document.querySelectorAll('.panel').length === 1 &&
          document.querySelector('.panel[data-slot="0"] input[name="url"]') === document.activeElement
        const firstDraft = document.querySelector('.panel[data-slot="0"] input[name="url"]')
        firstDraft.value = 'https://example.com/draft'
        firstDraft.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('#btn-add-panel').click()
        await waitFrame()
        const addedPanel = document.querySelector('.panel[data-slot="1"]')
        result.interactions.addsPanel = document.querySelectorAll('.panel').length === 2
        result.interactions.preservesDraft = document.querySelector('.panel[data-slot="0"] input[name="url"]').value === 'https://example.com/draft'
        result.interactions.focusesNewPanel = addedPanel?.querySelector('input[name="url"]') === document.activeElement
        while (document.querySelectorAll('.panel').length < 16) {
          document.querySelector('#btn-add-panel').click()
          await waitFrame()
        }
        result.interactions.addsUntilSixteen = document.querySelectorAll('.panel').length === 16
        result.interactions.disablesAtLimit = document.querySelector('#btn-add-panel').disabled
        document.querySelector('#btn-layout').click()
        await waitFrame()
        document.querySelector('.confirm [data-ok]').click()
        await waitFrame()

        for (let count = 1; count <= 16; count += 1) {
          document.querySelector('[data-count="' + count + '"]').click()
          await waitFrame()
          const layout = readLayout()
          layout.expectedCount = count
          layout.className = document.querySelector('.grid')?.className ?? ''
          result.layouts.push(layout)
          document.querySelector('#btn-layout').click()
          await waitFrame()
          document.querySelector('.confirm [data-ok]').click()
          await waitFrame()
        }

        document.querySelector('[data-count="6"]').click()
        await waitFrame()
        document.querySelector('#btn-organize').click()
        await waitFrame()
        const first = document.querySelector('.panel[data-slot="0"]')
        const second = document.querySelector('.panel[data-slot="1"]')
        const highlightedIds = [first.dataset.panelId, second.dataset.panelId]
        first.querySelector('[data-highlight]').click()
        second.querySelector('[data-highlight]').click()
        await waitFrame()
        const focused = readLayout()
        const largeAreas = focused.rects.filter((rect) => highlightedIds.includes(rect.id)).map((rect) => rect.width * rect.height)
        const smallAreas = focused.rects.filter((rect) => !highlightedIds.includes(rect.id)).map((rect) => rect.width * rect.height)
        result.interactions.twoHighlightsHaveMoreArea = Math.min(...largeAreas) > Math.max(...smallAreas)

        const handle = document.querySelector('.split-handle')
        const beforeRatio = handle.getAttribute('aria-valuenow')
        handle.focus()
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        await waitFrame()
        result.interactions.keyboardResizesSplit = beforeRatio !== handle.getAttribute('aria-valuenow')
        const resizedRatio = handle.getAttribute('aria-valuenow')
        document.querySelector('#btn-more').click()
        await waitFrame()
        document.querySelector('#btn-undo').click()
        await waitFrame()
        result.interactions.undoRestoresSplit = resizedRatio !== document.querySelector('.split-handle').getAttribute('aria-valuenow')

        document.querySelector('.panel[data-slot="0"] [data-move]').click()
        await waitFrame()
        result.interactions.movePickerOpens = Boolean(document.querySelector('.move-picker'))
        document.querySelector('.move-picker [data-move-to]').click()
        await waitFrame()
        result.interactions.movePickerCloses = !document.querySelector('.move-picker')

        let openPanel = document.querySelector('.panel[data-slot="0"]')
        const input = openPanel.querySelector('input[name="url"]')
        input.value = 'https://example.com/video'
        openPanel.querySelector('.panel__bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await waitFrame()
        openPanel = document.querySelector('.panel[data-slot="0"]')
        result.interactions.urlOpens = openPanel.classList.contains('panel--loaded') && Boolean(openPanel.querySelector('.panel__stage'))
        openPanel.querySelector('[data-edit]').click()
        await waitFrame()
        result.interactions.editOpens = openPanel.classList.contains('is-editing')
        openPanel.querySelector('[data-clear]').click()
        await waitFrame()
        result.interactions.clearRestoresEmpty = document.querySelector('.panel[data-slot="0"]').classList.contains('panel--empty')

        document.querySelector('#btn-more').click()
        await waitFrame()
        result.interactions.moreMenuOpens = !document.querySelector('#toolbar-more-menu').hidden
        document.querySelector('#btn-equal').click()
        await waitFrame()
        result.interactions.equalMode = document.querySelector('.layout-stage').dataset.layoutMode === 'equal'

        const countSelect = document.querySelector('#panel-count')
        countSelect.value = '13'
        countSelect.dispatchEvent(new Event('change', { bubbles: true }))
        await waitFrame()
        const heroPanel = document.querySelector('.panel[data-slot="0"]')
        const heroId = heroPanel.dataset.panelId
        heroPanel.querySelector('[data-highlight]').click()
        await waitFrame()
        const thirteen = readLayout()
        const heroRect = thirteen.rects.find((rect) => rect.id === heroId)
        const otherAreas = thirteen.rects.filter((rect) => rect.id !== heroId).map((rect) => rect.width * rect.height)
        result.interactions.thirteenHasHeroQuadrant = Boolean(heroRect) && heroRect.width * heroRect.height > Math.max(...otherAreas) * 3

        return result
      })()
    `)

    assert.equal(result.version, 'v1.02')
    assert.equal(result.layouts.length, 16)
    for (const layout of result.layouts) {
      assert.equal(layout.count, layout.expectedCount)
      assert.equal(layout.allHaveArea, true, JSON.stringify(layout))
      assert.equal(layout.forms, true, JSON.stringify(layout))
      assert.equal(layout.noOverlap, true, JSON.stringify(layout))
      assert.match(layout.className, new RegExp('grid--' + layout.count + '(?: |$)'))
    }
    assert.equal(result.interactions.twoHighlightsHaveMoreArea, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.startsWithOne, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.addsPanel, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.preservesDraft, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.focusesNewPanel, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.addsUntilSixteen, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.disablesAtLimit, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.keyboardResizesSplit, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.undoRestoresSplit, true, JSON.stringify(result.interactions))
    assert.equal(result.interactions.movePickerOpens, true)
    assert.equal(result.interactions.movePickerCloses, true)
    assert.equal(result.interactions.urlOpens, true)
    assert.equal(result.interactions.editOpens, true)
    assert.equal(result.interactions.clearRestoresEmpty, true)
    assert.equal(result.interactions.moreMenuOpens, true)
    assert.equal(result.interactions.equalMode, true)
    assert.equal(result.interactions.thirteenHasHeroQuadrant, true, JSON.stringify(result.interactions))
    console.log(JSON.stringify(result))
  } finally {
    window.destroy()
    setTimeout(() => app.exit(0), 50)
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt += 1) {
      try { fs.rmSync(userData, { recursive: true, force: true }) } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
    }
  }
}

run().catch((error) => {
  console.error(error)
  setTimeout(() => app.exit(1), 50)
})
