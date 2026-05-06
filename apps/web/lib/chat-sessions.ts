import { Prisma, prisma } from "@portfolio/db";
import { getOrCreateDefaultUser } from "./user";

// ---------------------------------------------------------------------------
// Snapshot types the UI consumes
// ---------------------------------------------------------------------------

export type ChatSessionSnapshot = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
};

export type ChatMessageSnapshot = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Truncate a first user message into a session title. 40-char cap feels
 * right in a 260px sidebar; ellipsize if longer. Collapse newlines so
 * a multi-line question renders on one line.
 */
export function deriveTitleFromMessage(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return "New chat";
  if (flat.length <= 40) return flat;
  return flat.slice(0, 40) + "…";
}

function titleOrDefault(title: string | null): string {
  return title && title.trim().length > 0 ? title : "New chat";
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function createChatSession(options?: {
  title?: string;
}): Promise<ChatSessionSnapshot> {
  const user = await getOrCreateDefaultUser();
  const session = await prisma.chatSession.create({
    data: {
      userId: user.id,
      title: options?.title ?? null
    }
  });
  return {
    id: session.id,
    title: titleOrDefault(session.title),
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    archivedAt: session.archivedAt?.toISOString() ?? null,
    messageCount: 0,
    lastMessagePreview: null
  };
}

export async function listChatSessions(options?: {
  includeArchived?: boolean;
  limit?: number;
}): Promise<ChatSessionSnapshot[]> {
  const user = await getOrCreateDefaultUser();
  const where: Prisma.ChatSessionWhereInput = {
    userId: user.id,
    ...(options?.includeArchived ? {} : { archivedAt: null })
  };
  const rows = await prisma.chatSession.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: options?.limit ?? 100,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, role: true }
      },
      _count: {
        select: { messages: true }
      }
    }
  });
  return rows.map((r) => ({
    id: r.id,
    title: titleOrDefault(r.title),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    archivedAt: r.archivedAt?.toISOString() ?? null,
    messageCount: r._count.messages,
    lastMessagePreview:
      r.messages[0]?.content.slice(0, 120) ?? null
  }));
}

/**
 * Fetch a session + its messages. Returns null if the session doesn't
 * belong to the caller or doesn't exist (don't leak existence).
 */
export async function getChatSessionWithMessages(
  sessionId: string
): Promise<
  | {
      session: ChatSessionSnapshot;
      messages: ChatMessageSnapshot[];
    }
  | null
> {
  const user = await getOrCreateDefaultUser();
  const row = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } }
    }
  });
  if (!row) return null;
  return {
    session: {
      id: row.id,
      title: titleOrDefault(row.title),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      messageCount: row.messages.length,
      lastMessagePreview:
        row.messages[row.messages.length - 1]?.content.slice(0, 120) ?? null
    },
    messages: row.messages.map((m) => ({
      id: m.id,
      sessionId: m.sessionId,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      metadata:
        m.metadata && typeof m.metadata === "object"
          ? (m.metadata as Record<string, unknown>)
          : null,
      createdAt: m.createdAt.toISOString()
    }))
  };
}

export async function getMostRecentSessionId(): Promise<string | null> {
  const user = await getOrCreateDefaultUser();
  const row = await prisma.chatSession.findFirst({
    where: { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Message append
// ---------------------------------------------------------------------------

export async function appendUserMessage(
  sessionId: string,
  content: string
): Promise<ChatMessageSnapshot> {
  const user = await getOrCreateDefaultUser();
  const clean = content.trim();
  if (!clean) throw new Error("Empty message");

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true, title: true }
  });
  if (!session) throw new Error("Session not found");

  // On the FIRST user message, set the title.
  const shouldSetTitle = !session.title || session.title.trim().length === 0;

  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: { sessionId, role: "user", content: clean }
    }),
    prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        updatedAt: new Date(),
        ...(shouldSetTitle ? { title: deriveTitleFromMessage(clean) } : {})
      }
    })
  ]);

  return {
    id: message.id,
    sessionId: message.sessionId,
    role: "user",
    content: message.content,
    metadata: null,
    createdAt: message.createdAt.toISOString()
  };
}

export async function appendAssistantMessage(
  sessionId: string,
  content: string,
  options?: {
    metadata?: Record<string, unknown>;
    recommendationRunId?: string;
  }
): Promise<ChatMessageSnapshot> {
  const user = await getOrCreateDefaultUser();
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: { id: true }
  });
  if (!session) throw new Error("Session not found");

  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content,
        metadata: options?.metadata
          ? (options.metadata as Prisma.InputJsonValue)
          : undefined,
        recommendationRunId: options?.recommendationRunId
      }
    }),
    prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() }
    })
  ]);

  return {
    id: message.id,
    sessionId: message.sessionId,
    role: "assistant",
    content: message.content,
    metadata: options?.metadata ?? null,
    createdAt: message.createdAt.toISOString()
  };
}

/**
 * Pull the last N messages for use as advisor history. Returns them in
 * oldest-first order (what the agent expects). Caps at 8 entries by
 * default to stay within context budget.
 */
export async function getSessionHistoryForAdvisor(
  sessionId: string,
  limit = 8
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const user = await getOrCreateDefaultUser();
  const rows = await prisma.chatMessage.findMany({
    where: {
      sessionId,
      session: { userId: user.id },
      role: { in: ["user", "assistant"] }
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true }
  });
  // Reverse for chronological order.
  return rows.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content
  }));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function renameChatSession(
  sessionId: string,
  title: string
): Promise<void> {
  const user = await getOrCreateDefaultUser();
  const clean = title.trim().slice(0, 120);
  await prisma.chatSession.updateMany({
    where: { id: sessionId, userId: user.id },
    data: { title: clean || null }
  });
}

export async function archiveChatSession(sessionId: string): Promise<void> {
  const user = await getOrCreateDefaultUser();
  await prisma.chatSession.updateMany({
    where: { id: sessionId, userId: user.id },
    data: { archivedAt: new Date() }
  });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const user = await getOrCreateDefaultUser();
  await prisma.chatSession.deleteMany({
    where: { id: sessionId, userId: user.id }
  });
}
