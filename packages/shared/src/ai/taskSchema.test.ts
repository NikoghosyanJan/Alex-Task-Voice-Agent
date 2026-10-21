import { describe, expect, it } from "vitest";
import { fallbackTask, normalizeStructuredTask, TITLE_MAX } from "./taskSchema";

describe("normalizeStructuredTask", () => {
  it("accepts valid model output and parses the due date", () => {
    const task = normalizeStructuredTask({
      title: "  Call   the dentist ",
      description: "Ask about the  appointment",
      priority: "HIGH",
      dueDate: "2026-10-22T10:00:00+04:00",
    });
    expect(task).toEqual({
      title: "Call the dentist",
      description: "Ask about the  appointment",
      priority: "HIGH",
      dueDate: new Date("2026-10-22T06:00:00.000Z"),
    });
  });

  it("turns empty descriptions and invalid dates into null", () => {
    const task = normalizeStructuredTask({
      title: "Pay rent",
      description: "  ",
      priority: "LOW",
      dueDate: "next friday",
    });
    expect(task?.description).toBeNull();
    expect(task?.dueDate).toBeNull();
  });

  it("rejects unknown priorities, missing keys and empty titles", () => {
    expect(
      normalizeStructuredTask({ title: "x", description: null, priority: "URGENT", dueDate: null }),
    ).toBeNull();
    expect(normalizeStructuredTask({ title: "x" })).toBeNull();
    expect(
      normalizeStructuredTask({ title: "   ", description: null, priority: "LOW", dueDate: null }),
    ).toBeNull();
    expect(normalizeStructuredTask(null)).toBeNull();
  });

  it("truncates very long titles", () => {
    const task = normalizeStructuredTask({
      title: "a".repeat(500),
      description: null,
      priority: "MEDIUM",
      dueDate: null,
    });
    expect(task?.title).toHaveLength(TITLE_MAX);
    expect(task?.title.endsWith("…")).toBe(true);
  });
});

describe("fallbackTask", () => {
  it("uses the first line as the title and keeps the full text as description", () => {
    expect(fallbackTask("Buy groceries\nmilk, eggs, bread")).toEqual({
      title: "Buy groceries",
      description: "Buy groceries\nmilk, eggs, bread",
      priority: "MEDIUM",
      dueDate: null,
    });
  });

  it("has no description for short single-line text", () => {
    expect(fallbackTask("  Water the plants ").description).toBeNull();
  });
});
