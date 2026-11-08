import type { Config } from "tailwindcss";
export default { content: ["./index.html", "./src/**/*.ts"], theme: { extend: { colors: { surface: "rgb(var(--color-surface) / <alpha-value>)", text: "rgb(var(--color-text) / <alpha-value>)" } } }, plugins: [] } satisfies Config;
