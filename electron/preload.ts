import { contextBridge, ipcRenderer } from 'electron'
import type { LayoutPayload } from '../src/layout'

const quadra = {
  ready: () => ipcRenderer.send('quadra:ready'),
  setLayout: (payload: LayoutPayload) => ipcRenderer.send('quadra:set-layout', payload),
  setFullscreen: (on: boolean) => ipcRenderer.send('quadra:set-fullscreen', on),
  setChromeInteractive: (interactive: boolean) => ipcRenderer.send('quadra:set-chrome-interactive', interactive),
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
}

contextBridge.exposeInMainWorld('quadra', quadra)
