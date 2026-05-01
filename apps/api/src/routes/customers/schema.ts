import { z } from 'zod'

export const GetCustomerParamsSchema = z.object({
  id: z.string().cuid(),
})

export const GetCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})

export const CustomerListItemSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  totalOrders: z.number(),
  totalSpent: z.string(),
  rfmSegment: z.string().nullable(),
  churnRiskLabel: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
})

export type GetCustomerParams = z.infer<typeof GetCustomerParamsSchema>
export type GetCustomersQuery = z.infer<typeof GetCustomersQuerySchema>
export type CustomerListItem = z.infer<typeof CustomerListItemSchema>
