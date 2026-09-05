/** @type {import('tailwindcss').Config} */

// "Instrument" palette — the app styled as a physical medical device rather than a
// web page: a warm-grey body, panels that sit on it, controls that look pressable.
//
// The remap trick from the previous theme is kept: Tailwind's blue/indigo/green/gray
// scales are redefined, so every component that already says `bg-blue-600` or
// `text-gray-600` recolours automatically and no component markup has to change.
const ember = {
  50: '#FDF1E8', 100: '#FBDFC9', 200: '#F6BE97', 300: '#F09A63', 400: '#EE7B36',
  500: '#E8590C', 600: '#C74A08', 700: '#A03C07', 800: '#7C2F06', 900: '#5E2405',
};
const clay = {
  50: '#FBEFE8', 100: '#F5DBCB', 200: '#E9B79A', 300: '#DC9269', 400: '#D07444',
  500: '#B85E2E', 600: '#9B4C23', 700: '#7B3C1C', 800: '#5F2F16', 900: '#4B2512',
};
const moss = {
  50: '#EFF4EE', 100: '#DCE8DB', 200: '#BCD2BA', 300: '#96B795', 400: '#6F9A70',
  500: '#3E7B4F', 600: '#336440', 700: '#2A5134', 800: '#22402A', 900: '#1B3322',
};
// Warm stone body. 50-200 are the device surfaces the whole UI sits on.
const stone = {
  50: '#F7F5F0', 100: '#F3F1EC', 200: '#E4E1DA', 300: '#CFCBC2', 400: '#A8A499',
  500: '#8A867E', 600: '#6E6A63', 700: '#4A4844', 800: '#2A2925', 900: '#1A1918',
};

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './styles/**/*.css',
  ],
  theme: {
    extend: {
      colors: {
        // remapped scales (brand recolor happens here)
        blue: ember,
        indigo: clay,
        green: moss,
        gray: stone,
        // semantic aliases + canvas
        primary: ember,
        secondary: moss,
        ember,
        moss,
        clay,
        stone,
        // kept as aliases so any component still naming the old theme keeps working
        coral: ember,
        sage: moss,
        terracotta: clay,
        /** The device body the panels sit on. */
        cream: '#E8E6E0',
        /** The deeper shell behind the device. */
        shell: '#C9C6BE',
        /** Inset dark readout panel (differentials, live values). */
        readout: '#1F2422',
        success: moss,
        warning: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
          500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f',
        },
        error: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171',
          500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d',
        },
      },
      fontFamily: {
        // Instrument runs on one face at several weights. `serif` is deliberately
        // mapped to it too, so the existing `font-serif` headings restyle rather
        // than needing every heading edited.
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        serif: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 3px rgba(26, 25, 24, 0.07)',
        medium: '0 2px 8px rgba(26, 25, 24, 0.1)',
        strong: '0 20px 44px -14px rgba(26, 25, 24, 0.4), 0 2px 5px rgba(26, 25, 24, 0.13)',
        /** Pressable control: a hard bottom edge, not a blur. */
        key: '0 3px 0 rgba(0, 0, 0, 0.24)',
        'key-muted': '0 3px 0 #CFCBC2',
        /** Recessed field or readout. */
        inset: 'inset 0 1px 4px rgba(26, 25, 24, 0.09)',
        'inset-deep': 'inset 0 2px 6px rgba(26, 25, 24, 0.28)',
      },
      spacing: { 18: '4.5rem', 88: '22rem', 128: '32rem' },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-in': 'slideIn 0.5s ease-out',
        'bounce-soft': 'bounceSoft 2s infinite',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { '0%': { opacity: '0', transform: 'translateX(-20px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        bounceSoft: { '0%, 100%': { transform: 'translateY(-5%)' }, '50%': { transform: 'translateY(0)' } },
        pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.8' } },
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
  ],
};
