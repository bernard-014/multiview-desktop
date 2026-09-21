import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { createAutoUpdateController } from '../electron/update.ts'

type FakeUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<string[]>
}

function fakeUpdater(): FakeUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    checkForUpdates: async () => {},
    downloadUpdate: async () => [],
  })
}

function controllerFor(
  updater: FakeUpdater,
  responses: number[],
  dialogs: MessageBoxOptions[],
  quit: () => void,
  onInstallError: () => void = () => {},
) {
  const showMessageBox = async (options: MessageBoxOptions): Promise<MessageBoxReturnValue> => {
    dialogs.push(options)
    return { response: responses.shift() ?? 1 }
  }
  return createAutoUpdateController({
    enabled: true,
    updater: updater as unknown as AppUpdater,
    showMessageBox,
    quitAndInstall: quit,
    onInstallError,
  })
}

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('só baixa após consentimento, não duplica operações e adia sem instalar ao sair', async () => {
  const updater = fakeUpdater()
  const dialogs: MessageBoxOptions[] = []
  let checks = 0
  let downloads = 0
  let quitCalls = 0
  let resolveCheck!: () => void
  updater.checkForUpdates = () => {
    checks += 1
    return new Promise<void>((resolve) => { resolveCheck = resolve })
  }
  updater.downloadUpdate = async () => {
    downloads += 1
    updater.emit('update-downloaded', { version: '1.0.10' })
    return []
  }
  const controller = controllerFor(updater, [0, 1], dialogs, () => { quitCalls += 1 })

  const checkPromise = controller.check()
  await nextTick()
  assert.equal(controller.getState(), 'checking')
  updater.emit('update-available', { version: '1.0.10' })
  await nextTick()
  await nextTick()
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(downloads, 1)
  assert.deepEqual(dialogs.map(({ buttons }) => buttons), [
    ['Atualizar', 'Agora não'],
    ['Reiniciar e instalar', 'Depois'],
  ])
  assert.equal(controller.getState(), 'downloaded')
  updater.emit('update-downloaded', { version: '1.0.10' })
  await nextTick()
  assert.equal(dialogs.length, 2)
  updater.emit('update-available', { version: '1.0.10' })
  await nextTick()
  assert.equal(dialogs.length, 2)
  const duplicateCheck = controller.check()
  assert.equal(checks, 1)
  resolveCheck()
  await Promise.all([checkPromise, duplicateCheck])
  assert.equal(quitCalls, 0)
})

test('instala somente quando o segundo diálogo é confirmado', async () => {
  const updater = fakeUpdater()
  const dialogs: MessageBoxOptions[] = []
  let quitCalls = 0
  let installErrors = 0
  updater.checkForUpdates = async () => {
    updater.emit('update-available', { version: '1.0.10' })
  }
  updater.downloadUpdate = async () => {
    updater.emit('update-downloaded', { version: '1.0.10' })
    return []
  }
  const controller = controllerFor(updater, [0, 0], dialogs, () => { quitCalls += 1 }, () => { installErrors += 1 })
  await controller.check()
  await nextTick()
  await nextTick()
  assert.equal(controller.getState(), 'installing')
  assert.equal(quitCalls, 1)
  updater.emit('error', new Error('fixture installer failure'))
  assert.equal(controller.getState(), 'downloaded')
  assert.equal(installErrors, 1)
})

test('recusa, modo desabilitado e falhas de consulta/download não bloqueiam o app', async () => {
  const disabledUpdater = fakeUpdater()
  let disabledChecks = 0
  disabledUpdater.checkForUpdates = async () => { disabledChecks += 1 }
  const disabled = createAutoUpdateController({
    enabled: false,
    updater: disabledUpdater as unknown as AppUpdater,
    showMessageBox: async () => ({ response: 1 }),
    quitAndInstall: () => {},
  })
  await disabled.check()
  assert.equal(disabledChecks, 0)

  const refusedUpdater = fakeUpdater()
  let refusedDownloads = 0
  refusedUpdater.checkForUpdates = async () => {
    refusedUpdater.emit('update-available', { version: '1.0.10' })
  }
  refusedUpdater.downloadUpdate = async () => {
    refusedDownloads += 1
    return []
  }
  const refused = controllerFor(refusedUpdater, [1], [], () => {})
  await refused.check()
  await nextTick()
  assert.equal(refused.getState(), 'idle')
  assert.equal(refusedDownloads, 0)

  const failedQueryUpdater = fakeUpdater()
  failedQueryUpdater.checkForUpdates = async () => { throw new Error('offline fixture') }
  const failedQuery = controllerFor(failedQueryUpdater, [], [], () => {})
  await failedQuery.check()
  assert.equal(failedQuery.getState(), 'idle')

  const failedDownloadUpdater = fakeUpdater()
  failedDownloadUpdater.checkForUpdates = async () => {
    failedDownloadUpdater.emit('update-available', { version: '1.0.10' })
  }
  failedDownloadUpdater.downloadUpdate = async () => { throw new Error('broken fixture') }
  const failedDownload = controllerFor(failedDownloadUpdater, [0], [], () => {})
  await failedDownload.check()
  await nextTick()
  await nextTick()
  assert.equal(failedDownload.getState(), 'idle')
})

