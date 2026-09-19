import { app, BaseWindow, BrowserWindow, ipcMain, session, WebContentsView } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bounds, LayoutPayload, PanelPayload } from '../src/layout'

type SlotViewState = { view: WebContentsView; url: string; cursorCssKey?: string; cursorRevision: number }

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const appIconPath = isDev
  ? join(process.cwd(), 'public', 'quadra.ico')
  : join(__dirname, '../renderer/quadra.ico')
const electronUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
const videoContainCss = `
  video {
    object-fit: contain !important;
    object-position: center center !important;
    background: #000 !important;
  }
`
const weddbetsPlayerCss = `
  html, body, #app {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    background: #000 !important;
    box-sizing: border-box !important;
  }
  #app > div,
  #app > div > div {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #app .rowOpenvidu,
  #app .rowAnt,
  #app .rowFlash,
  #app .rowMS,
  #app #frameVideo {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    max-height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #app .rowOpenvidu > .col-md-12,
  #app .rowAnt > .col-md-12,
  #app .rowFlash > .col-md-12,
  #app .rowMS > .col-md-12 {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    max-height: 100% !important;
    max-width: 100% !important;
    padding: 0 !important;
    margin: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #subscriber,
  #playFlash,
  #frameVideo {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  #subscriber video,
  #remoteVideo,
  #flashPlayVideo,
  #msPlayVideo,
  #msPlayVideoBackup {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    border: 0 !important;
    box-sizing: border-box !important;
    object-fit: contain !important;
    object-position: center center !important;
    background: #000 !important;
    vertical-align: top !important;
  }
`

let mainWindow: BaseWindow | null = null
let overlayWindow: BrowserWindow | null = null
let weddbetsWindow: BrowserWindow | null = null
let overlayReady = false
let quadraSession: Electron.Session | null = null
let shuttingDown = false
let cursorHidden = false
let weddbetsTarget: { id: string; label: string } | null = null
let visiblePanelIds = new Set<string>()
let fullscreenPrioritySyncPending = false

const weddbetsHomeUrl = process.env.QUADRA_WEDDBETS_URL ?? 'https://www.weddbets.com/'

const slotViews = new Map<string, SlotViewState>()
const testUserDataPath = process.env.QUADRA_TEST_USER_DATA
if (testUserDataPath) app.setPath('userData', testUserDataPath)

function isAllowedRemoteUrl(url: string) {
  return /^https?:\/\//i.test(url) && url.length <= 4096
}

function isUiSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return event.sender === overlayWindow?.webContents
}

function shouldKeepFullscreenPriority() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return false
  if (!mainWindow.isFullScreen() || mainWindow.isMinimized()) return false
  return mainWindow.isFocused() || Boolean(
    overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isFocused(),
  )
}

function reconcileFullscreenPriority() {
  fullscreenPrioritySyncPending = false
  const keepPriority = shouldKeepFullscreenPriority()
  for (const window of [mainWindow, overlayWindow]) {
    if (!window || window.isDestroyed() || window.isAlwaysOnTop() === keepPriority) continue
    window.setAlwaysOnTop(keepPriority, 'screen-saver')
  }
}

function scheduleFullscreenPrioritySync() {
  if (fullscreenPrioritySyncPending) return
  fullscreenPrioritySyncPending = true
  setImmediate(reconcileFullscreenPriority)
}

function watchFullscreenPriority(window: BaseWindow | BrowserWindow) {
  window.on('always-on-top-changed', scheduleFullscreenPrioritySync)
  window.on('focus', scheduleFullscreenPrioritySync)
  window.on('blur', scheduleFullscreenPrioritySync)
  window.on('enter-full-screen', scheduleFullscreenPrioritySync)
  window.on('leave-full-screen', scheduleFullscreenPrioritySync)
  window.on('minimize', scheduleFullscreenPrioritySync)
  window.on('restore', scheduleFullscreenPrioritySync)
}

function normalizeWeddbetsPlayerUrl(value: string) {
  try {
    const url = new URL(value, weddbetsHomeUrl)
    const home = new URL(weddbetsHomeUrl)
    if (url.origin !== home.origin || !/^\/view\/[^/]+\/?$/i.test(url.pathname)) return null
    url.searchParams.set('view', 'clean')
    return url.toString()
  } catch {
    return null
  }
}

