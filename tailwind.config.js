/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/web/react/index.html",
    "./src/web/react/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'navetec': {
          'primary': '#00A19C',
          'primary-dark': '#00827E',
          'primary-medium': '#00A19C',
          'primary-light': '#FE8A75',
          'secondary-1': '#AE3A8D',
          'secondary-2': '#C85BAA',
          'secondary-3': '#D97BC4',
          'secondary-4': '#E9A5D9',
        },
        'aloia': {
          'accent':      '#6366f1',
          'accent-dark': '#4338ca',
          'accent-deep': '#3730a3',
          'accent2':     '#06b6d4',
          'surface':     'rgba(255,255,255,0.045)',
          'surface2':    'rgba(255,255,255,0.07)',
          'base':        '#09090f',
          'msg-in':      '#151822',
          'msg-out':     '#4f46e5',
        },
      },
      fontFamily: {
        'merriweather': ['Merriweather Sans', 'sans-serif'],
        'futura': ['Futura PT', 'Segoe UI', 'sans-serif'],
        'sora':  ['Sora', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        'mono':  ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        'panel':  '22px',
        'pill':   '999px',
        'bubble': '16px',
      },
      backdropBlur: {
        'glass': '18px',
      },
    },
  },
  plugins: [],
}