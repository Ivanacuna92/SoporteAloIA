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
        }
      },
      fontFamily: {
        'merriweather': ['Merriweather Sans', 'sans-serif'],
        'futura': ['Futura PT', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}