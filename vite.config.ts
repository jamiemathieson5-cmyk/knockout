import { defineConfig } from 'vite'

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // credentialless keeps SharedArrayBuffer available without blocking
  // cross-origin fonts / CDN model assets that omit CORP headers.
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig(({ command }) => ({
  // GitHub Pages project site: https://<user>.github.io/knockout/
  base: command === 'build' ? '/knockout/' : '/',
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  optimizeDeps: {
    exclude: ['@imgly/background-removal'],
  },
}))
