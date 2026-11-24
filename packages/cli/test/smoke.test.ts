import { describe, expect, it } from "vitest";
import { createProgram } from "../src/main.js";

describe("specimen CLI program", () => {
  it("is named specimen and exposes the hook command group", () => {
    const program = createProgram();
    expect(program.name()).toBe("specimen");
    expect(program.commands.map((command) => command.name())).toContain("hook");
  });
});
