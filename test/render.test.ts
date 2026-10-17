import { describe, expect, it } from "vitest";
import { finalOutputToPrint } from "../src/cli/render.js";

describe("finalOutputToPrint", () => {
  it("prints nothing when the output was already streamed or is empty", () => {
    expect(finalOutputToPrint(true, "pong")).toBe("");
    expect(finalOutputToPrint(false, "")).toBe("");
  });

  it("prints the answer with exactly one trailing newline", () => {
    expect(finalOutputToPrint(false, "pong")).toBe("pong\n");
    expect(finalOutputToPrint(false, "pong\n")).toBe("pong\n");
  });
});
