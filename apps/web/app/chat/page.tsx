import { redirect } from "next/navigation";
import {
  createChatSession,
  getMostRecentSessionId
} from "@/lib/chat-sessions";

export const metadata = { title: "Chat · PFM" };
export const dynamic = "force-dynamic";

/**
 * /chat behavior:
 *   - If the user has any session, redirect to the most recent one.
 *   - Otherwise create a blank session and redirect to it.
 * This mirrors ChatGPT's "new chat on visit" pattern when empty, and
 * "pick up where you left off" otherwise.
 */
export default async function ChatLandingPage() {
  const recent = await getMostRecentSessionId();
  if (recent) {
    redirect(`/chat/${recent}`);
  }
  const session = await createChatSession();
  redirect(`/chat/${session.id}`);
}