function updateWeddbetsWindowTitle() {
  if (!weddbetsWindow || weddbetsWindow.isDestroyed()) return
  weddbetsWindow.setTitle(weddbetsTarget
    ? `WeddBets — abrir no ${weddbetsTarget.label}`
    : 'WeddBets — escolha um painel no Quadra')
}

function setWeddbetsTarget(id: string | null, label = '') {
  weddbetsTarget = id && visiblePanelIds.has(id) ? { id, label } : null
  updateWeddbetsWindowTitle()
}

function configureWeddbetsCatalog(contents: Electron.WebContents) {
  contents.setUserAgent(electronUserAgent)
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) overlayWindow?.webContents.send('quadra:weddbets-error', {
      message: `Não foi possível abrir o catálogo (${errorDescription}).`,
      url: validatedURL,
    })
  })
  contents.setWindowOpenHandler(({ url }) => {
    const playerUrl = normalizeWeddbetsPlayerUrl(url)
    if (!playerUrl) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            session: quadraSession!,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }
    if (!weddbetsTarget || !visiblePanelIds.has(weddbetsTarget.id)) {
      setWeddbetsTarget(null)
      overlayWindow?.webContents.send('quadra:weddbets-target-required')
      overlayWindow?.show()
      overlayWindow?.focus()
      return { action: 'deny' }
    }
    const existing = slotViews.get(weddbetsTarget.id)
    if (existing?.url === playerUrl && !existing.view.webContents.isDestroyed()) {
      void existing.view.webContents.loadURL(playerUrl).catch(() => {})
    }
    overlayWindow?.webContents.send('quadra:weddbets-player-opened', {
      panelId: weddbetsTarget.id,
      url: playerUrl,
    })
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault()
  })
}

function openWeddbetsCatalog(id: string, label: string) {
  if (!visiblePanelIds.has(id)) return
  setWeddbetsTarget(id, label)
  if (weddbetsWindow && !weddbetsWindow.isDestroyed()) {
    if (weddbetsWindow.isMinimized()) weddbetsWindow.restore()
    weddbetsWindow.show()
    weddbetsWindow.focus()
    return
  }
  weddbetsWindow = new BrowserWindow({
    title: `WeddBets — abrir no ${label}`,
    icon: appIconPath,
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    webPreferences: {
      session: quadraSession!,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  configureWeddbetsCatalog(weddbetsWindow.webContents)
  weddbetsWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault()
    updateWeddbetsWindowTitle()
  })
  weddbetsWindow.on('closed', () => {
    weddbetsWindow = null
    weddbetsTarget = null
  })
  void weddbetsWindow.loadURL(weddbetsHomeUrl).catch(() => {})
}

function configureRemoteContents(contents: Electron.WebContents, slotId?: string) {
  contents.setUserAgent(electronUserAgent)
  contents.on('did-finish-load', () => {
    void contents.insertCSS(videoContainCss, { cssOrigin: 'user' }).catch(() => {})
    if (!normalizeWeddbetsPlayerUrl(contents.getURL())) return
    void contents.insertCSS(weddbetsPlayerCss, { cssOrigin: 'user' }).catch(() => {})
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!slotId || !isMainFrame || errorCode === -3 || !normalizeWeddbetsPlayerUrl(validatedURL)) return
    overlayWindow?.webContents.send('quadra:weddbets-error', {
      message: `O player do WeddBets não carregou (${errorDescription}). Tente escolher o jogo novamente.`,
      panelId: slotId,
      url: validatedURL,
    })
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedRemoteUrl(url)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        width: 1100,
        height: 760,
        webPreferences: {
          session: quadraSession!,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
    }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedRemoteUrl(url)) event.preventDefault()
  })
}

function destroySlotView(id: string) {
  const state = slotViews.get(id)
  if (!state) return
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(state.view)
  if (!state.view.webContents.isDestroyed()) state.view.webContents.close()
  slotViews.delete(id)
}

