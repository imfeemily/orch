import type { AgentOutput, OutputKind, Usage } from "./types.js";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function parseClaude(stdout: string): AgentOutput | null {
  const obj = JSON.parse(stdout.trim());
  if (!obj || typeof obj !== "object" || typeof obj.result !== "string") return null;
  const out: AgentOutput = { text: obj.result };
  if (obj.is_error === true) out.errorText = obj.result;
  const u = obj.usage;
  if (u && typeof u === "object") {
    const usage: Usage = {
      inputTokens: num(u.input_tokens) + num(u.cache_creation_input_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      outputTokens: num(u.output_tokens),
    };
    if (typeof obj.total_cost_usd === "number") usage.costUsd = obj.total_cost_usd;
    out.usage = usage;
  }
  return out;
}

/** Codex wraps API errors as a JSON string; return the inner message when there is one. */
function unwrapMessage(message: unknown): string | null {
  if (typeof message !== "string" || message === "") return null;
  try {
    const inner = JSON.parse(message);
    const nested = inner?.error?.message ?? inner?.message;
    if (typeof nested === "string") return nested;
  } catch {
    /* not JSON: use as is */
  }
  return message;
}

function parseCodex(stdout: string): AgentOutput | null {
  const events: Array<Record<string, any>> = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev.type === "string") events.push(ev);
    } catch {
      /* not an event line */
    }
  }
  if (events.length === 0) return null;

  let text = "";
  let usage: Usage | undefined;
  const errors: string[] = [];
  for (const ev of events) {
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") {
      text = ev.item.text;
    } else if (ev.type === "turn.completed" && ev.usage && typeof ev.usage === "object") {
      const cached = num(ev.usage.cached_input_tokens);
      usage = {
        inputTokens: Math.max(0, num(ev.usage.input_tokens) - cached),
        cacheReadTokens: cached,
        outputTokens: num(ev.usage.output_tokens),
      };
      if (ev.usage.reasoning_output_tokens !== undefined) usage.reasoningTokens = num(ev.usage.reasoning_output_tokens);
    } else if (ev.type === "error" || ev.type === "turn.failed") {
      const msg = unwrapMessage(ev.type === "error" ? ev.message : ev.error?.message);
      if (msg && !errors.includes(msg)) errors.push(msg);
    }
  }
  const out: AgentOutput = { text };
  if (errors.length) out.errorText = errors.join("\n");
  if (usage) out.usage = usage;
  return out;
}

/**
 * Splits an agent's stdout into its answer, an error message and token usage.
 * Anything that does not match the expected shape falls back to the raw text.
 */
export function parseAgentOutput(kind: OutputKind, stdout: string): AgentOutput {
  try {
    if (kind === "claude-json") return parseClaude(stdout) ?? { text: stdout };
    if (kind === "codex-jsonl") return parseCodex(stdout) ?? { text: stdout };
  } catch {
    /* fall through to the raw text */
  }
  return { text: stdout };
}
