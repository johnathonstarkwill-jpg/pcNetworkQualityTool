import { describe, expect, it } from "vitest";
import { MAX_LOG_LINES, appendLog, stamp } from "../../src/main/logBuffer";

describe("logBuffer", () => {
  it("appends a line returning a new array without mutating input", () => {
    const input = ["a"];
    const out = appendLog(input, "b");
    expect(out).toEqual(["a", "b"]);
    expect(input).toEqual(["a"]);
  });

  it("caps the buffer at MAX_LOG_LINES dropping the oldest", () => {
    const full = Array.from({ length: MAX_LOG_LINES }, (_, i) => `line-${i}`);
    const out = appendLog(full, "newest");
    expect(out.length).toBe(MAX_LOG_LINES);
    expect(out[0]).toBe("line-1");
    expect(out[out.length - 1]).toBe("newest");
  });

  it("prefixes a line with an HH:MM:SS timestamp", () => {
    const fixed = new Date(2026, 5, 10, 9, 8, 7);
    expect(stamp("hello", fixed)).toBe("[09:08:07] hello");
  });
});
