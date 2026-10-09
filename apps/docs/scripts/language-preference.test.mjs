import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { languageStorageKey, localeFromTimeZone, preferredLocale, readLanguagePreference, rememberLanguage } from '../src/lib/language-preference.ts'

describe('documentation language selection', () => {
  it('uses the device time zone independently of the browser language', () => {
    assert.equal(preferredLocale(undefined, localeFromTimeZone('Asia/Shanghai'), ['en-US']), 'zh')
    assert.equal(preferredLocale(undefined, localeFromTimeZone('America/New_York'), ['zh-CN']), 'en')
    for (const zone of ['Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'PRC']) {
      assert.equal(localeFromTimeZone(zone), 'zh')
    }
    for (const zone of ['Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'UTC']) {
      assert.equal(localeFromTimeZone(zone), 'en')
    }
    for (const zone of [undefined, '', 'invalid', '+08:00']) {
      assert.equal(localeFromTimeZone(zone), undefined)
    }
  })

  it('respects explicit choices before the time zone and ignores invalid stored values', () => {
    assert.equal(preferredLocale('en', 'zh', ['zh-CN']), 'en')
    assert.equal(preferredLocale('zh', 'en', ['en-US']), 'zh')
    assert.equal(preferredLocale('invalid', 'zh', ['en-US']), 'zh')
  })

  it('falls back to the first browser language only when the time zone is unavailable', () => {
    assert.equal(preferredLocale(undefined, undefined, ['zh-CN', 'en']), 'zh')
    assert.equal(preferredLocale(undefined, undefined, ['en-US', 'zh-CN']), 'en')
    assert.equal(preferredLocale(undefined, undefined, ['ZH-Hant']), 'zh')
    assert.equal(preferredLocale(undefined, undefined, []), 'en')
    assert.equal(preferredLocale(undefined, undefined, ['fr-FR']), 'en')
  })

  it('persists only manual choices and tolerates unavailable storage', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    try {
      let saved
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
          getItem(key) {
            assert.equal(key, languageStorageKey)
            return saved
          },
          setItem(key, value) {
            assert.equal(key, languageStorageKey)
            saved = value
          },
        },
      })
      assert.equal(readLanguagePreference(), undefined)
      rememberLanguage('en')
      assert.equal(readLanguagePreference(), 'en')
      saved = 'invalid'
      assert.equal(readLanguagePreference(), undefined)
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('Storage blocked')
        },
      })
      assert.equal(readLanguagePreference(), undefined)
      assert.doesNotThrow(() => rememberLanguage('zh'))
    }
    finally {
      if (previous) {
        Object.defineProperty(globalThis, 'localStorage', previous)
      }
      else {
        delete globalThis.localStorage
      }
    }
  })
})
