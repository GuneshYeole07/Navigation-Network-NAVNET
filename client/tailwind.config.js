/** NavNet design tokens — drawn from Indian highway signage. */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        nh: { DEFAULT: "#0E6B4E", 50: "#E8F3EF", 100: "#C9E4DA", 400: "#2E9672", 600: "#0E6B4E", 700: "#0A5640", 800: "#08402F" },
        stone: { cap: "#F2B705", capdark: "#C99600" },
        signal: { DEFAULT: "#D7263D", 50: "#FDECEE", 600: "#D7263D", 700: "#B01C30" },
        asphalt: { DEFAULT: "#1C2226", 700: "#252C31", 600: "#2F383E", 500: "#3D474E" },
        road: { DEFAULT: "#F5F7F4", line: "#E3E7E2" },
        mist: "#8A9499",
      },
      fontFamily: {
        display: ['"Barlow Condensed"', "system-ui", "sans-serif"],
        sans: ['"Public Sans"', "system-ui", "sans-serif"],
      },
      borderRadius: { sheet: "1.25rem", control: "0.625rem" },
      boxShadow: {
        sheet: "0 -8px 30px -12px rgba(16,24,28,.25), 0 2px 8px rgba(16,24,28,.06)",
        float: "0 10px 30px -10px rgba(16,24,28,.35)",
      },
    },
  },
  plugins: [],
};
