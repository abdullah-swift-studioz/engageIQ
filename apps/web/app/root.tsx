import {
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react'
import type { LinksFunction } from '@remix-run/node'
import stylesheet from '~/tailwind.css?url'

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
  { rel: 'stylesheet', href: stylesheet },
]

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased">
        <div className="flex min-h-screen flex-col">
          <nav className="border-b border-gray-200 bg-white shadow-sm">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex h-14 items-center gap-8">
                <NavLink
                  to="/"
                  className="text-lg font-bold text-brand-600"
                >
                  EngageIQ
                </NavLink>
                <div className="flex items-center gap-6">
                  <NavLink
                    to="/customers"
                    className={({ isActive }) =>
                      isActive
                        ? 'text-sm font-medium text-brand-600 border-b-2 border-brand-600 pb-0.5'
                        : 'text-sm font-medium text-gray-600 hover:text-gray-900'
                    }
                  >
                    Customers
                  </NavLink>
                </div>
              </div>
            </div>
          </nav>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
