const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

function findPackagedExecutable() {
  if (process.env.QUADRA_PACKAGED_EXE) return process.env.QUADRA_PACKAGED_EXE
  return path.join(projectRoot, 'release', 'win-unpacked', 'Quadra.exe')
}

const executablePath = findPackagedExecutable()

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} while requesting ${url}`)
  return response.json()
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('Timeout ao avaliar a UI empacotada.'))
    }, 10000)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString())
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      const exception = message.result?.exceptionDetails
      if (exception) return reject(new Error(exception.text ?? 'Erro na UI empacotada.'))
      resolve(message.result?.result?.value)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket da UI empacotada encerrou inesperadamente.'))
    })
  })
}

async function waitForRendererTarget(port) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      for (const target of targets) {
        if (target.type !== 'page' || !target.webSocketDebuggerUrl) continue
        try {
          if (await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`)) return target
        } catch {
          // A target pode existir antes de terminar o carregamento.
        }
      }
    } catch {
      // O executável ainda pode estar iniciando.
    }
    await wait(250)
  }
  throw new Error('A UI do executável empacotado não apareceu no DevTools Protocol.')
}

async function run() {
  assert.ok(fs.existsSync(executablePath), `Executável empacotado não encontrado: ${executablePath}`)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'quadra-packaged-smoke-'))
  const port = 47000 + Math.floor(Math.random() * 1000)
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    windowsHide: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...childEnv, QUADRA_TEST_USER_DATA: userData },
  })

  try {
    const target = await waitForRendererTarget(port)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.app-version')?.textContent`), 'v1.02')
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`), true)
    const grid = await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('[data-count="16"]').click()
      return {
        className: document.querySelector('.grid')?.className ?? '',
        panelCount: document.querySelectorAll('.panel').length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth ||
          document.documentElement.scrollHeight > document.documentElement.clientHeight,
      }
    })()`)
    assert.match(grid.className, /grid--16/)
    assert.equal(grid.panelCount, 16)
    assert.equal(grid.overflow, false)

    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('#btn-layout').click()`)
    await evaluate(target.webSocketDebuggerUrl, `document.querySelector('.confirm [data-ok]').click()`)
    assert.equal(await evaluate(target.webSocketDebuggerUrl, `Boolean(document.querySelector('.chooser'))`), true)

    await evaluate(target.webSocketDebuggerUrl, `(() => {
      document.querySelector('[data-count="2"]').click()
      const form = document.querySelector('.panel[data-slot="0"] .panel__bar')
      form.querySelector('input[name="url"]').value = 'https://example.com/packaged'
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })()`)
    const targetDeadline = Date.now() + 10000
    let commonPage = false
    while (Date.now() < targetDeadline) {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json`)
      commonPage = targets.some((candidate) => candidate.type === 'page' && candidate.url.includes('example.com/packaged'))
      if (commonPage) break
      await wait(250)
    }
    assert.equal(commonPage, true, 'O executável empacotado não criou o WebContentsView comum.')
    process.stdout.write(JSON.stringify({ executable: executablePath, version: 'v1.02', grid16: true, chooserReturn: true, electronView: true }) + '\n')
  } finally {
    if (child.exitCode === null) {
      child.kill()
      if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    }
    await wait(1200)
    for (let attempt = 0; attempt < 20 && fs.existsSync(userData); attempt += 1) {
      try {
        fs.rmSync(userData, { recursive: true, force: true })
      } catch {
        await wait(250)
      }
    }
    if (fs.existsSync(userData)) throw new Error('userData temporário do smoke empacotado não foi liberado.')
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
