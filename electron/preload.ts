import { contextBridge, ipcRenderer } from 'electron'
import type { LayoutPayload } from '../src/layout'

const quadra = {
  ready: () => ipcRenderer.send('quadra:ready'),
  setLayout: (payload: LayoutPayload) => ipcRenderer.send('quadra:set-layout', payload),
  setFullscreen: (on: boolean) => ipcRenderer.send('quadra:set-fullscreen', on),
  setChromeInteractive: (interactive: boolean) => ipcRenderer.send('quadra:set-chrome-interactive', interactive),
  setCursorHidden: (hidden: boolean) => ipcRenderer.send('quadra:set-cursor-hidden', hidden),
  checkForUpdate: () => ipcRenderer.invoke('quadra:check-for-update'),
  openWeddbets: (panelId: string, label: string) => ipcRenderer.send('quadra:open-weddbets', panelId, label),
  setWeddbetsTarget: (panelId: string | null, label = '') => ipcRenderer.send('quadra:set-weddbets-target', panelId, label),
  onRequestLayout: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('quadra:request-layout', listener)
    return () => ipcRenderer.removeListener('quadra:request-layout', listener)
  },
  onFullscreenChange: (callback: (on: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, on: boolean) => callback(on)
    ipcRenderer.on('quadra:fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('quadra:fullscreen-changed', listener)
  },
  onWeddbetsPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { panelId: string; url: string }) => callback(payload)
    ipcRenderer.on('quadra:weddbets-player-opened', listener)
    return () => ipcRenderer.removeListener('quadra:weddbets-player-opened', listener)
  },
  onWeddbetsTargetRequired: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('quadra:weddbets-target-required', listener)
    return () => ipcRenderer.removeListener('quadra:weddbets-target-required', listener)
  },
  onWeddbetsError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { message: string; panelId?: string; url?: string }) => callback(payload)
    ipcRenderer.on('quadra:weddbets-error', listener)
    return () => ipcRenderer.removeListener('quadra:weddbets-error', listener)
  },
}

contextBridge.exposeInMainWorld('quadra', quadra)
