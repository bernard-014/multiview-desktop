import type { LayoutPayload } from './layout'

type QuadraBridge = {
  ready: () => void
  setLayout: (payload: LayoutPayload) => void
  setFullscreen: (on: boolean) => void
  setChromeInteractive: (interactive: boolean) => void
  onRequestLayout: (callback: () => void) => () => void
  onFullscreenChange: (callback: (on: boolean) => void) => () => void
}

declare global {
  interface Window {
    quadra?: QuadraBridge
  }
}

export {}
