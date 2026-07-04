import { z } from 'zod'

// A DNS-safe domain (no scheme/path). Lowercased in the service.
export const CreateDomainBodySchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^(?!-)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/, 'Enter a bare domain, e.g. mail.yourstore.com'),
})

export const DomainParamsSchema = z.object({ id: z.string().cuid() })

export type CreateDomainBody = z.infer<typeof CreateDomainBodySchema>
