# Update: AI Copywriter (roadmap 7.4 / feature-guide §8.3)

**Date:** 2026-07-03
**Phase:** 7 | **Milestone:** 7.4 — AI Copywriter | **Lane:** copywriter (Wave 2)
**Author:** Claude Code (Session — "LANE 4 — AI Copywriter")

## What Was Built
A "Generate with AI" service that calls the Anthropic Claude API to produce copy variants for
email subject lines, WhatsApp text, and SMS, plus a transparent subject-line open-rate predictor
and a reusable design-system UI panel.

**Backend (synchronous HTTP — no queue):**
- `POST /api/v1/ai/generate` — given `{ purpose, channel?, context{ goal, segment?, offer?, tone,
  language }, count? }`, generates N (1–5, default 3) distinct copy variants. Uses the Anthropic
  SDK with **structured outputs** (`output_config.format` json_schema) at `effort: low` so the model
  returns a validated `{ variants: [{ text, rationale }] }`. Supports **English + Urdu** (Urdu prompt
  instructs natural conversational Urdu, RTL, native-review note). Purpose-specific channel
  constraints are baked into the prompt (subject ≤ ~55 chars, SMS ≤ 160 chars, WhatsApp conversational).
- **No key → hard `AI_NOT_CONFIGURED` (503), never fake copy.** `ANTHROPIC_API_KEY` is optional;
  when absent the endpoint returns a clear error and the app still boots.
- Every generation is persisted to `AiGeneration` (contextJson, variants, model, promptTokens,
  completionTokens, costUsd) for the audit/cost trail. Cost is computed from a small per-model USD
  rate table (`pricing.ts`).
- `POST /api/v1/ai/predict-subject` — heuristic open-rate predictor. Blends the merchant's **own**
  historical email open rate (from `Campaign` `openedCount`/`recipientCount`, tenant-scoped) with
  subject-line features (length, personalization token, urgency, question, emoji, ALL-CAPS/spam,
  Urdu RTL). Returns `predictedOpenRate`, `confidence`, `merchantBaselineOpenRate`, `sampleSize`,
  and an explainable `factors[]`. Deliberately not ML (no training pipeline, fully explainable) —
  can be swapped behind the same DTO when the ML lane ships a real predictor.

**Frontend (reusable, monochrome design system):**
- `<GenerateWithAiPanel>` — embeddable in campaign/flow-step editors. Config form (goal / segment /
  offer / tone / language / count) → variant cards with **Use this** (`onSelect` prop wires into the
  host editor), **Copy**, and (for email subjects) inline **Predict open rate** per variant.
- `<SubjectOpenRatePredictor>` + `<PredictionReadout>` — standalone subject predictor for the email
  editor. Both call the API via two action-only resource routes.

## Files Created / Modified
**OWN (created):**
- `apps/api/src/services/ai/anthropic-client.ts` — lazy Anthropic client singleton + `isAiConfigured()` + test seam
- `apps/api/src/services/ai/pricing.ts` — per-model USD token pricing → `costUsd`
- `apps/api/src/services/ai/copywriter.service.ts` — `generateCopy()` (prompt build, structured-output call, parse, persist, error mapping)
- `apps/api/src/services/ai/subject-predictor.service.ts` — `predictSubjectOpenRate()` heuristic
- `apps/api/src/services/ai/copywriter.service.test.ts` — 5 tests (SDK + DB mocked)
- `apps/api/src/services/ai/subject-predictor.service.test.ts` — 4 tests (DB mocked)
- `apps/api/src/routes/ai/{index,controller,schema}.ts` — auth-gated route group (`fastify.authenticate`)
- `apps/web/app/components/ai/{GenerateWithAiPanel,SubjectOpenRatePredictor}.tsx` + `index.ts`
- `apps/web/app/routes/api.ai.generate.tsx`, `apps/web/app/routes/api.ai.predict-subject.tsx` — server-side proxy resource routes (API_URL + DEV_TOKEN)

