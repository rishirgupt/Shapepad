/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "slide-in": {
          "0%": { transform: "translateX(-120%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        "fade-in": "fade-in 140ms ease-out",
      },
      boxShadow: {
        float: "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)",
      },
    },
  },
  plugins: [],
};
