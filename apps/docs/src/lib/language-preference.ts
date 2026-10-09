export type Locale = 'zh' | 'en'

export const languageStorageKey = 'weapp-stylex:language'

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en'
}

const chineseTimeZones = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Harbin',
  'Asia/Urumqi',
  'PRC',
])

export function localeFromTimeZone(timeZone: string | undefined): Locale | undefined {
  // Time zone reflects device settings, not a verified physical location.
  if (!timeZone) {
    return undefined
  }
  try {
    // Validate and canonicalize IANA aliases; unknown offsets are not regions.
    const canonical = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone
    if (/^[+-]/.test(canonical)) {
      return undefined
    }
    return chineseTimeZones.has(canonical) ? 'zh' : 'en'
  }
  catch {
    return undefined
  }
}

export function deviceRegionLocale(): Locale | undefined {
  try {
    return localeFromTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone)
  }
  catch {
    return undefined
  }
}

export function preferredLocale(saved: unknown, regional: unknown, languages: readonly string[]): Locale {
  if (isLocale(saved)) {
    return saved
  }
  if (isLocale(regional)) {
    return regional
  }
  const first = languages.find(language => /^[a-z]{2,3}(?:-|$)/i.test(language))
  return /^zh(?:-|$)/i.test(first ?? '') ? 'zh' : 'en'
}

export function readLanguagePreference(): Locale | undefined {
  try {
    const saved = localStorage.getItem(languageStorageKey)
    return isLocale(saved) ? saved : undefined
  }
  catch {
    // Private browsing or site settings can disable storage.
    return undefined
  }
}

export function rememberLanguage(locale: Locale): void {
  try {
    localStorage.setItem(languageStorageKey, locale)
  }
  catch {
    // The language link still works when persistence is unavailable.
  }
}