async function syncSlotCursor(state: SlotViewState) {
  const revision = ++state.cursorRevision
  if (!cursorHidden) {
    const key = state.cursorCssKey
    state.cursorCssKey = undefined
    if (key && !state.view.webContents.isDestroyed()) await state.view.webContents.removeInsertedCSS(key).catch(() => {})
    return
  }
  if (state.cursorCssKey || state.view.webContents.isDestroyed()) return
  const key = await state.view.webContents.insertCSS('* { cursor: none !important; }').catch(() => '')
  if (!key) return
  if (revision !== state.cursorRevision || !cursorHidden || state.view.webContents.isDestroyed()) {
    if (!state.view.webContents.isDestroyed()) await state.view.webContents.removeInsertedCSS(key).catch(() => {})
    return
  }
  state.cursorCssKey = key
}

function setCursorHidden(hidden: boolean) {
  if (cursorHidden === hidden) return
  cursorHidden = hidden
  for (const state of slotViews.values()) void syncSlotCursor(state)
}

function destroyAllSlotViews() {
  for (const index of [...slotViews.keys()]) destroySlotView(index)
}

function createSlotView(id: string, url: string, muted: boolean) {
  const view = new WebContentsView({
    webPreferences: {
      session: quadraSession!,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  configureRemoteContents(view.webContents, id)
  view.webContents.setAudioMuted(muted)
  mainWindow?.contentView.addChildView(view)
  const state: SlotViewState = { view, url, cursorRevision: 0 }
  slotViews.set(id, state)
  if (cursorHidden) void syncSlotCursor(state)
  void view.webContents.loadURL(url).catch(() => {})
  return state
}

function isValidBounds(bounds: Bounds) {
  return (
    Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0 &&
    bounds.width <= 10000 && bounds.height <= 10000
  )
}

function isValidLayoutPayload(value: unknown): value is LayoutPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<LayoutPayload>
  if (payload.view !== 'choose' && payload.view !== 'grid') return false
  if (!Number.isInteger(payload.panelCount) || Number(payload.panelCount) < 1 || Number(payload.panelCount) > 16) return false
  if (payload.mode !== 'auto' && payload.mode !== 'equal' && payload.mode !== 'highlights') return false
  if (!Array.isArray(payload.panels) || payload.panels.length > 16) return false
  if (payload.view === 'grid' && payload.panels.length !== payload.panelCount) return false
  const ids = new Set<string>()
  return payload.panels.every((panel) => {
    if (!panel || typeof panel !== 'object') return false
    const candidate = panel as Partial<PanelPayload>
    if (typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 80 || ids.has(candidate.id)) return false
    ids.add(candidate.id)
    return typeof candidate.url === 'string' && candidate.url.length <= 4096 &&
      typeof candidate.muted === 'boolean' && typeof candidate.editing === 'boolean' &&
      Boolean(candidate.bounds) && isValidBounds(candidate.bounds as Bounds)
  })
}

function syncOverlayBounds() {
  if (!mainWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setBounds(mainWindow.getContentBounds())
}

function raiseOverlay() {
  if (!mainWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  syncOverlayBounds()
  if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  overlayWindow.moveTop()
}

function applyLayout(payload: LayoutPayload) {
  if (!mainWindow) return
  visiblePanelIds = new Set(payload.panels.map((panel) => panel.id))
  if (weddbetsTarget && !visiblePanelIds.has(weddbetsTarget.id)) setWeddbetsTarget(null)
  if (payload.view === 'choose') {
    destroyAllSlotViews()
    raiseOverlay()
    return
  }
  const visibleSlots = new Set<string>()
  for (const panel of payload.panels) {
    if (!panel.url || !isAllowedRemoteUrl(panel.url) || !isValidBounds(panel.bounds)) {
      destroySlotView(panel.id)
      continue
    }
    visibleSlots.add(panel.id)
    let state = slotViews.get(panel.id)
    if (!state) state = createSlotView(panel.id, panel.url, panel.muted)
    state.view.webContents.setAudioMuted(panel.muted)
    if (state.url !== panel.url) {
      state.url = panel.url
      void state.view.webContents.loadURL(panel.url).catch(() => {})
    }
    state.view.setBounds({
      x: Math.round(panel.bounds.x),
      y: Math.round(panel.bounds.y),
      width: Math.max(1, Math.round(panel.bounds.width)),
      height: Math.max(1, Math.round(panel.bounds.height)),
    })
    state.view.setVisible(true)
  }
  for (const id of [...slotViews.keys()]) {
    if (!visibleSlots.has(id)) destroySlotView(id)
  }
  raiseOverlay()
}

function createOverlay() {
  if (!mainWindow) return
  overlayWindow = new BrowserWindow({
    parent: mainWindow,
    frame: false,
    transparent: true,
    show: false,
    focusable: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: join(__dirname, '../preload/preload.mjs'),
    },
  })
  watchFullscreenPriority(overlayWindow)
  overlayWindow.setBackgroundColor('#00000000')
  overlayWindow.setIgnoreMouseEvents(false)
  overlayWindow.on('closed', () => {
    overlayWindow = null
    overlayReady = false
    scheduleFullscreenPrioritySync()
  })
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true
    syncOverlayBounds()
    overlayWindow?.showInactive()
    raiseOverlay()
    scheduleFullscreenPrioritySync()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  const load = isDev
    ? overlayWindow.webContents.loadURL(process.env.ELECTRON_RENDERER_URL!)
    : overlayWindow.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  void load.catch(() => {})
}

function installIpcHandlers() {
  ipcMain.on('quadra:ready', (event) => {
    if (isUiSender(event) && overlayReady) raiseOverlay()
  })
  ipcMain.on('quadra:set-layout', (event, payload: unknown) => {
    if (isUiSender(event) && isValidLayoutPayload(payload)) applyLayout(payload)
  })
  ipcMain.on('quadra:set-chrome-interactive', (event, interactive: unknown) => {
    if (!isUiSender(event) || typeof interactive !== 'boolean' || !overlayWindow) return
    overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true })
  })
  ipcMain.on('quadra:set-fullscreen', (event, on: unknown) => {
    if (isUiSender(event) && typeof on === 'boolean') mainWindow?.setFullScreen(on)
  })
  ipcMain.on('quadra:set-cursor-hidden', (event, hidden: unknown) => {
    if (isUiSender(event) && typeof hidden === 'boolean') setCursorHidden(hidden)
  })
  ipcMain.on('quadra:open-weddbets', (event, id: unknown, label: unknown) => {
    if (!isUiSender(event) || typeof id !== 'string' || typeof label !== 'string') return
    openWeddbetsCatalog(id, label)
  })
  ipcMain.on('quadra:set-weddbets-target', (event, id: unknown, label: unknown) => {
    if (!isUiSender(event)) return
    if (id === null) {
      setWeddbetsTarget(null)
      return
    }
    if (typeof id === 'string' && typeof label === 'string') setWeddbetsTarget(id, label)
  })
}

function createWindow() {
  mainWindow = new BaseWindow({
    title: 'Quadra — Multi-view', width: 1440, height: 900,
    backgroundColor: '#000000', autoHideMenuBar: true, icon: appIconPath,
  })
  watchFullscreenPriority(mainWindow)
  mainWindow.setMinimumSize(960, 620)
  mainWindow.on('resize', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('move', syncOverlayBounds)
  mainWindow.on('maximize', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('unmaximize', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('enter-full-screen', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:fullscreen-changed', true)
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('leave-full-screen', () => {
    syncOverlayBounds()
    overlayWindow?.webContents.send('quadra:fullscreen-changed', false)
    overlayWindow?.webContents.send('quadra:request-layout')
  })
  mainWindow.on('restore', () => {
    syncOverlayBounds()
    overlayWindow?.showInactive()
    overlayWindow?.webContents.send('quadra:request-layout')
    scheduleFullscreenPrioritySync()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    if (weddbetsWindow && !weddbetsWindow.isDestroyed()) weddbetsWindow.close()
    destroyAllSlotViews()
    scheduleFullscreenPrioritySync()
  })
  mainWindow.maximize()
  mainWindow.show()
  createOverlay()
  scheduleFullscreenPrioritySync()
}

app.whenReady().then(() => {
  quadraSession = session.fromPartition('persist:quadra')
  quadraSession.setUserAgent(electronUserAgent)
  if (process.platform === 'win32') app.setAppUserModelId('com.quadra.multiview')
  installIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  destroyAllSlotViews()
  if (weddbetsWindow && !weddbetsWindow.isDestroyed()) weddbetsWindow.close()
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  app.quit()
})