**APPEND-ONLY (`// lane:copywriter`):**
- `packages/shared/src/types.ts` + `index.ts` — copy DTOs (CopyPurpose/Tone/Language, AiCopyContext, AiGenerateRequestDto, AiCopyVariant, AiGenerateResultDto, SubjectPredict* DTOs)
- `packages/shared/src/env.ts` — `ANTHROPIC_MODEL` (default `claude-opus-4-8`), `ANTHROPIC_COPYWRITER_MAX_TOKENS`, `ANTHROPIC_COPYWRITER_EFFORT`
- `.env` / `.env.example` — the three vars above (ANTHROPIC_API_KEY already existed)
- `apps/api/src/index.ts` — register `aiRoutes` at `/api/v1/ai`
- `apps/api/package.json` — add `@anthropic-ai/sdk@^0.110.0` (+ `pnpm-lock.yaml`)
- `apps/web/app/components/ui/icons.tsx` — add `Sparkles` icon (design-system extension)

## Decisions Made This Session
- **Synchronous HTTP, not a BullMQ job.** Copy generation is user-initiated and interactive; no
  queue/worker added → zero contention on `queues.ts`/`worker.ts`.
- **Anthropic SDK upgraded to `^0.110.0`** (was not previously a dependency) so `output_config`
  (structured outputs) and `effort` are typed. Model pinned via env, default `claude-opus-4-8`,
  `effort: low` (short copy → fast + cheap). No `thinking`/`temperature`/`budget_tokens` sent.
- **Subject predictor is a documented heuristic, not ML.** Honest, explainable, self-contained;
  reads existing `Campaign` counters. Swappable behind the DTO later.
- **Panel needs a data endpoint.** Added two Remix resource-route proxies under `app/routes/`
  (`api.ai.*.tsx`) — new, non-contended files, flagged for the integrator (slightly outside the
  strict `components/ai/*` OWN glob but required for the panel to function; no registry edit,
  Remix auto-discovers routes).
- **No nav entry.** Per feature-guide §8.3 the copywriter is an embeddable panel, not a top-level
  section — `nav.ts` untouched.

## Deviations from Roadmap
- None. Built exactly the 7.4 / §8.3 scope. `AiGeneration` table used as-frozen (schema v2, no schema edits).

## Known Issues Left Open
- **Panel not yet wired into the campaign/email or flow-step editors.** The lane exposes the reusable
  panel and does not rewrite those editors (per lane boundaries); host integration is a follow-up.
- **`AiGeneration.chosenIndex` not written yet** — needs a "record which variant was kept" call from
  the host editor when a merchant picks one (learning-loop signal for the predictor).
- **Predictor is heuristic** — a real ML predictor (ML lane) can replace it behind `predictSubjectOpenRate`.
- **Live Anthropic call not exercised in CI** — `ANTHROPIC_API_KEY` is empty locally, so the generate
  path returns `AI_NOT_CONFIGURED`; unit tests mock the SDK. A real key is needed for a live smoke test.

## Preflight / Verification
- `scripts/preflight.sh` **green**: full build + typecheck + **192 api tests pass** (9 new) + migration
  status "up to date" (against `engageiq_copywriter`, migrations applied via `db:migrate:deploy`, no
  schema change).
- Boot smoke-test: API boots, `/health`=200, `POST /api/v1/ai/generate` returns 401 unauthenticated
  (route mounted + auth-gated).
- End-to-end (seed user `owner@test-store.com`): `predict-subject` returns a real explainable
  prediction; `generate` returns `AI_NOT_CONFIGURED` (503) with the key absent.

## What to Do Next
Lane is preflight-green and ready. **Integrator:** merge the `copywriter` lane, then update
`memory/context.md` (single-writer rule). Post-merge follow-ups: (1) drop `<GenerateWithAiPanel>` into
the campaign editor and flow-step ACTION editor with an `onSelect` that fills the copy field;
(2) wire a "keep this variant" call that sets `AiGeneration.chosenIndex`; (3) provide a real
`ANTHROPIC_API_KEY` for a live generation smoke test.
