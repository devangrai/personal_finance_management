import { notFound } from "next/navigation";
import { AdvisorChatV2 } from "@/components/chat/advisor-chat-v2";
import { ChatSessionsSidebar } from "@/components/chat/chat-sessions-sidebar";
import { PendingCandidatesBanner } from "@/components/chat/pending-candidates-banner";
import { listPendingCandidates } from "@/lib/advisor-lessons";
import {
  getChatSessionWithMessages,
  listChatSessions
} from "@/lib/chat-sessions";

export const metadata = { title: "Chat · PFM" };
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function ChatSessionPage(props: { params: Params }) {
  const { id } = await props.params;

  const [data, sessions, pending] = await Promise.all([
    getChatSessionWithMessages(id),
    listChatSessions({ limit: 100 }),
    listPendingCandidates().catch(() => [])
  ]);

  if (!data) notFound();

  return (
    <div className="chatPageLayout">
      <ChatSessionsSidebar sessions={sessions} activeSessionId={id} />
      <div className="chatPageMain">
        <PendingCandidatesBanner count={pending.length} />
        <AdvisorChatV2
          sessionId={id}
          initialMessages={data.messages}
        />
      </div>
    </div>
  );
}
