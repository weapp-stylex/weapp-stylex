import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'

async function freshThemeModule() {
  vi.resetModules()
  return import('../src/lib/theme-preference.ts')
}

function withStorage(storage, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...storage })
  try {
    run()
  }
  finally {
    if (previous) {
      Object.defineProperty(globalThis, 'localStorage', previous)
    }
    else {
      delete globalThis.localStorage
    }
  }
}

describe('documentation theme preference', () => {
  it('defaults to light independently of the device theme and ignores invalid preferences', async () => {
    const { isThemePreference, readThemePreference, resolveThemePreference } = await freshThemeModule()
    withStorage({ value: { getItem: () => null } }, () => {
      assert.equal(readThemePreference(), 'light')
      assert.equal(resolveThemePreference(readThemePreference(), true), 'light')
    })
    withStorage({ value: { getItem: () => 'invalid' } }, () => assert.equal(readThemePreference(), 'light'))
    assert.ok(['light', 'dark', 'system'].every(isThemePreference))
    assert.ok([undefined, null, '', 'auto', 'DARK'].every(value => !isThemePreference(value)))
  })

  it('restores explicit preferences and follows the system only when selected', async () => {
    const { readThemePreference, resolveThemePreference, themeStorageKey } = await freshThemeModule()
    for (const saved of ['light', 'dark', 'system']) {
      withStorage({ value: { getItem: (key) => {
        assert.equal(key, themeStorageKey)
        return saved
      } } }, () => assert.equal(readThemePreference(), saved))
    }
    assert.equal(resolveThemePreference('light', true), 'light')
    assert.equal(resolveThemePreference('dark', false), 'dark')
    assert.equal(resolveThemePreference('system', true), 'dark')
    assert.equal(resolveThemePreference('system', false), 'light')
  })

  it('persists a manual choice and retains it when later storage reads fail', async () => {
    const { readThemePreference, rememberThemePreference, themeStorageKey } = await freshThemeModule()
    let saved
    withStorage({ value: { getItem: () => saved, setItem: (key, value) => {
      assert.equal(key, themeStorageKey)
      saved = value
    } } }, () => {
      rememberThemePreference('dark')
      assert.equal(saved, 'dark')
      assert.equal(readThemePreference(), 'dark')
    })
    withStorage({ get: () => {
      throw new Error('Storage blocked')
    } }, () => assert.equal(readThemePreference(), 'dark'))
  })

  it('lets the current session switch themes when storage is entirely blocked', async () => {
    const { readThemePreference, rememberThemePreference } = await freshThemeModule()
    withStorage({ get: () => {
      throw new Error('Storage blocked')
    } }, () => {
      assert.equal(readThemePreference(), 'light')
      assert.doesNotThrow(() => rememberThemePreference('system'))
      assert.equal(readThemePreference(), 'system')
      rememberThemePreference('dark')
      assert.equal(readThemePreference(), 'dark')
      rememberThemePreference('light')
      assert.equal(readThemePreference(), 'light')
    })
  })
})
