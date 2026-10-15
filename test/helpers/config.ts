import { DEFAULT_CONFIG } from "../../src/core/config.js";
import type { Config } from "../../src/core/types.js";

/** DEFAULT_CONFIG without summaryArgs, so tests control whether summaries happen. */
export function noSummaryConfig(): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  delete c.agents.claude.summaryArgs;
  delete c.agents.codex.summaryArgs;
  return c;
}

export function withSummaryConfig(): Config {
  const c = structuredClone(DEFAULT_CONFIG);
  c.agents.claude.summaryArgs = ["--summary", "{prompt}"];
  c.agents.codex.summaryArgs = ["--summary", "{prompt}"];
  return c;
}
