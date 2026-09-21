import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { AppUpdater } from 'electron-updater'

type UpdateInfo = { version?: unknown }
type UpdateState = 'idle' | 'checking' | 'prompting-download' | 'downloading' | 'downloaded' | 'installing'

type UpdateDialog = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

type AutoUpdateOptions = {
  enabled: boolean
  updater: AppUpdater
  showMessageBox: UpdateDialog
  quitAndInstall: () => void
  onInstallError?: () => void
  log?: (message: string) => void
}

export type AutoUpdateController = {
  check: () => Promise<void>
  getState: () => UpdateState
}

function versionLabel(info: UpdateInfo) {
  return typeof info.version === 'string' && info.version.length > 0 ? `v${info.version}` : 'disponível'
}

export function createAutoUpdateController({
  enabled,
  updater,
  showMessageBox,
  quitAndInstall,
  onInstallError,
  log = () => {},
}: AutoUpdateOptions): AutoUpdateController {
  let state: UpdateState = 'idle'
  let checkPromise: Promise<void> | null = null

  if (!enabled) return { check: async () => {}, getState: () => state }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.disableWebInstaller = true

  const promptDownload = async (info: UpdateInfo) => {
    try {
      const result = await showMessageBox({
        type: 'info',
        title: 'Atualização disponível',
        message: `A versão ${versionLabel(info)} do Quadra está disponível.`,
        detail: 'Baixar agora? Os painéis continuam funcionando enquanto o download acontece.',
        buttons: ['Atualizar', 'Agora não'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (state !== 'prompting-download') return
      if (result.response !== 0) {
        state = 'idle'
        return
      }
      state = 'downloading'
      await updater.downloadUpdate()
    } catch {
      state = 'idle'
      log('Falha ao iniciar o download da atualização.')
    }
  }

  const promptInstall = async (info: UpdateInfo) => {
    try {
      const result = await showMessageBox({
        type: 'info',
        title: 'Atualização pronta',
        message: `A versão ${versionLabel(info)} foi baixada.`,
        detail: 'Reiniciar e instalar interrompe os painéis abertos. Você pode fazer isso depois.',
        buttons: ['Reiniciar e instalar', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (state !== 'downloaded' || result.response !== 0) return
      state = 'installing'
      quitAndInstall()
    } catch {
      state = 'downloaded'
      log('Falha ao preparar a instalação da atualização.')
    }
  }

  updater.on('update-available', (info) => {
    if (state !== 'checking' && state !== 'idle') return
    state = 'prompting-download'
    void promptDownload(info)
  })
  updater.on('update-downloaded', (info) => {
    if (state === 'downloaded' || state === 'installing') return
    state = 'downloaded'
    void promptInstall(info)
  })
  updater.on('update-cancelled', () => {
    if (state === 'downloading' || state === 'prompting-download') state = 'idle'
  })
  updater.on('error', () => {
    if (state === 'installing') {
      state = 'downloaded'
      onInstallError?.()
    } else {
      state = 'idle'
    }
    log('Não foi possível consultar ou baixar a atualização.')
  })

  const check = async () => {
    if (state !== 'idle') return checkPromise ?? Promise.resolve()
    state = 'checking'
    checkPromise = updater.checkForUpdates()
      .then(() => {})
      .catch(() => {
        state = 'idle'
        log('Não foi possível consultar atualizações.')
      })
      .finally(() => {
        checkPromise = null
        if (state === 'checking') state = 'idle'
      })
    await checkPromise
  }

  return { check, getState: () => state }
}

