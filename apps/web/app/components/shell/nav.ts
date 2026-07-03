import type { ComponentType } from 'react'
import type { IconProps } from '../ui/icons'
import {
  Dashboard,
  Users,
  Filter,
  Megaphone,
  Route,
  Workflow,
  MessageCircle,
  Inbox,
  BarChart,
  AppWindow,
  Sliders,
} from '../ui/icons'

export interface NavLeaf {
  label: string
  to: string
  /** Exact-match active state (needed for index-style routes like `/`). */
  end?: boolean
  /** Section is planned; its route lands with a later feature lane. */
  soon?: boolean
}

export interface NavItem extends NavLeaf {
  icon: ComponentType<IconProps>
  children?: NavLeaf[]
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

/**
 * The single source of truth for primary navigation. Every product section is
 * listed here — feature lanes add their route, not their own nav entry, so the
 * shell always shows the full map. Analytics sub-pages nest under Analytics.
 */
export const NAV: NavSection[] = [
  {
    items: [{ label: 'Dashboard', to: '/', end: true, icon: Dashboard }],
  },
  {
    title: 'Audience',
    items: [
      { label: 'Customers', to: '/customers', icon: Users },
      { label: 'Segments', to: '/segments', icon: Filter },
    ],
  },
  {
    title: 'Engage',
    items: [
      { label: 'Campaigns', to: '/campaigns', icon: Megaphone },
      { label: 'Journeys', to: '/journeys', icon: Route },
      { label: 'Flows', to: '/flows', icon: Workflow, soon: true },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { label: 'WhatsApp Templates', to: '/whatsapp-templates', icon: MessageCircle },
      { label: 'Messages', to: '/messages', icon: Inbox },
    ],
  },
  {
    title: 'Insights',
    items: [
      {
        label: 'Analytics',
        to: '/analytics',
        icon: BarChart,
        children: [
          { label: 'Real-Time', to: '/analytics', end: true },
          { label: 'RFM Segments', to: '/analytics/rfm' },
          { label: 'Funnels', to: '/analytics/funnel' },
          { label: 'Cohorts', to: '/analytics/cohort' },
          { label: 'Attribution', to: '/analytics/attribution' },
          { label: 'Products', to: '/analytics/products' },
          { label: 'COD Analytics', to: '/analytics/cod' },
        ],
      },
    ],
  },
  {
    title: 'Configure',
    items: [
      { label: 'On-Site', to: '/on-site', icon: AppWindow }, // lane:onsite — route shipped
      { label: 'Settings & RBAC', to: '/settings', icon: Sliders, soon: true },
    ],
  },
]
