// Test-environment bootstrap. Runs (via vitest `setupFiles`) before any test module is
// imported, so it executes before @engageiq/shared's env.ts validates process.env.
//
// The integration/CI environment intentionally does not load a root .env (that is why the
// `prisma migrate status` preflight step is expected to fail there). Unit tests never touch a
// real database or external service — they mock prisma/HTTP — so they only need the *required*
// env vars present as placeholders to satisfy env.ts's Zod schema (which otherwise calls
// process.exit(1) on a missing value). We seed the three vars that have no default and are not
// optional: DATABASE_URL, JWT_SECRET (>=32), JWT_REFRESH_SECRET (>=32). Everything else in the
// schema has a default or is optional. `||=` never overrides a real value a developer exported.
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/engageiq_test'
process.env.JWT_SECRET ||= 'test-'.padEnd(32, '0')
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-'.padEnd(32, '0')
