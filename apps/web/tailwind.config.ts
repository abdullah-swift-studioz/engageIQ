import type { Config } from 'tailwindcss'

/**
 * EngageIQ Design System — STRICT MONOCHROME
 * -------------------------------------------------------------
 * The entire color palette is replaced (not extended) with a single true-gray
 * ramp plus white/black. There are intentionally NO hues in the system: it is
 * structurally impossible to write `bg-blue-500`, `text-red-600`, etc. — those
 * classes simply do not exist. Semantic state (success / error / warning /
 * selected) is expressed through shade, border weight, fills, icons and font
 * weight — never color.
 *
 * `gray` and `brand` are aliased to the same neutral ramp so any pre-existing
 * `gray-*` / `brand-*` usage in feature pages keeps resolving (to grayscale)
 * until the restyle lane migrates it. Hue classes still present in feature
 * pages no-op harmlessly (Tailwind just doesn't emit them).
 *
 * See docs/DESIGN_SYSTEM.md for the full rationale and the no-color rule.
 */

const neutral = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#E5E5E5',
  300: '#D4D4D4',
  400: '#A3A3A3',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0A0A0A',
} as const

// `brand` maps onto the ink end of the ramp so legacy `brand-600` etc. render
// as near-black rather than an accent. Light shades stay light gray.
const brand = {
  50: '#F5F5F5',
  100: '#E5E5E5',
  200: '#D4D4D4',
  300: '#A3A3A3',
  400: '#737373',
  500: '#404040',
  600: '#0A0A0A',
  700: '#0A0A0A',
  800: '#000000',
  900: '#000000',
  950: '#000000',
} as const

export default {
  content: ['./app/**/*.{js,jsx,ts,tsx}'],
  theme: {
    // REPLACE the palette entirely — this is what enforces monochrome.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      white: '#FFFFFF',
      black: '#000000',
      neutral,
      gray: neutral,
      brand,
    },
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      fontSize: {
        // 11px eyebrow / data-label size — the system's signature micro-label
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
      borderRadius: {
        // deliberately small + consistent
        none: '0',
        sm: '0.25rem', // 4px
        DEFAULT: '0.375rem', // 6px
        md: '0.375rem', // 6px
        lg: '0.5rem', // 8px
        xl: '0.625rem', // 10px
        '2xl': '0.875rem', // 14px
        full: '9999px',
      },
      boxShadow: {
        // subtle black-alpha only; the system leans on borders, not elevation
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 1px 0 rgb(0 0 0 / 0.04)',
        DEFAULT: '0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.05)',
        md: '0 2px 4px -1px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.06)',
        lg: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 10px 24px -4px rgb(0 0 0 / 0.08)',
        overlay:
          '0 8px 24px -6px rgb(0 0 0 / 0.12), 0 16px 40px -12px rgb(0 0 0 / 0.14)',
        none: 'none',
      },
      ringColor: {
        DEFAULT: '#0A0A0A',
      },
      ringOffsetColor: {
        DEFAULT: '#FFFFFF',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'overlay-in': 'overlay-in 0.2s ease-out',
        'scale-in': 'scale-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        'drawer-in': 'slide-in-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'drawer-in-left': 'slide-in-left 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'slide-in-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
