"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Inbox } from "lucide-react";
import { useState } from "react";
import {
  STATUS_LABELS,
  TASK_STATUSES,
  type TaskDTO,
  type TaskStatusValue,
} from "@taskbot/shared/types";
import { cn } from "@/lib/utils";
import { STATUS_STYLES } from "./statusStyles";
import { TaskCard } from "./TaskCard";

interface Props {
  tasks: TaskDTO[];
  now: number;
  highlighted: ReadonlySet<string>;
  onStatusChange: (id: string, status: TaskStatusValue) => void;
  onDelete: (id: string) => void;
}

function DraggableTask(props: {
  task: TaskDTO;
  now: number;
  highlighted: boolean;
  onStatusChange: Props["onStatusChange"];
  onDelete: Props["onDelete"];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.task.id });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("cursor-grab touch-manipulation list-none", isDragging && "opacity-40")}
    >
      <TaskCard
        task={props.task}
        now={props.now}
        highlighted={props.highlighted}
        onStatusChange={props.onStatusChange}
        onDelete={props.onDelete}
      />
    </li>
  );
}

function Column(props: {
  status: TaskStatusValue;
  tasks: TaskDTO[];
  now: number;
  highlighted: ReadonlySet<string>;
  onStatusChange: Props["onStatusChange"];
  onDelete: Props["onDelete"];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.status });
  const styles = STATUS_STYLES[props.status];

  return (
    <section
      ref={setNodeRef}
      aria-label={STATUS_LABELS[props.status]}
      className={cn(
        "flex min-h-40 flex-col rounded-2xl border border-slate-200/80 p-3 transition-colors dark:border-slate-800",
        styles.column,
        isOver && "border-blue-400 ring-2 ring-blue-400/40 dark:border-blue-500",
      )}
    >
      <header className="mb-3 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2.5 rounded-full", styles.dot)} aria-hidden />
          {STATUS_LABELS[props.status]}
        </h2>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
          {props.tasks.length}
        </span>
      </header>

      {props.tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 py-8 text-xs text-slate-400 dark:border-slate-700">
          <Inbox className="size-5" aria-hidden />
          Drop tasks here
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {props.tasks.map((task) => (
            <DraggableTask
              key={task.id}
              task={task}
              now={props.now}
              highlighted={props.highlighted.has(task.id)}
              onStatusChange={props.onStatusChange}
              onDelete={props.onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function KanbanBoard({ tasks, now, highlighted, onStatusChange, onDelete }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // A small distance threshold keeps clicks on the status buttons working.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const activeTask = activeId ? tasks.find((task) => task.id === activeId) : undefined;

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const target = event.over?.id as TaskStatusValue | undefined;
    const task = tasks.find((t) => t.id === event.active.id);
    if (task && target && TASK_STATUSES.includes(target) && task.status !== target) {
      onStatusChange(task.id, target);
    }
  };

  return (
    <DndContext
      id="task-board"
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={tasks.filter((task) => task.status === status)}
            now={now}
            highlighted={highlighted}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            now={now}
            overlay
            onStatusChange={() => undefined}
            onDelete={() => undefined}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
