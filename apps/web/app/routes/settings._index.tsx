import type { MetaFunction } from '@remix-run/node'
import { Link } from '@remix-run/react'
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Icons } from '~/components/ui'

export const meta: MetaFunction = () => [{ title: 'Settings — EngageIQ' }]

const sections = [
  {
    to: '/settings/team',
    title: 'Team & Roles',
    description: 'Invite teammates, assign roles, and control what each role can access.',
    icon: Icons.Users,
    available: true,
  },
  {
    to: '/settings',
    title: 'Agency & Clients',
    description: 'Manage client accounts and which members can access them. Use the account switcher in the top bar.',
    icon: Icons.AppWindow,
    available: false,
  },
  {
    to: '/settings',
    title: 'Billing',
    description: 'Subscription plan, invoices, and PKR pricing. Owner only.',
    icon: Icons.Sliders,
    available: false,
  },
]

export default function SettingsIndex() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configure"
        title="Settings & RBAC"
        description="Manage your team, roles, and account access."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => {
          const Icon = s.icon
          const inner = (
            <Card className={s.available ? 'h-full transition-colors hover:border-neutral-300' : 'h-full opacity-60'}>
              <CardHeader>
                <span className="mb-2 inline-flex size-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-700">
                  <Icon className="size-[18px]" />
                </span>
                <CardTitle className="flex items-center gap-2">
                  {s.title}
                  {!s.available && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-neutral-500">
                      Soon
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          )
          return s.available ? (
            <Link key={s.title} to={s.to} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 rounded-xl">
              {inner}
            </Link>
          ) : (
            <div key={s.title}>{inner}</div>
          )
        })}
      </div>
    </div>
  )
}
