import type { LayoutPayload } from './layout'

type QuadraBridge = {
  ready: () => void
  setLayout: (payload: LayoutPayload) => void
  setFullscreen: (on: boolean) => void
  setChromeInteractive: (interactive: boolean) => void
  setCursorHidden: (hidden: boolean) => void
  openWeddbets: (panelId: string, label: string) => void
  setWeddbetsTarget: (panelId: string | null, label?: string) => void
  onRequestLayout: (callback: () => void) => () => void
  onFullscreenChange: (callback: (on: boolean) => void) => () => void
  onWeddbetsPlayerOpened: (callback: (payload: { panelId: string; url: string }) => void) => () => void
  onWeddbetsTargetRequired: (callback: () => void) => () => void
  onWeddbetsError: (callback: (payload: { message: string; panelId?: string; url?: string }) => void) => () => void
}

declare global {
  interface Window {
    quadra?: QuadraBridge
  }
}

export {}
