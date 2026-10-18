/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accent2: 'rgb(var(--accent2) / <alpha-value>)',
        good: 'rgb(var(--good) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Baloo 2"', '"Comic Neue"', 'ui-rounded', 'system-ui', 'sans-serif'],
        body: ['ui-rounded', '"SF Pro Rounded"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        pop: '0 4px 0 0 rgb(var(--ink))',
        popsm: '0 2px 0 0 rgb(var(--ink))',
        poplg: '0 6px 0 0 rgb(var(--ink))',
      },
      borderRadius: { blob: '2rem' },
      keyframes: {
        wiggle: { '0%,100%': { transform: 'rotate(-3deg)' }, '50%': { transform: 'rotate(3deg)' } },
        bob: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } },
        shake: { '0%,100%': { transform: 'translate(0,0)' }, '25%': { transform: 'translate(-4px,2px)' }, '75%': { transform: 'translate(4px,-2px)' } },
        ticker: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        spinslow: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        wiggle: 'wiggle 0.6s ease-in-out infinite',
        bob: 'bob 2s ease-in-out infinite',
        shake: 'shake 0.25s linear 2',
        ticker: 'ticker 40s linear infinite',
        spinslow: 'spinslow 6s linear infinite',
      },
    },
  },
  plugins: [],
};
