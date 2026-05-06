"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NudgesWidget } from "./nudges-widget";

type AppliedLesson = {
  id: string;
  topic: string;
  kind: string;
  actionOrCaveat: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  // assistant metadata, if any
  specialists?: string[];
  toolCalls?: number;
  appliedLessons?: AppliedLesson[];
  latencyMs?: number;
  bullets?: string[];
  caveat?: string | null;
  followUps?: string[];
  isError?: boolean;
  // optimistic flag
  pending?: boolean;
};

const DEFAULT_PROMPTS = [
  "Am I on track for retirement?",
  "How did my spending look this month?",
  "What's the 401(k) limit this year, and where am I?",
  "Any patterns I should confirm in my context?"
];

function messageFromSnapshot(snapshot: {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
}): Message {
  const m = snapshot.metadata ?? {};
  return {
    id: snapshot.id,
    role: snapshot.role as "user" | "assistant" | "system",
    content: snapshot.content,
    specialists: (m.specialistsInvoked as string[] | undefined) ?? undefined,
    toolCalls: (m.toolCalls as number | undefined) ?? undefined,
    appliedLessons:
      (m.appliedLessons as AppliedLesson[] | undefined) ?? undefined,
    latencyMs: (m.latencyMs as number | undefined) ?? undefined,
    bullets: (m.bullets as string[] | undefined) ?? undefined,
    caveat: (m.caveat as string | null | undefined) ?? null,
    followUps: (m.followUps as string[] | undefined) ?? undefined,
    isError: (m.error as boolean | undefined) ?? false
  };
}

