import './style.css'

const SLOT_COUNT = 4
const STORAGE_KEY = 'quadra-urls'

type View = 'setup' | 'grid'

const app = document.querySelector<HTMLDivElement>('#app')!

let view: View = 'setup'
let urls: string[] = loadUrls()

function loadUrls(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return Array(SLOT_COUNT).fill('')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return Array(SLOT_COUNT).fill('')
    return Array.from({ length: SLOT_COUNT }, (_, i) =>
      typeof parsed[i] === 'string' ? parsed[i] : '',
    )
  } catch {
    return Array(SLOT_COUNT).fill('')
  }
}

function saveUrls(next: string[]) {
  urls = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(urls))
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function render() {
  if (view === 'setup') {
    renderSetup()
  } else {
    renderGrid()
  }
}

function renderSetup() {
  document.body.classList.remove('is-grid')
  app.innerHTML = `
    <main class="setup">
      <div class="setup__atmosphere" aria-hidden="true"></div>
      <div class="setup__content">
        <p class="brand">Quadra</p>
        <h1>Quatro jogos. Uma tela.</h1>
        <p class="lede">
          Cole até 4 links e assista em grade 2×2 na mesma aba — sem barras de
          título extras. Use F11 ou o botão de tela cheia na grade.
        </p>
        <p class="hint">
          Alguns sites bloqueiam abertura em iframe; nesses casos o painel fica
          em branco e é preciso de um app com webview.
        </p>
        <form class="url-form" id="url-form">
          ${urls
            .map(
              (url, i) => `
            <label class="url-field">
              <span>Jogo ${i + 1}</span>
              <input
                type="url"
                name="url-${i}"
                inputmode="url"
                autocomplete="off"
                spellcheck="false"
                placeholder="https://…"
                value="${escapeAttr(url)}"
              />
            </label>
          `,
            )
            .join('')}
          <button type="submit" class="btn btn--primary">Assistir</button>
        </form>
      </div>
    </main>
  `

  const form = app.querySelector<HTMLFormElement>('#url-form')!
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const next = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const input = form.elements.namedItem(`url-${i}`) as HTMLInputElement
      return normalizeUrl(input.value)
    })
    saveUrls(next)
    view = 'grid'
    render()
  })
}

function renderGrid() {
  document.body.classList.add('is-grid')
  app.innerHTML = `
    <div class="grid-shell">
      <div class="toolbar" role="toolbar" aria-label="Controles da grade">
        <button type="button" class="btn btn--ghost" id="btn-edit">Editar links</button>
        <button type="button" class="btn btn--ghost" id="btn-fullscreen">Tela cheia</button>
      </div>
      <div class="grid" id="watch-grid">
        ${urls
          .map((url, i) => {
            if (!url) {
              return `
                <div class="panel panel--empty" data-slot="${i}">
                  <p>Sem link</p>
                  <span>Jogo ${i + 1}</span>
                </div>
              `
            }
            return `
              <div class="panel" data-slot="${i}">
                <iframe
                  src="${escapeAttr(url)}"
                  title="Jogo ${i + 1}"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  allowfullscreen
                  referrerpolicy="no-referrer"
                ></iframe>
              </div>
            `
          })
          .join('')}
      </div>
    </div>
  `

  app.querySelector('#btn-edit')!.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    }
    view = 'setup'
    render()
  })

  app.querySelector('#btn-fullscreen')!.addEventListener('click', () => {
    toggleFullscreen()
  })
}

function toggleFullscreen() {
  const shell = app.querySelector<HTMLElement>('.grid-shell')
  if (!shell) return
  if (document.fullscreenElement) {
    void document.exitFullscreen()
  } else {
    void shell.requestFullscreen().catch(() => {
      // Fullscreen may be blocked; F11 still works at browser level.
    })
  }
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && view === 'grid' && !document.fullscreenElement) {
    view = 'setup'
    render()
  }
})

render()
