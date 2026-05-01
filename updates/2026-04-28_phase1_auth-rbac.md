# Milestone 1.4 — Auth, RBAC & Multi-Tenancy

**Date:** 2026-04-28  
**Phase:** 1 — Foundation & Infrastructure  
**Status:** Complete

---

## What Was Built

### Shared Package

- `packages/shared/src/roles.ts` — Permission matrix and helpers:
  - `Permission` type: 12 granular permission strings (`campaigns:read/write`, `segments:read/write`, `analytics:read`, `journeys:read/write`, `customers:read`, `api_keys:manage`, `billing:manage`, `users:manage`, `agency:manage`)
  - `ROLE_PERMISSIONS: Record<Role, Set<Permission>>` — maps each role to its allowed permissions
  - `hasPermission(role, permission)` — O(1) Set lookup
  - `isAgencyRole(role)` — convenience predicate for `AGENCY_ADMIN` / `AGENCY_MEMBER`
- `packages/shared/src/types.ts` — Updated `Role` type to uppercase strings matching Prisma enum (`OWNER | ADMIN | MARKETER | ANALYST | AGENCY_ADMIN | AGENCY_MEMBER`)
- `packages/shared/src/env.ts` — Added `JWT_REFRESH_SECRET` (min 32 chars), `JWT_REFRESH_EXPIRES_IN` (default `7d`), `JWT_ACCESS_EXPIRES_IN` (default `1h`)
- `packages/shared/src/index.ts` — Re-exports all from `./roles.js`

### API Plugins

- `apps/api/src/plugins/jwt.ts` — Registers `@fastify/jwt` with access token config; exports `signAccessToken`, `signRefreshToken`, `verifyRefreshToken`. Refresh tokens use a separate secret via `@fastify/jwt`'s `key` override on sign/verify.
- `apps/api/src/plugins/authenticate.ts` — `authenticate` decorator: verifies JWT, renames `sub → userId`, checks user is still active in DB, enforces tenant match. `requireRole` decorator wraps `authenticate` then checks role membership.
- `apps/api/src/plugins/api-key.ts` — `authenticateApiKey` decorator: reads `Authorization: Bearer` header, looks up `keyPrefix` (first 12 chars) in DB, bcrypt-compares full key, attaches `request.apiKeyMerchantId`.

### Auth Service

- `apps/api/src/services/auth.service.ts` — Pure service functions:
  - `loginUser` — email/password login with optional `merchantDomain` disambiguation; bcrypt verify; issues access + refresh tokens; updates `lastLoginAt`
  - `refreshUserTokens` — verifies refresh token, re-checks user active status, issues new token pair
  - `hashPassword` / `verifyPassword` — bcrypt wrappers (rounds=12)
  - `generateApiKey` — generates `eiq_<64-hex-chars>` key, bcrypt-hashes it, stores with 12-char prefix

### Routes

- `apps/api/src/routes/auth.ts` — `/auth` prefix plugin:
  - `POST /auth/login` — rate-limited (10 req/15 min per IP), returns `{ accessToken, refreshToken, user }`
  - `POST /auth/refresh` — issues new token pair from valid refresh token
  - `POST /auth/logout` — stateless no-op (returns `{ ok: true }`)
  - `GET /auth/me` — requires authentication, returns current user profile

### Updated Files

- `apps/api/src/index.ts` — Registers `@fastify/rate-limit` (global: 100 req/min), JWT plugin, authenticate plugin, API key plugin, auth routes at `/auth`
- `packages/db/prisma/seed.ts` — Replaced SHA-256 placeholder with `bcrypt.hash(password, 12)`; API key generation also uses bcrypt

---

## Key Decisions

| Decision | Rationale |
|---|---|
| bcrypt rounds = 12 | Balances security and seeding/login performance; overkill at 14+ for a web API |
| Access token: 1h, Refresh token: 7d | Short-lived access limits blast radius on token theft; refresh allows seamless re-auth |
| Refresh token via `@fastify/jwt` `key` override | Avoids adding `jose` dependency; `@fastify/jwt` supports per-call `key` on `sign` and `verify`, keeping the implementation minimal |
| API key format: `eiq_<randomBytes(32).hex>` (68 chars total) | Prefix `eiq_` is visually identifiable; 64-char hex payload = 256 bits entropy |
| 12-char `keyPrefix` for DB lookup | Allows indexed DB lookup before expensive bcrypt compare; first 12 chars of `eiq_<hex>` are always unique enough for a single-row lookup |
| Uppercase `Role` values in shared types | Aligns shared type with Prisma-generated enum values; avoids case conversion on every DB read |
| `formatUser` not used in JWT plugin | `request.jwtVerify()` returns the raw payload; `authenticate` decorator manually maps `sub → userId` for ergonomic access in handlers |
| Stateless logout | No token revocation store yet; refresh token rotation at Phase 1 level is sufficient. Token blacklisting can be added in Phase 2 with Redis |

---

## Known Issues

None introduced in this milestone.

---

## Next Milestone

**Phase 2 — Core API & Business Logic**
- Merchant management endpoints
- Customer CRUD with tenant scoping
- Segment builder API
- Campaign management
