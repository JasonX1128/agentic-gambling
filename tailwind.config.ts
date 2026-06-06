import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular"]
      },
      colors: {
        ink: "#111315",
        panel: "#f7f8fa",
        line: "#d9dee5",
        signal: "#1f6feb",
        healthy: "#0a7f53",
        warning: "#a15c00",
        danger: "#b42318"
      }
    }
  },
  plugins: []
};

export default config;
