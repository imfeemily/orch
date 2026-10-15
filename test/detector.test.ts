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

  it("is failed on non-zero exit without a match", () => {
    expect(classify({ exitCode: 2, stdout: "", stderr: "boom" }, patterns)).toBe("failed");
  });

  it("is failed when the process never started (null exit code)", () => {
    expect(classify({ exitCode: null, stdout: "", stderr: "orch: failed to start" }, patterns)).toBe("failed");
  });
});
