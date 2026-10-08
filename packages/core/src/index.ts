/**
 * A deliberately small facade around the official StyleX runtime.
 *
 * Keeping this package as a re-export means existing StyleX code can move to
 * a native mini-program without changing its style declarations. The
 * weapp-vite plugin recognizes both this package and @stylexjs/stylex.
 */
export * from '@stylexjs/stylex'
