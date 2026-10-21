import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  describeNow,
  normalizePlan,
  type TaskContext,
} from "./interpretMessage";

const tasks: TaskContext[] = [
  {
    number: 5,
    title: "Call dentist",
    description: null,
    status: "PENDING",
    priority: "MEDIUM",
    dueDate: "2026-10-22T14:00:00.000Z",
  },
];

interface RawChanges {
  title: string | null;
  description: string | null;
  priority: string | null;
  dueDate: string | null;
  clearDueDate: boolean;
  status: string | null;
}

const noChanges: RawChanges = {
  title: null,
  description: null,
  priority: null,
  dueDate: null,
  clearDueDate: false,
  status: null,
};

function update(taskNumber: number | null, changes: Partial<RawChanges> | null) {
  return {
    action: "update",
    task: null,
    taskNumber,
    changes: changes && { ...noChanges, ...changes },
    message: null,
  };
}

describe("normalizePlan", () => {
  it("accepts a new task", () => {
    expect(
      normalizePlan(
        {
          action: "create",
          task: { title: "Buy milk", description: null, priority: "LOW", dueDate: null },
          taskNumber: null,
          changes: null,
          message: null,
        },
        tasks,
      ),
    ).toEqual({
      action: "create",
      task: { title: "Buy milk", description: null, priority: "LOW", dueDate: null },
    });
  });

  it("keeps only the fields that change", () => {
    expect(
      normalizePlan(
        update(5, {
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          dueDate: "2026-10-23T18:00:00+04:00",
        }),
        tasks,
      ),
    ).toEqual({
      action: "update",
      taskNumber: 5,
      changes: { status: "IN_PROGRESS", dueDate: new Date("2026-10-23T14:00:00.000Z") },
    });
  });

  it("supports removing the due date and the description", () => {
    expect(normalizePlan(update(5, { clearDueDate: true, description: "" }), tasks)).toEqual({
      action: "update",
      taskNumber: 5,
      changes: { dueDate: null },
    });
  });

  it("asks for clarification when the task is unknown or nothing would change", () => {
    expect(normalizePlan(update(9, { status: "COMPLETED" }), tasks)).toEqual({
      action: "clarify",
      message: "I couldn't find task #09 among your tasks.",
    });
    expect(normalizePlan(update(5, { status: "PENDING" }), tasks)).toMatchObject({
      action: "clarify",
      message: expect.stringContaining("#05 already looks like that"),
    });
    expect(normalizePlan(update(null, null), tasks)).toMatchObject({ action: "clarify" });
  });

  it("passes clarifying questions through and rejects unusable output", () => {
    expect(
      normalizePlan(
        { action: "clarify", task: null, taskNumber: null, changes: null, message: " Which one? " },
        tasks,
      ),
    ).toEqual({ action: "clarify", message: "Which one?" });
    expect(
      normalizePlan(
        { action: "clarify", task: null, taskNumber: null, changes: null, message: null },
        tasks,
      ),
    ).toBeNull();
    expect(normalizePlan({ action: "delete" }, tasks)).toBeNull();
    expect(normalizePlan(null, tasks)).toBeNull();
  });
});

describe("prompt", () => {
  const now = new Date("2026-10-21T05:00:00Z");

  it("includes the local time and UTC offset for resolving relative dates", () => {
    expect(describeNow(now, "Asia/Yerevan")).toContain("UTC offset +04:00");
    expect(buildSystemPrompt({ now, timeZone: "Asia/Yerevan", tasks: [] })).toContain(
      "Wednesday, October 21, 2026",
    );
  });

  it("lists the user's tasks in local time and the replied-to message", () => {
    const prompt = buildSystemPrompt({
      now,
      timeZone: "Asia/Yerevan",
      tasks,
      replyTo: "Task created\n\n#05 · Call dentist",
    });
    expect(prompt).toContain('"number":5');
    expect(prompt).toContain('"due":"2026-10-22 18:00"');
    expect(prompt).toContain("replying to this earlier message:\nTask created");
  });
});
