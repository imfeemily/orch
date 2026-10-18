---
layout: home
hero:
  name: claude-codex-orch
  text: One task, two coding agents
  image:
    src: /img/hero.jpg
    alt: orch routes work between two AI coding agents
  tagline: Route work between Claude Code and Codex, fail over when one hits a limit, and spend fewer tokens doing it.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Developer guide
      link: /developer/architecture
    - theme: alt
      text: คู่มือภาษาไทย
      link: /th/guide/getting-started
features:
  - title: Start from either tool
    details: Call orch from the terminal, from Claude Code, or from Codex (MCP). The same daemon serves all three.
  - title: Fails over on its own
    details: On a rate limit or failure the task moves to the other agent with the original prompt and your git state. Cooldowns follow the reset time the agent reports.
  - title: Cheaper by design
    details: Pick a smaller model per task type, hand over only a diff summary when the change is large, and skip handoff work that cannot succeed.
---
