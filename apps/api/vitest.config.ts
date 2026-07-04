import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Seeds required env vars before any module (incl. @engageiq/shared env.ts) loads, so unit
    // tests run in the integration env (no root .env) without tripping env.ts's process.exit.
    setupFiles: ['./vitest.setup.ts'],
    reporters: ['verbose'],
  },
})
