interface SearchResult {
  url: string
  excerpt?: string
  meta: { title?: string }
}

interface Pagefind {
  init: () => Promise<void>
  destroy: () => Promise<void>
  search: (query: string) => Promise<{ results: { data: () => Promise<SearchResult> }[] }>
}

interface PagefindModule {
  createInstance: () => Pagefind
}

function excerptText(excerpt: string): string {
  // Pagefind includes <mark> tags. Parse into an inert template and render text.
  const template = document.createElement('template')
  template.innerHTML = excerpt
  template.content.querySelectorAll('script, style').forEach(element => element.remove())
  return template.content.textContent ?? ''
}

// Pagefind is emitted by the Nimbus production build, not bundled by Vite.
// Each instance selects the index from the document's html[lang].
export function mountSearch(root: HTMLElement): void {
  if (root.dataset.enhanced) {
    return
  }
  const dialog = root.querySelector<HTMLDialogElement>('dialog')
  const trigger = root.querySelector<HTMLButtonElement>('[data-search-open]')
  const form = root.querySelector<HTMLFormElement>('form')
  const input = root.querySelector<HTMLInputElement>('input')
  const status = root.querySelector<HTMLElement>('[role="status"]')
  const results = root.querySelector<HTMLUListElement>('ul')
  if (!dialog || !trigger || !form || !input || !status || !results || typeof dialog.showModal !== 'function') {
    return
  }
  root.dataset.enhanced = 'true'
  trigger.hidden = false
  const shortcut = root.querySelector<HTMLElement>('[data-search-shortcut]')
  if (shortcut) {
    shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
  }
  let api: Promise<Pagefind> | undefined
  let moduleApi: Promise<PagefindModule> | undefined
  let importFailures = 0
  let request = 0
  let debounce: number | undefined
  let previousFocus: HTMLElement | null = null

  const loadModule = (): Promise<PagefindModule> => {
    if (!moduleApi) {
      const base = (root.dataset.base ?? '/').replace(/\/$/, '')
      // Browsers cache rejected module imports by URL. Change the URL only
      // after an import failure; a loaded module remains shared across retries.
      const retry = importFailures ? `?retry=${Date.now()}-${importFailures}` : ''
      const pending = import(/* @vite-ignore */ `${base}/pagefind/pagefind.js${retry}`).catch((error: unknown) => {
        if (moduleApi === pending) {
          moduleApi = undefined
          ++importFailures
        }
        throw error
      })
      moduleApi = pending
    }
    return moduleApi
  }

  const open = () => {
    if (dialog.open) {
      input.focus()
      return
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger
    dialog.showModal()
    input.focus()
  }

  const search = async () => {
    const current = ++request
    results.replaceChildren()
    const query = input.value.trim()
    if (!query) {
      status.textContent = ''
      results.removeAttribute('aria-busy')
      return
    }
    status.textContent = root.dataset.loading ?? ''
    results.setAttribute('aria-busy', 'true')
    let activeApi: Promise<Pagefind> | undefined
    try {
      if (!api) {
        const pending = loadModule().then(async (module) => {
          const instance = module.createInstance()
          try {
            await instance.init()
            return instance
          }
          catch (error) {
            await instance.destroy()
            throw error
          }
        }).catch((error: unknown) => {
          if (api === pending) {
            api = undefined
          }
          throw error
        })
        api = pending
      }
      activeApi = api
      const response = await (await activeApi).search(query)
      const pages = await Promise.all(response.results.slice(0, 10).map(result => result.data()))
      if (current !== request) {
        return
      }
      for (const page of pages) {
        let url: URL
        try {
          url = new URL(page.url, window.location.origin)
        }
        catch {
          continue
        }
        if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) {
          continue
        }
        const item = document.createElement('li')
        const link = document.createElement('a')
        const title = document.createElement('strong')
        link.href = url.href
        title.textContent = page.meta.title ?? page.url
        link.append(title)
        if (page.excerpt) {
          const excerpt = document.createElement('p')
          excerpt.textContent = excerptText(page.excerpt)
          link.append(excerpt)
        }
        item.append(link)
        results.append(item)
      }
      status.textContent = results.childElementCount ? '' : root.dataset.empty ?? ''
    }
    catch {
      if (current === request) {
        // Release only this request's instance; an old failure cannot reset a retry.
        if (api === activeApi) {
          api = undefined
        }
        void activeApi?.then(instance => instance.destroy()).catch(() => {})
        status.textContent = root.dataset.unavailable ?? ''
      }
    }
    finally {
      if (current === request) {
        results.removeAttribute('aria-busy')
      }
    }
  }

  trigger.addEventListener('click', open)
  root.querySelector('[data-search-close]')?.addEventListener('click', () => dialog.close())
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing) {
      // Search inputs consume Escape to clear their value before dialog cancel.
      event.preventDefault()
      dialog.close()
    }
  }, { capture: true })
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) {
      return
    }
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close()
    }
  })
  dialog.addEventListener('close', () => {
    ++request
    window.clearTimeout(debounce)
    results.removeAttribute('aria-busy')
    if (status.textContent === root.dataset.loading) {
      status.textContent = ''
    }
    if (previousFocus?.isConnected) {
      previousFocus.focus()
    }
  })
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.isComposing) {
      event.preventDefault()
      open()
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    window.clearTimeout(debounce)
    void search()
  })
  input.addEventListener('input', () => {
    ++request
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => void search(), 180)
  })
}
