# Phase 1 — Milestone 1.2: Database Schema (PostgreSQL)

**Date:** 2026-04-27
**Status:** Complete

## What Was Built

### Full Prisma Schema (`packages/db/prisma/schema.prisma`)

All 11 tables + 10 enums created:

| Model | Key Fields |
|---|---|
| `Merchant` | plan, timezone, currency, agency parent/child self-relation |
| `User` | role enum (6 roles), merchantId scoped, password_hash |
| `Customer` | full profile: identity + Shopify aggregates + behavioral + RFM + AI scores + COD profile + channel opt-ins + multi-store + identity resolution fields |
| `Segment` | conditions (Json), isDynamic, memberCount |
| `SegmentMembership` | entered_at / exited_at (null = active member) |
| `Campaign` | channel, status, full analytics counters, UTM fields |
| `Journey` | triggerType, triggerConfig (Json), reEntryRule enum |
| `JourneyStep` | stepType, config (Json), canvas position, self-referential parent/child |
| `JourneyEnrollment` | currentStepId, status, timestamps |
| `CodOrder` | full lifecycle: status + verificationStatus, fakeScore, verification timestamps |
| `ApiKey` | keyHash (SHA-256), keyPrefix for display, expiry |

### Enums (10)
`Plan`, `Role`, `Channel`, `CampaignStatus`, `JourneyStatus`, `JourneyStepType`, `EnrollmentStatus`, `CodOrderStatus`, `CodVerificationStatus`, `RfmSegment`, `ChurnRiskLabel`, `ReEntryRule`

### Seed Script (`packages/db/prisma/seed.ts`)
- 1 test merchant: `test-store.myshopify.com` (Growth plan, PKR, Asia/Karachi)
- 2 users: owner + analyst
- 1 API key (printed to console on first seed)
- 5 customers representing different lifecycle states: Champion, Promising, New, At-Risk, no-orders
- 1 segment: "Champions" (condition tree JSON)
- 1 campaign: WhatsApp draft targeting Champions

### Indexes Added
- `customers`: `(merchantId)`, `(merchantId, rfmSegment)`, `(merchantId, churnRiskLabel)`, `(groupCustomerId)`
- `campaigns`: `(merchantId)`, `(merchantId, status)`
- `journeys`: `(merchantId)`, `(merchantId, status)`
- `codOrders`: `(merchantId)`, `(merchantId, status)`, `(customerId)`
- `segmentMemberships`: `(customerId)`
- `journeyEnrollments`: `(customerId)`, `(journeyId, status)`

## Decisions Made

- **Decimal(12,2)** for all monetary fields — handles PKR amounts up to 9,999,999,999.99
- **Float** for scores (churnScore 0–1, fakeScore 0–100) vs Decimal — scores are approximate, no need for fixed precision
- **Json** for `conditions`, `triggerConfig`, `content`, `config` — these are flexible/evolving structures owned by Phase 5 (segment builder) and Phase 6 (journey builder); don't constrain schema prematurely
- **Soft-delete pattern for segment membership** via `exitedAt` nullable — preserves entry/exit history for analytics
- **Agency self-relation** on `Merchant` (agencyId → Merchant.id) — single table handles both parent and child accounts
- **`@@unique([journeyId, customerId])`** on `JourneyEnrollment` with a comment: the uniqueness constraint is enforced at DB level but the application layer must handle re-entry rules (allow re-enrollment after exit by deleting old record or creating new with suffix)
- **SHA-256 hash** in seed only — production bcrypt hashing is Milestone 1.4 (auth)
- Customer `email` unique per merchant, not globally — same email can appear in two merchants' stores without collision

## Known Issues / Deviations
- Prisma migration not actually run yet (no live DB connection) — run `pnpm db:migrate` after `docker compose up -d`
- `@@unique([journeyId, customerId])` on JourneyEnrollment will block re-enrollment for ALLOW/RE_ENROLL_AFTER_EXIT journeys — Phase 6 execution engine must delete the old enrollment record before creating a new one
- Password hashing in seed uses SHA-256 (placeholder) — must be replaced with bcrypt in Milestone 1.4 before any real auth is wired up

## Next Milestone
**1.3 — ClickHouse Event Store Setup:** Create events table DDL, verify round-trip write + query, expand abstraction layer.
