import { describe, expect, it } from "vitest";
import { clientConfig, mergeClientConfig } from "../src/core/mcp-config.js";

const ctx = { home: "/home/u", cwd: "/work/proj", platform: "darwin" as const, appData: undefined };

describe("clientConfig", () => {
  it("VS Code: a workspace file with a servers map", () => {
    const c = clientConfig("vscode", ctx);
    expect(c.path).toBe("/work/proj/.vscode/mcp.json");
    expect(c.entry).toEqual({ type: "stdio", command: "orch-mcp", args: [] });
    expect(c.key).toBe("servers");
  });

  it("Cursor: a user file with an mcpServers map", () => {
    const c = clientConfig("cursor", ctx);
    expect(c.path).toBe("/home/u/.cursor/mcp.json");
    expect(c.key).toBe("mcpServers");
    expect(c.entry).toEqual({ command: "orch-mcp", args: [] });
  });

  it("Claude Desktop: the per-platform file", () => {
    expect(clientConfig("claude-desktop", ctx).path).toBe("/home/u/Library/Application Support/Claude/claude_desktop_config.json");
    expect(clientConfig("claude-desktop", { ...ctx, platform: "linux" }).path).toBe("/home/u/.config/Claude/claude_desktop_config.json");
    expect(clientConfig("claude-desktop", { ...ctx, platform: "win32", appData: "C:\\Users\\u\\AppData\\Roaming" }).path).toContain("Claude");
  });
});

describe("mergeClientConfig", () => {
  const vs = clientConfig("vscode", ctx);

  it("creates the file content when there is none", () => {
    const r = mergeClientConfig(undefined, vs);
    expect(JSON.parse(r.text)).toEqual({ servers: { orch: vs.entry } });
    expect(r.change).toBe("added");
  });

  it("keeps every other server and setting", () => {
    const existing = JSON.stringify({ servers: { other: { command: "x" } }, inputs: [1] });
    const r = mergeClientConfig(existing, vs);
    expect(JSON.parse(r.text)).toEqual({ servers: { other: { command: "x" }, orch: vs.entry }, inputs: [1] });
  });

  it("says unchanged when orch is already there with the same entry, updated when it differs", () => {
    const same = JSON.stringify({ servers: { orch: vs.entry } });
    expect(mergeClientConfig(same, vs).change).toBe("unchanged");
    const old = JSON.stringify({ servers: { orch: { command: "old" } } });
    const r = mergeClientConfig(old, vs);
    expect(r.change).toBe("updated");
    expect(JSON.parse(r.text).servers.orch).toEqual(vs.entry);
  });

  it("refuses a file it cannot parse or whose map is not an object, instead of overwriting", () => {
    expect(() => mergeClientConfig("{ // comment\n}", vs)).toThrow(/not valid JSON/);
    expect(() => mergeClientConfig(JSON.stringify({ servers: [] }), vs)).toThrow(/servers/);
    expect(() => mergeClientConfig("[]", vs)).toThrow(/object/);
  });
});
