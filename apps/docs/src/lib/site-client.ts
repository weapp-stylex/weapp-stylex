import { isLocale, rememberLanguage } from './language-preference'
import { isThemePreference, readThemePreference, rememberThemePreference, resolveThemePreference } from './theme-preference'

function mountTheme(): void {
  const controls = document.querySelectorAll<HTMLElement>('[data-theme-control]')
  if (!controls.length || document.documentElement.dataset.themeEnhanced) {
    return
  }
  document.documentElement.dataset.themeEnhanced = 'true'
  const system = window.matchMedia('(prefers-color-scheme: dark)')
  const update = () => {
    const preference = readThemePreference()
    document.documentElement.dataset.theme = resolveThemePreference(preference, system.matches)
    controls.forEach((control) => {
      const select = control.querySelector<HTMLSelectElement>('[data-theme-select]')
      if (select) {
        select.value = preference
      }
    })
  }
  controls.forEach((control) => {
    const select = control.querySelector<HTMLSelectElement>('[data-theme-select]')
    if (!select) {
      return
    }
    control.hidden = false
    select.addEventListener('change', () => {
      if (isThemePreference(select.value)) {
        rememberThemePreference(select.value)
        update()
      }
    })
  })
  system.addEventListener('change', () => {
    if (readThemePreference() === 'system') {
      update()
    }
  })
  update()
}

function mountTabs(root: HTMLElement, index: number): void {
  if (root.dataset.enhanced) {
    return
  }
  const list = root.querySelector<HTMLElement>('[data-tab-list]')
  const panels = [...root.querySelectorAll<HTMLElement>('[data-tab-panel]')].filter(panel => panel.closest('[data-tabs]') === root)
  if (!list || !panels.length) {
    return
  }
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-label', root.dataset.tabsLabel ?? 'Examples')
  const buttons = panels.map((panel, panelIndex) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = `content-tab-${index}-${panelIndex}`
    panel.id ||= `content-tab-panel-${index}-${panelIndex}`
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', panel.id)
    button.textContent = panel.dataset.tabLabel ?? String(panelIndex + 1)
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', button.id)
    panel.tabIndex = 0
    list.append(button)
    return button
  })
  const activate = (selected: number, focus: boolean) => {
    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === selected
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
      panels[buttonIndex]!.hidden = !active
    })
    if (focus) {
      buttons[selected]?.focus()
    }
  }
  buttons.forEach((button, buttonIndex) => {
    button.addEventListener('click', () => activate(buttonIndex, false))
    button.addEventListener('keydown', (event) => {
      let selected: number
      switch (event.key) {
        case 'ArrowRight':
          selected = (buttonIndex + 1) % buttons.length
          break
        case 'ArrowLeft':
          selected = (buttonIndex + buttons.length - 1) % buttons.length
          break
        case 'Home':
          selected = 0
          break
        case 'End':
          selected = buttons.length - 1
          break
        default: return
      }
      event.preventDefault()
      activate(selected, true)
    })
  })
  root.dataset.enhanced = 'true'
  list.hidden = false
  activate(0, false)
}

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard is unavailable')
  }
  await navigator.clipboard.writeText(text)
}

function mountCodeCopy(pre: HTMLPreElement): void {
  const code = pre.querySelector('code')
  if (!code || pre.dataset.copyEnhanced) {
    return
  }
  pre.dataset.copyEnhanced = 'true'
  const chinese = document.documentElement.lang.startsWith('zh')
  const wrapper = document.createElement('div')
  wrapper.className = 'code-block'
  pre.before(wrapper)
  wrapper.append(pre)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'code-copy'
  const icon = document.querySelector<HTMLTemplateElement>('template[data-copy-icon]')
  if (icon) {
    button.append(icon.content.cloneNode(true))
  }
  const label = document.createElement('span')
  const normalLabel = chinese ? '复制' : 'Copy'
  label.textContent = normalLabel
  button.append(label)
  const status = document.createElement('span')
  status.className = 'code-copy-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  wrapper.append(button, status)
  let reset: number | undefined
  button.addEventListener('click', async () => {
    button.disabled = true
    window.clearTimeout(reset)
    try {
      await writeClipboard(code.textContent ?? '')
      label.textContent = chinese ? '已复制' : 'Copied'
      status.textContent = chinese ? '代码已复制。' : 'Code copied.'
    }
    catch {
      label.textContent = chinese ? '重试' : 'Retry'
      status.textContent = chinese ? '复制失败，请选择代码后手动复制。' : 'Could not copy. Select the code and copy manually.'
    }
    finally {
      button.disabled = false
      reset = window.setTimeout(() => {
        label.textContent = normalLabel
      }, 1800)
    }
  })
}

function mountMobileNavigation(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#mobile-navigation')
  const triggers = document.querySelectorAll<HTMLButtonElement>('[data-menu-open]')
  if (!dialog || !triggers.length || dialog.dataset.enhanced || typeof dialog.showModal !== 'function') {
    return
  }
  dialog.dataset.enhanced = 'true'
  document.querySelector<HTMLElement>('.site-rail')?.setAttribute('data-enhanced', 'true')
  let previousFocus: HTMLElement | null = null
  triggers.forEach((trigger) => {
    trigger.hidden = false
    trigger.addEventListener('click', () => {
      if (dialog.open) {
        return
      }
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger
      dialog.showModal()
      trigger.setAttribute('aria-expanded', 'true')
    })
  })
  dialog.querySelectorAll('[data-menu-close]').forEach(button => button.addEventListener('click', () => dialog.close()))
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        dialog.close()
      }
    }
  })
  dialog.addEventListener('close', () => {
    triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'))
    if (previousFocus?.isConnected) {
      previousFocus.focus()
    }
  })
  window.matchMedia('(min-width: 48.001rem)').addEventListener('change', (event) => {
    if (event.matches && dialog.open) {
      dialog.close()
    }
  })
}

export function mountSite(): void {
  mountTheme()
  document.querySelectorAll<HTMLElement>('[data-tabs]').forEach(mountTabs)
  document.querySelectorAll<HTMLPreElement>('pre').forEach(mountCodeCopy)
  mountMobileNavigation()
  document.querySelectorAll<HTMLAnchorElement>('[data-language]').forEach((link) => {
    if (link.dataset.languageEnhanced) {
      return
    }
    link.dataset.languageEnhanced = 'true'
    link.addEventListener('click', () => {
      const locale = link.dataset.language
      if (isLocale(locale)) {
        rememberLanguage(locale)
      }
    })
  })
}
