import { vitePlugin as remix } from '@remix-run/dev'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
  ],
  resolve: {
    // Match the `~/* -> ./app/*` alias declared in tsconfig.json so Vite/rollup
    // resolve `~/` imports at build time (TS resolves them for typecheck, but Vite
    // does not without this). Fixes the pre-existing `~/tailwind.css?url` build break.
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  server: {
    port: 3000,
  },
})
