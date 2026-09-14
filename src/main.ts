import './style.css'

type View = 'choose' | 'grid'
type SlotCount = 2 | 3 | 4 | 8 | 16
type Layout3 = 'equal' | 'focus'

const app = document.querySelector<HTMLDivElement>('#app')!

let view: View = 'choose'
let slotCount: SlotCount = 4
let layout3: Layout3 = 'equal'
let urls: string[] = []

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function setSlotCount(count: SlotCount) {
  const next = Array.from({ length: count }, (_, i) => urls[i] ?? '')
  urls = next
  slotCount = count
}

function urlFormHtml(index: number, url: string): string {
  return `
    <form class="panel__bar" data-slot="${index}" novalidate>
      <label class="visually-hidden" for="url-${index}">URL do jogo ${index + 1}</label>
      <input
        id="url-${index}"
        type="url"
        name="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="Cole o link e pressione Enter"
        value="${escapeAttr(url)}"
      />
      <button type="submit" class="btn btn--load" aria-label="Abrir link">Abrir</button>
      <button type="button" class="btn btn--clear" data-clear aria-label="Limpar link">Limpar</button>
    </form>
  `
}

function panelInnerHtml(index: number, url: string): string {
  if (!url) {
    return `
      <div class="panel__empty">
        <p class="panel__slot">Jogo ${index + 1}</p>
        ${urlFormHtml(index, url)}
      </div>
    `
  }

  return `
    <div class="panel__overlay">
      ${urlFormHtml(index, url)}
    </div>
    <iframe
      src="${escapeAttr(url)}"
      title="Jogo ${index + 1}"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowfullscreen
      referrerpolicy="no-referrer"
    ></iframe>
  `
}

function applyPanelUrl(panel: HTMLElement, index: number, next: string) {
  urls[index] = next
  panel.classList.toggle('panel--empty', !next)
  panel.innerHTML = panelInnerHtml(index, next)
  bindPanelForm(panel)
}

function bindPanelForm(panel: HTMLElement) {
  const form = panel.querySelector<HTMLFormElement>('.panel__bar')
  if (!form) return

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const index = Number(form.dataset.slot)
    const input = form.elements.namedItem('url') as HTMLInputElement
    const next = normalizeUrl(input.value)
    applyPanelUrl(panel, index, next)
    panel.querySelector<HTMLInputElement>('input')?.blur()
  })

  form.querySelector('[data-clear]')?.addEventListener('click', () => {
    const index = Number(form.dataset.slot)
    applyPanelUrl(panel, index, '')
    panel.querySelector<HTMLInputElement>('input')?.focus()
  })
}

function openAllPanels() {
  const panels = [...app.querySelectorAll<HTMLElement>('.panel')]
  for (const panel of panels) {
    const form = panel.querySelector<HTMLFormElement>('.panel__bar')
    const input = form?.querySelector<HTMLInputElement>('input[name="url"]')
    if (!form || !input) continue
    const index = Number(form.dataset.slot)
    applyPanelUrl(panel, index, normalizeUrl(input.value))
  }
}

function clearAllPanels() {
  const panels = [...app.querySelectorAll<HTMLElement>('.panel')]
  for (const panel of panels) {
    const index = Number(panel.dataset.slot)
    applyPanelUrl(panel, index, '')
  }
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

let moreMenuAbort: AbortController | null = null

function bindMoreMenu() {
  moreMenuAbort?.abort()
  moreMenuAbort = new AbortController()
  const { signal } = moreMenuAbort

  const menu = app.querySelector<HTMLElement>('.toolbar__more')
  const trigger = app.querySelector<HTMLButtonElement>('#btn-more')
  const panel = app.querySelector<HTMLElement>('#toolbar-more-menu')
  const clearBtn = app.querySelector<HTMLButtonElement>('#btn-clear-all')
  if (!menu || !trigger || !panel || !clearBtn) return

  const setOpen = (open: boolean) => {
    menu.classList.toggle('is-open', open)
    trigger.setAttribute('aria-expanded', String(open))
    panel.hidden = !open
  }

  trigger.addEventListener(
    'click',
    (event) => {
      event.stopPropagation()
      setOpen(panel.hidden)
    },
    { signal },
  )

  clearBtn.addEventListener(
    'click',
    () => {
      clearAllPanels()
      setOpen(false)
    },
    { signal },
  )

  document.addEventListener(
    'click',
    (event) => {
      if (!menu.contains(event.target as Node)) setOpen(false)
    },
    { signal },
  )

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') setOpen(false)
    },
    { signal },
  )
}

