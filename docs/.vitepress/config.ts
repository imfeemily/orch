import { defineConfig } from "vitepress";

// GitHub Pages serves project sites under /<repo>/; the workflow sets DOCS_BASE.
const base = process.env.DOCS_BASE ?? "/";

const developerSidebar = {
  text: "Developer guide",
  items: [
    { text: "Architecture", link: "/developer/architecture" },
    { text: "Development setup", link: "/developer/setup" },
    { text: "Testing", link: "/developer/testing" },
    { text: "Conventions", link: "/developer/conventions" },
    { text: "Releasing", link: "/developer/release" },
    { text: "Documentation policy", link: "/developer/docs-policy" },
  ],
};

const referenceSidebar = {
  text: "Reference",
  items: [
    { text: "Defaults", link: "/reference/config" },
    { text: "CLI", link: "/reference/cli" },
    { text: "Changelog", link: "/changelog" },
  ],
};

export default defineConfig({
  title: "claude-codex-orch",
  description: "Route coding tasks between Claude Code and Codex, fail over on limits, save tokens.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["superpowers/**"],
  themeConfig: { search: { provider: "local" } },
  locales: {
    root: {
      label: "English",
      lang: "en",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/guide/getting-started" },
          { text: "Developer", link: "/developer/architecture" },
          { text: "Reference", link: "/reference/config" },
        ],
        sidebar: {
          "/guide/": [
            {
              text: "Guide",
              items: [
                { text: "Getting started", link: "/guide/getting-started" },
                { text: "Usage", link: "/guide/usage" },
                { text: "Roles", link: "/guide/roles" },
                { text: "Configuration", link: "/guide/configuration" },
                { text: "Troubleshooting", link: "/guide/troubleshooting" },
                { text: "Benchmarks", link: "/guide/benchmarks" },
              ],
            },
          ],
          "/developer/": [developerSidebar],
          "/reference/": [referenceSidebar],
          "/changelog": [referenceSidebar],
        },
      },
    },
    th: {
      label: "ไทย",
      lang: "th",
      link: "/th/",
      themeConfig: {
        nav: [
          { text: "คู่มือ", link: "/th/guide/getting-started" },
          { text: "Developer (English)", link: "/developer/architecture" },
          { text: "Reference", link: "/reference/config" },
        ],
        sidebar: {
          "/th/guide/": [
            {
              text: "คู่มือ",
              items: [
                { text: "เริ่มต้นใช้งาน", link: "/th/guide/getting-started" },
                { text: "วิธีใช้งาน", link: "/th/guide/usage" },
                { text: "Roles", link: "/th/guide/roles" },
                { text: "การตั้งค่า", link: "/th/guide/configuration" },
                { text: "แก้ปัญหา", link: "/th/guide/troubleshooting" },
                { text: "ผลวัดจริง", link: "/th/guide/benchmarks" },
              ],
            },
          ],
        },
        outline: { label: "ในหน้านี้" },
        docFooter: { prev: "ก่อนหน้า", next: "ถัดไป" },
        lastUpdated: { text: "อัปเดตล่าสุด" },
      },
    },
  },
});
