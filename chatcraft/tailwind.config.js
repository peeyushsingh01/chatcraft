const a = (n) => `rgb(var(--a${n}) / <alpha-value>)`
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: { accent: { 300: a(300), 400: a(400), 500: a(500), 600: a(600), 700: a(700) } },
    },
  },
}
