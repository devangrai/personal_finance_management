"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Session = {
  id: string;
  title: string;
  updatedAt: string;
  archivedAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
};

function groupSessions(sessions: Session[]): {
  label: string;
  sessions: Session[];
}[] {
  const now = new Date();
  const buckets: Record<string, Session[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    "This month": [],
    Older: []
  };
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(today);
  monthStart.setDate(monthStart.getDate() - 30);

  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    if (d >= today) buckets.Today.push(s);
    else if (d >= yesterday) buckets.Yesterday.push(s);
    else if (d >= weekStart) buckets["This week"].push(s);
    else if (d >= monthStart) buckets["This month"].push(s);
    else buckets.Older.push(s);
  }
  return Object.entries(buckets)
    .filter(([, arr]) => arr.length > 0)
    .map(([label, arr]) => ({ label, sessions: arr }));
}

export function ChatSessionsSidebar(props: {
  sessions: Session[];
  activeSessionId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const grouped = groupSessions(props.sessions);

  async function newSession() {
    setCreating(true);
    try {
      const res = await fetch("/api/chat/sessions", { method: "POST" });
      const body = (await res.json()) as {
        session?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.session?.id) {
        throw new Error(body.error ?? "Could not create session");
      }
      startTransition(() => router.push(`/chat/${body.session!.id}`));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="chatSidebar">
      <button
        type="button"
        className="chatSidebarNew"
        onClick={() => void newSession()}
        disabled={creating}
      >
        + New chat
      </button>
      <div className="chatSidebarList">
        {props.sessions.length === 0 ? (
          <p className="chatSidebarEmpty">
            No conversations yet. Start one with the button above.
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.label} className="chatSidebarGroup">
              <p className="chatSidebarGroupLabel">{group.label}</p>
              <ul>
                {group.sessions.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/chat/${s.id}`}
                      className={
                        s.id === props.activeSessionId
                          ? "chatSidebarItem chatSidebarItemActive"
                          : "chatSidebarItem"
                      }
                    >
                      <span className="chatSidebarItemTitle">{s.title}</span>
                      {s.lastMessagePreview ? (
                        <span className="chatSidebarItemPreview">
                          {s.lastMessagePreview.slice(0, 60)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
