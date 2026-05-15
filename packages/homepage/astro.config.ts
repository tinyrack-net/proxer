import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import starlightThemeBlack from "starlight-theme-black";

const cliPackageJson = JSON.parse(
  readFileSync(new URL("../cli/package.json", import.meta.url), "utf8"),
);
const cliVersion = String(cliPackageJson.version);

export default defineConfig({
  site: "https://proxer.tinyrack.net",
  trailingSlash: "always",
  redirects: {
    "/": "/en/",
  },
  server: {
    port: 5432,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  vite: {
    server: {
      strictPort: true,
    },
    define: {
      __CLI_VERSION__: JSON.stringify(cliVersion),
    },
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      expressiveCode: {
        defaultProps: {
          frame: "none",
        },
      },
      title: "Proxer",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "Proxer",
      },
      favicon: "/favicon.svg",
      description:
        "Reverse-tunnel CLI for exposing local HTTP, SSE, and WebSocket services.",
      head: [
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary" },
        },
        {
          tag: "meta",
          attrs: { property: "og:site_name", content: "Proxer" },
        },
      ],
      defaultLocale: "en",
      locales: {
        en: {
          label: "English",
          lang: "en",
        },
        ko: {
          label: "한국어",
          lang: "ko",
        },
        ja: {
          label: "日本語",
          lang: "ja",
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/tinyrack-net/proxer",
        },
      ],
      plugins: [
        starlightThemeBlack({
          footerText:
            "Proxer · MIT License · [GitHub](https://github.com/tinyrack-net/proxer)",
        }),
      ],
      customCss: ["./src/styles/tailwind.css"],
      components: {
        Header: "./src/components/Header.astro",
        Hero: "./src/components/OverrideHero.astro",
      },
      sidebar: [
        {
          label: "Overview",
          translations: {
            ko: "시작하기",
            ja: "はじめに",
          },
          items: [{ slug: "intro" }, { slug: "getting-started" }],
        },
        {
          label: "Guides",
          translations: {
            ko: "가이드",
            ja: "ガイド",
          },
          items: [
            { slug: "guides/how-it-works" },
            { slug: "guides/routing" },
            { slug: "guides/docker" },
          ],
        },
        {
          label: "Command Reference",
          translations: {
            ko: "명령어 레퍼런스",
            ja: "コマンドリファレンス",
          },
          items: [{ slug: "reference/server" }, { slug: "reference/http" }],
        },
      ],
    }),
  ],
});