export function AdvisorChatV2(props: {
  sessionId: string;
  initialMessages: Array<{
    id: string;
    role: string;
    content: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(
    props.initialMessages.map(messageFromSnapshot)
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages.length, isSending, progress]);

  // Sync when navigating between sessions (keeps state in sync with server).
  useEffect(() => {
    setMessages(props.initialMessages.map(messageFromSnapshot));
  }, [props.sessionId, props.initialMessages]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || isSending) return;

    const pendingUserId = `user-pending-${Date.now()}`;
    const userMsg: Message = {
      id: pendingUserId,
      role: "user",
      content: message,
      pending: true
    };

    setMessages((cur) => [...cur, userMsg]);
    setInput("");
    setIsSending(true);
    setError(null);

    // Simulated progress messaging during the long-running call so the
    // user sees motion rather than a frozen spinner.
    const progressSteps = [
      "Routing to the right specialist…",
      "Gathering tools and context…",
      "Synthesizing the answer…"
    ];
    let step = 0;
    setProgress(progressSteps[0]);
    const progressInterval = setInterval(() => {
      step += 1;
      if (step < progressSteps.length) setProgress(progressSteps[step]);
    }, 3500);

    try {
      const res = await fetch(
        `/api/chat/sessions/${props.sessionId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message })
        }
      );
      const payload = (await res.json()) as {
        user?: {
          id: string;
          role: string;
          content: string;
          metadata: Record<string, unknown> | null;
        };
        assistant?: {
          id: string;
          role: string;
          content: string;
          metadata: Record<string, unknown> | null;
        };
        error?: string;
      };
      if (!res.ok || !payload.assistant) {
        throw new Error(payload.error ?? "Advisor failed to respond.");
      }

      // Replace the optimistic user message + append the real assistant message
      setMessages((cur) => {
        const withoutPending = cur.filter((m) => m.id !== pendingUserId);
        const realUser = payload.user
          ? messageFromSnapshot(payload.user)
          : { ...userMsg, pending: false };
        const realAssistant = messageFromSnapshot(payload.assistant!);
        return [...withoutPending, realUser, realAssistant];
      });

      // Kick the router to refresh the sidebar (title update, updatedAt bump).
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Advisor failed.");
      // Leave the optimistic user message in place with pending=false so
      // the user sees what they typed.
      setMessages((cur) =>
        cur.map((m) => (m.id === pendingUserId ? { ...m, pending: false } : m))
      );
    } finally {
      clearInterval(progressInterval);
      setProgress(null);
      setIsSending(false);
    }
  }

  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const chips =
    lastAssistant?.followUps && lastAssistant.followUps.length > 0
      ? lastAssistant.followUps
      : DEFAULT_PROMPTS;

  return (
    <div className="advisorChatV2">
      <NudgesWidget
        onActOnNudge={(suggestion) => {
          setInput(suggestion);
        }}
      />
      <div className="advisorChatTranscriptV2" ref={transcriptRef}>
        {messages.length === 0 ? (
          <IntroMessage />
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
        {isSending ? <ProgressRow text={progress ?? "Thinking…"} /> : null}
      </div>

      <div className="promptRail">
        {chips.slice(0, 4).map((prompt) => (
          <button
            type="button"
            key={prompt}
            className="promptChip"
            onClick={() => void send(prompt)}
            disabled={isSending}
          >
            {prompt}
          </button>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="composerInput"
          placeholder="Ask anything about your money."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={isSending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="composerActions">
          {error ? <p className="errorLine">{error}</p> : <span />}
          <button
            type="submit"
            className="primaryButton"
            disabled={isSending || input.trim().length === 0}
          >
            {isSending ? "Thinking…" : "Ask advisor"}
          </button>
        </div>
      </form>
    </div>
  );
}

function IntroMessage() {
  return (
    <article className="bubble bubbleAssistant">
      <p className="bubbleRole">Advisor</p>
      <p className="bubbleContent">
        Ask anything about your money. I&apos;ll route to the right
        specialist, use your transactions and personal context, and note
        which patterns from your memory shaped the answer.
      </p>
    </article>
  );
}

function ProgressRow({ text }: { text: string }) {
  return (
    <article className="bubble bubbleAssistant bubbleProgress">
      <p className="bubbleRole">Advisor</p>
      <p className="bubbleContent bubbleProgressText">
        <span className="bubbleProgressDots">
          <span />
          <span />
          <span />
        </span>
        {text}
      </p>
    </article>
  );
}

function MessageBubble({ m }: { m: Message }) {
  return (
    <article
      className={
        m.role === "assistant"
          ? "bubble bubbleAssistant" + (m.isError ? " bubbleError" : "")
          : "bubble bubbleUser" + (m.pending ? " bubblePending" : "")
      }
    >
      <p className="bubbleRole">{m.role === "assistant" ? "Advisor" : "You"}</p>
      <p className="bubbleContent">{m.content}</p>
      {m.bullets && m.bullets.length > 0 ? (
        <ul className="bubbleBullets">
          {m.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      {m.caveat ? <p className="bubbleCaveat">Watch-out: {m.caveat}</p> : null}
      {m.role === "assistant" &&
      ((m.specialists?.length ?? 0) > 0 ||
        (m.appliedLessons?.length ?? 0) > 0) ? (
        <BubbleMeta m={m} />
      ) : null}
    </article>
  );
}

function BubbleMeta({ m }: { m: Message }) {
  const [showLessons, setShowLessons] = useState(false);
  return (
    <div className="bubbleMeta">
      {m.specialists?.map((s) => (
        <span key={s} className={`specialistChip chip-${s}`}>
          {s}
        </span>
      ))}
      {typeof m.toolCalls === "number" && m.toolCalls > 0 ? (
        <span className="metaNote">
          {m.toolCalls} tool{m.toolCalls === 1 ? "" : "s"}
        </span>
      ) : null}
      {m.appliedLessons && m.appliedLessons.length > 0 ? (
        <button
          type="button"
          className="lessonsAppliedBadge"
          onClick={() => setShowLessons((v) => !v)}
          aria-expanded={showLessons}
        >
          {m.appliedLessons.length} lesson
          {m.appliedLessons.length === 1 ? "" : "s"} applied
        </button>
      ) : null}
      {typeof m.latencyMs === "number" ? (
        <span className="metaNote metaNoteDim">
          {Math.round(m.latencyMs / 100) / 10}s
        </span>
      ) : null}
      {showLessons && m.appliedLessons ? (
        <div className="lessonsAppliedList">
          {m.appliedLessons.map((l) => (
            <div key={l.id} className="lessonsAppliedItem">
              <span className="lessonTopicChip">{l.topic}</span>{" "}
              <span>{l.actionOrCaveat}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
