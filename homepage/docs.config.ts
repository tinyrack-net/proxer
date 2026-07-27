import { defineDocsConfig } from "@tinyrack/docs/config";

const labels = (en: string, ko: string, ja: string) => ({ en, ja, ko });

export default defineDocsConfig({
  contentDir: "app/content",
  header: {
    links: [
      {
        label: labels("Docs", "문서", "ドキュメント"),
        path: "/{locale}/intro/",
      },
      {
        label: "GitHub",
        path: "https://github.com/tinyrack-net/proxer",
      },
    ],
    title: true,
  },
  i18n: {
    defaultLocale: "en",
    locales: {
      en: { label: "English", language: "en", openGraph: "en_US" },
      ko: { label: "한국어", language: "ko", openGraph: "ko_KR" },
      ja: { label: "日本語", language: "ja", openGraph: "ja_JP" },
    },
  },
  navigation: [
    {
      type: "group",
      label: labels("Overview", "개요", "概要"),
      children: [
        { type: "page", contentKey: "/intro" },
        { type: "page", contentKey: "/getting-started" },
      ],
    },
    {
      type: "group",
      label: labels("Guides", "가이드", "ガイド"),
      children: ["how-it-works", "routing", "docker"].map((slug) => ({
        type: "page" as const,
        contentKey: `/guides/${slug}`,
      })),
    },
    {
      type: "group",
      label: labels(
        "Command Reference",
        "명령어 레퍼런스",
        "コマンドリファレンス",
      ),
      children: ["server", "http", "skill-install"].map((slug) => ({
        type: "page" as const,
        contentKey: `/reference/${slug}`,
      })),
    },
  ],
  redirects: { "/": "/en/" },
  sections: [
    {
      id: "overview",
      label: labels("Overview", "개요", "概要"),
      order: 0,
    },
    {
      id: "guides",
      label: labels("Guides", "가이드", "ガイド"),
      order: 1,
    },
    {
      id: "reference",
      label: labels(
        "Command Reference",
        "명령어 레퍼런스",
        "コマンドリファレンス",
      ),
      order: 2,
    },
  ],
  site: {
    basePath: "/",
    description:
      "A self-hosted reverse tunnel for HTTP, SSE, and WebSocket services.",
    favicon: "/favicon.svg",
    locale: { language: "en", openGraph: "en_US" },
    logo: { alt: "Proxer", dark: "/favicon.svg", light: "/favicon.svg" },
    title: "Proxer",
    url: "https://proxer.tinyrack.net",
  },
  theme: { default: "dark" },
});
