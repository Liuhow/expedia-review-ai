import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        expediaBlue: "#1668e3",
        expediaNavy: "#0f172a",
        expediaBg: "#f5f7fa",
        expediaGreen: "#1d7f49",
        expediaYellow: "#ffd83d"
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.06), 0 4px 16px rgba(16,24,40,0.04)"
      },
      borderRadius: {
        xl2: "1.25rem"
      }
    }
  },
  plugins: []
} satisfies Config;
