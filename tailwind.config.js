/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/web/react/index.html",
    "./src/web/react/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'navetec': {
          'primary': '#FD6144',
          'primary-dark': '#FD3244',
          'primary-medium': '#FD6144',
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