export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

export const themeStorageKey = 'weapp-stylex:theme'

let sessionPreference: ThemePreference | undefined

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readThemePreference(): ThemePreference {
  // A manual choice must survive blocked storage for the current page session.
  if (sessionPreference) {
    return sessionPreference
  }
  try {
    const saved = localStorage.getItem(themeStorageKey)
    return isThemePreference(saved) ? saved : 'light'
  }
  catch {
    return 'light'
  }
}

export function rememberThemePreference(preference: ThemePreference): void {
  sessionPreference = preference
  try {
    localStorage.setItem(themeStorageKey, preference)
  }
  catch {
    // Session state remains usable when persistence is unavailable.
  }
}

export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}
