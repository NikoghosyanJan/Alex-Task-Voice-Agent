"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskEvent } from "@taskbot/shared/types";

export type ConnectionState = "connecting" | "live" | "paused" | "offline";

interface Options {
  onEvent: (event: TaskEvent) => void;
  /** Called after a reconnect so events missed while disconnected are recovered. */
  onResync: () => void;
}

/**
 * Subscribes to /api/events. The stream is closed while the tab is hidden (saves serverless
 * function time) and the server ends it every ~280s; EventSource reconnects automatically.
 */
export function useTaskEvents({ onEvent, onResync }: Options): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);

  useEffect(() => {
    onEventRef.current = onEvent;
    onResyncRef.current = onResync;
  }, [onEvent, onResync]);

  useEffect(() => {
    let source: EventSource | null = null;
    let connectedOnce = false;

    const open = () => {
      if (source) return;
      setState("connecting");
      source = new EventSource("/api/events");

      source.addEventListener("ready", () => {
        setState("live");
        if (connectedOnce) onResyncRef.current();
        connectedOnce = true;
      });

      source.addEventListener("task", (message) => {
        try {
          onEventRef.current(JSON.parse((message as MessageEvent<string>).data) as TaskEvent);
        } catch {
          // ignore malformed payloads
        }
      });

      source.onerror = () => {
        setState(source?.readyState === EventSource.CLOSED ? "offline" : "connecting");
      };
    };

    const close = () => {
      source?.close();
      source = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        close();
        setState("paused");
      } else {
        open();
      }
    };

    if (!document.hidden) open();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      close();
    };
  }, []);

  return state;
}
