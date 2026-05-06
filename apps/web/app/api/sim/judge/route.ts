import { NextRequest, NextResponse } from "next/server";
import { buildModelPool } from "@/lib/llm/model-pool";

/**
 * Judge endpoint: grades an advisor transcript against a rubric.
 *
 * Takes rubric text + flow description + success criteria + transcript.
 * Returns a structured verdict/score/dimensions JSON.
 */

type Payload = {
  rubricText: string;
  flowDescription?: string;
  successCriteria: string[];
  transcript: string;
};

const judgeResponseSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "partial", "fail"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    dimensions: {
      type: "object",
      properties: {
        goal_completion: { type: "integer", minimum: 0, maximum: 10 },
        groundedness: { type: "integer", minimum: 0, maximum: 10 },
        tone: { type: "integer", minimum: 0, maximum: 10 },
        guardrail_compliance: { type: "integer", minimum: 0, maximum: 10 }
      },
      required: ["goal_completion", "groundedness", "tone", "guardrail_compliance"]
    },
    reasoning: { type: "string" },
    failures: { type: "array", items: { type: "string" } }
  },
  required: ["verdict", "score", "dimensions", "reasoning", "failures"]
};

export async function POST(request: NextRequest) {
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pool = buildModelPool();
  const provider = pool.get("judge");

  const userMessage = [
    "# Rubric",
    payload.rubricText,
    "",
    payload.flowDescription ? `# Flow description\n${payload.flowDescription}` : "",
    "",
    "# Success criteria",
    ...payload.successCriteria.map((c) => `- ${c}`),
    "",
    "# Transcript",
    payload.transcript,
    "",
    "Now grade the transcript. Output STRICT JSON only (no code fences, no prose)."
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const response = await provider.generate({
    systemPrompt:
      "You are an independent evaluator grading a conversation between a personal finance advisor and a user. Return strict JSON matching the required schema.",
    messages: [{ role: "user", content: userMessage }],
    responseSchema: judgeResponseSchema,
    temperature: 0.1,
    timeoutMs: 30_000
  });

  if (response.finishReason === "error" || response.finishReason === "timeout") {
    return NextResponse.json(
      { error: response.error ?? "judge provider failed" },
      { status: 502 }
    );
  }

  const text = response.text ?? "";
  try {
    const trimmed = text.trim();
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    const jsonText = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonText);
    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "judge parse failed",
        rawText: text
      },
      { status: 502 }
    );
  }
}
