import { Redis } from 'ioredis'
import { env } from '@engageiq/shared'

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

redisConnection.on('error', (err: Error) => {
  console.error('[redis] connection error:', err)
})
