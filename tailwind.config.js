const a = (n) => `rgb(var(--a${n}) / <alpha-value>)`
const s = (n) => `rgb(var(--s${n}) / <alpha-value>)`
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        accent: { 300: a(300), 400: a(400), 500: a(500), 600: a(600), 700: a(700) },
        slate: {
          50: s(50), 100: s(100), 200: s(200), 300: s(300), 400: s(400), 500: s(500),
          600: s(600), 700: s(700), 800: s(800), 900: s(900), 950: s(950),
        },
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
      },
    },
  },
}
