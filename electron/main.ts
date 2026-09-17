import { app, BaseWindow, BrowserWindow, ipcMain, session, WebContentsView } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bounds, LayoutPayload, PanelPayload } from '../src/layout'

type SlotViewState = { view: WebContentsView; url: string }

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
const electronUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

let mainWindow: BaseWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayReady = false
let quadraSession: Electron.Session | null = null
let shuttingDown = false

const slotViews = new Map<string, SlotViewState>()
const testUserDataPath = process.env.QUADRA_TEST_USER_DATA
if (testUserDataPath) app.setPath('userData', testUserDataPath)

function isAllowedRemoteUrl(url: string) {
  return /^https?:\/\//i.test(url) && url.length <= 4096
}

function isUiSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return event.sender === overlayWindow?.webContents
}

function configureRemoteContents(contents: Electron.WebContents) {
  contents.setUserAgent(electronUserAgent)
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

function destroyAllSlotViews() {
  for (const index of [...slotViews.keys()]) destroySlotView(index)
}

function createSlotView(id: string, url: string) {
  const view = new WebContentsView({
    webPreferences: {
      session: quadraSession!,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  configureRemoteContents(view.webContents)
  mainWindow?.contentView.addChildView(view)
  const state = { view, url }
  slotViews.set(id, state)
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
  if (payload.mode !== 'auto' && payload.mode !== 'equal' && payload.mode !== 'manual') return false
  if (!Array.isArray(payload.panels) || payload.panels.length > 16) return false
  if (payload.view === 'grid' && payload.panels.length !== payload.panelCount) return false
  const ids = new Set<string>()
  return payload.panels.every((panel) => {
    if (!panel || typeof panel !== 'object') return false
    const candidate = panel as Partial<PanelPayload>
    if (typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 80 || ids.has(candidate.id)) return false
    ids.add(candidate.id)
    return typeof candidate.url === 'string' && candidate.url.length <= 4096 &&
      typeof candidate.editing === 'boolean' && Boolean(candidate.bounds) && isValidBounds(candidate.bounds as Bounds)
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
    if (!state) state = createSlotView(panel.id, panel.url)
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
      preload: join(__dirname, '../preload/preload.mjs'),
    },
  })
  overlayWindow.setBackgroundColor('#00000000')
  overlayWindow.setIgnoreMouseEvents(false)
  overlayWindow.on('closed', () => {
    overlayWindow = null
    overlayReady = false
  })
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayReady = true
    syncOverlayBounds()
    overlayWindow?.showInactive()
    raiseOverlay()
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
}

function createWindow() {
  mainWindow = new BaseWindow({
    title: 'Quadra — Multi-view', width: 1440, height: 900,
    backgroundColor: '#000000', autoHideMenuBar: true,
  })
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
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    destroyAllSlotViews()
  })
  mainWindow.maximize()
  mainWindow.show()
  createOverlay()
}

app.whenReady().then(() => {
  quadraSession = session.fromPartition('persist:quadra')
  quadraSession.setUserAgent(electronUserAgent)
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
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  app.quit()
})
