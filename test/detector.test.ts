import { describe, expect, it } from "vitest";
import { classify } from "../src/core/detector.js";

const patterns = ["rate.?limit", "usage limit"];

describe("classify", () => {
  it("is ok on exit 0 even if output mentions a limit", () => {
    expect(classify({ exitCode: 0, stdout: "explains rate limit", stderr: "" }, patterns)).toBe("ok");
  });

  it("is limited when a pattern matches stderr", () => {
    expect(classify({ exitCode: 1, stdout: "", stderr: "Error: Usage Limit reached" }, patterns)).toBe("limited");
  });

  it("is limited when a pattern matches stdout", () => {
    expect(classify({ exitCode: 1, stdout: "rate-limit exceeded", stderr: "" }, patterns)).toBe("limited");
  });

  it("ignores limit words early in a long stdout of a failed run", () => {
    const body = "I added rate limit middleware\n" + Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    expect(classify({ exitCode: 1, stdout: body, stderr: "boom" }, patterns)).toBe("failed");
  });

  it("detects a limit message in the last lines of stdout", () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") + "\nClaude usage limit reached";
    expect(classify({ exitCode: 1, stdout: body, stderr: "" }, patterns)).toBe("limited");
  });

  it("is failed on non-zero exit without a match", () => {
    expect(classify({ exitCode: 2, stdout: "", stderr: "boom" }, patterns)).toBe("failed");
  });

  it("is failed when the process never started (null exit code)", () => {
    expect(classify({ exitCode: null, stdout: "", stderr: "orch: failed to start" }, patterns)).toBe("failed");
  });
});
