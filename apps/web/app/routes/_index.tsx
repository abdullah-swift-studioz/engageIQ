import type { MetaFunction } from '@remix-run/node'

export const meta: MetaFunction = () => [
  { title: 'EngageIQ — Customer Engagement Platform' },
  { name: 'description', content: 'WhatsApp-first, COD-native customer engagement for South Asian Shopify brands.' },
]

export default function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-brand-600">EngageIQ</h1>
        <p className="mt-2 text-gray-500">Dashboard coming soon.</p>
      </div>
    </div>
  )
}
