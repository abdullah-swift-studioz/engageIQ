// apps/api/src/services/couriers/registry.ts
//
// Single lookup from a Courier enum value to its CourierAdapter. OTHER has no adapter
// (couriers outside the core four are tracked manually / via webhook only) → the sync
// layer records a clean "unsupported" skip. Adding a real adapter for a new courier is
// a one-line entry here.
import { Courier } from '@prisma/client'
import type { CourierAdapter } from './types.js'
import { postexAdapter } from './postex.adapter.js'
import { leopardsAdapter } from './leopards.adapter.js'
import { tcsAdapter } from './tcs.adapter.js'
import { mpAdapter } from './mp.adapter.js'

const adapters: Partial<Record<Courier, CourierAdapter>> = {
  [Courier.POSTEX]: postexAdapter,
  [Courier.LEOPARDS]: leopardsAdapter,
  [Courier.TCS]: tcsAdapter,
  [Courier.MP]: mpAdapter,
}

export function getCourierAdapter(courier: Courier): CourierAdapter | undefined {
  return adapters[courier]
}

// The couriers we can actively poll (have an adapter for).
export const SUPPORTED_COURIERS: Courier[] = [Courier.POSTEX, Courier.LEOPARDS, Courier.TCS, Courier.MP]