function layoutPreview(count: SlotCount): string {
  const cells = Array.from({ length: count }, () => '<span></span>').join('')
  return `<div class="chooser__preview chooser__preview--${count}" aria-hidden="true">${cells}</div>`
}

function renderChoose() {
  document.body.classList.remove('is-grid')
  app.innerHTML = `
    <main class="chooser">
      <div class="chooser__atmosphere" aria-hidden="true"></div>
      <div class="chooser__content">
        <p class="brand">Quadra</p>
        <h1>Quantas telas?</h1>
        <p class="lede">Escolha quantos jogos quer ver ao mesmo tempo.</p>
        <div class="chooser__options" role="group" aria-label="Número de telas">
          ${([2, 3, 4, 8, 16] as const)
            .map(
              (count) => `
            <button type="button" class="chooser__card" data-count="${count}">
              ${layoutPreview(count)}
              <span class="chooser__count">${count}</span>
              <span class="chooser__label">telas</span>
            </button>
          `,
            )
            .join('')}
        </div>
      </div>
    </main>
  `

  app.querySelectorAll<HTMLButtonElement>('.chooser__card').forEach((button) => {
    button.addEventListener('click', () => {
      setSlotCount(Number(button.dataset.count) as SlotCount)
      view = 'grid'
      render()
    })
  })
}

function renderGrid() {
  document.body.classList.add('is-grid')
  const gridModifier =
    slotCount === 3 ? `grid--3 grid--3-${layout3}` : `grid--${slotCount}`

  app.innerHTML = `
    <div class="grid-shell">
      <div class="toolbar" role="toolbar" aria-label="Controles">
        <button type="button" class="btn btn--load" id="btn-open-all">Abrir todos</button>
        <button type="button" class="btn btn--ghost" id="btn-layout">Telas</button>
        ${
          slotCount === 3
            ? `<button type="button" class="btn btn--ghost" id="btn-layout3">${
                layout3 === 'equal' ? 'Topo maior' : 'Iguais'
              }</button>`
            : ''
        }
        <button type="button" class="btn btn--ghost" id="btn-fullscreen">Tela cheia</button>
        <div class="toolbar__more">
          <button
            type="button"
            class="btn btn--ghost btn--icon"
            id="btn-more"
            aria-label="Mais opções"
            aria-haspopup="menu"
            aria-expanded="false"
            aria-controls="toolbar-more-menu"
          >
            <span aria-hidden="true">⋯</span>
          </button>
          <div class="toolbar__menu" id="toolbar-more-menu" role="menu" hidden>
            <button type="button" class="toolbar__menu-item" id="btn-clear-all" role="menuitem">
              Limpar todos
            </button>
          </div>
        </div>
      </div>
      <div class="grid ${gridModifier}" id="watch-grid">
        ${urls
          .map(
            (url, i) => `
          <div class="panel${url ? '' : ' panel--empty'}" data-slot="${i}">
            ${panelInnerHtml(i, url)}
          </div>
        `,
          )
          .join('')}
      </div>
    </div>
  `

  app.querySelectorAll<HTMLElement>('.panel').forEach(bindPanelForm)

  app.querySelector('#btn-layout')!.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    }
    view = 'choose'
    render()
  })

  app.querySelector('#btn-layout3')?.addEventListener('click', () => {
    layout3 = layout3 === 'equal' ? 'focus' : 'equal'
    const grid = app.querySelector('#watch-grid')
    const button = app.querySelector<HTMLButtonElement>('#btn-layout3')
    grid?.classList.toggle('grid--3-equal', layout3 === 'equal')
    grid?.classList.toggle('grid--3-focus', layout3 === 'focus')
    if (button) {
      button.textContent = layout3 === 'equal' ? 'Topo maior' : 'Iguais'
    }
  })

  app.querySelector('#btn-open-all')!.addEventListener('click', () => {
    openAllPanels()
  })

  app.querySelector('#btn-fullscreen')!.addEventListener('click', () => {
    toggleFullscreen()
  })

  bindMoreMenu()
}

function render() {
  moreMenuAbort?.abort()
  moreMenuAbort = null
  if (view === 'choose') {
    renderChoose()
  } else {
    renderGrid()
  }
}

render()
