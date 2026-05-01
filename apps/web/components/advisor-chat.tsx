"use client";

import { useState } from "react";

type AdvisorChatReply = {
  answer: string;
  bullets: string[];
  caveat: string | null;
  followUps: string[];
  provider: string;
};

type AdvisorChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  bullets?: string[];
  caveat?: string | null;
  followUps?: string[];
};

type AdvisorChatProps = {
  suggestedPrompts: string[];
};

function createInitialAssistantMessage(): AdvisorChatMessage {
  return {
    id: "assistant-initial",
    role: "assistant",
    content:
      "Ask about retirement pacing, paycheck allocation, brokerage flows, or what still needs review. I answer from your linked cash flow, imported Fidelity activity, and saved advisor profile."
  };
}

export function AdvisorChat({ suggestedPrompts }: AdvisorChatProps) {
  const [messages, setMessages] = useState<AdvisorChatMessage[]>([
    createInitialAssistantMessage()
  ]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || isSending) {
      return;
    }

    const userMessage: AdvisorChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message
    };

    const history = messages
      .slice(-6)
      .map((entry) => ({
        role: entry.role,
        content: entry.content
      }));

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/advisor/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          history
        })
      });

      const payload = (await response.json()) as AdvisorChatReply & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reach the advisor chat.");
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.answer,
          bullets: payload.bullets,
          caveat: payload.caveat,
          followUps: payload.followUps
        }
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to reach the advisor chat."
      );
    } finally {
      setIsSending(false);
    }
  }

  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const followUpPrompts =
    latestAssistantMessage?.followUps?.length
      ? latestAssistantMessage.followUps
      : suggestedPrompts;

  return (
    <section className="advisorChat">
      <div className="advisorChatHeader">
        <div>
          <p className="eyebrow">Advisor</p>
          <h3>Chat with the plan</h3>
        </div>
        <p className="panelCopy">
          Lightweight Q&A on top of your actual cash flow and Fidelity imports.
        </p>
      </div>

      <div className="advisorChatTranscript">
        {messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "assistant"
                ? "advisorBubble advisorBubbleAssistant"
                : "advisorBubble advisorBubbleUser"
            }
          >
            <p className="advisorBubbleRole">
              {message.role === "assistant" ? "Advisor" : "You"}
            </p>
            <p className="advisorBubbleCopy">{message.content}</p>
            {message.bullets && message.bullets.length > 0 ? (
              <ul className="list tightList advisorBubbleList">
                {message.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            {message.caveat ? (
              <p className="advisorBubbleMeta">Watch-out: {message.caveat}</p>
            ) : null}
          </article>
        ))}
      </div>

      <div className="advisorPromptRail">
        {followUpPrompts.slice(0, 4).map((prompt) => (
          <button
            key={prompt}
            className="promptChip"
            disabled={isSending}
            onClick={() => void sendMessage(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>

      <form
        className="advisorChatComposer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage(input);
        }}
      >
        <textarea
          className="advisorChatInput"
          disabled={isSending}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about retirement pacing, the next paycheck, brokerage deposits, or what to review."
          rows={3}
          value={input}
        />
        <div className="advisorChatActions">
          {error ? <p className="errorLine">{error}</p> : null}
          <button
            className="primaryButton"
            disabled={isSending || input.trim().length === 0}
            type="submit"
          >
            {isSending ? "Thinking..." : "Ask advisor"}
          </button>
        </div>
      </form>
    </section>
  );
}
