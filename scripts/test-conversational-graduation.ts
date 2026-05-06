#!/usr/bin/env -S npx tsx
/**
 * One-off: test that an agent specialist will call graduate_candidate_lesson
 * when the user explicitly confirms a pattern.
 *
 * This is NOT a regression test (LLM behavior is variable); it's a useful
 * smoke during Phase 5c development.
 */

async function main() {
  const baseUrl = "http://localhost:3001";

  // Ensure there's a pending candidate to graduate.
  await fetch(`${baseUrl}/api/lessons/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lookbackDays: 30, maxRuns: 30 })
  });

  // Fetch current pending candidates.
  const before = await (await fetch(`${baseUrl}/api/lessons`)).json();
  const pendingBefore = before.candidates.length;
  console.log(`Pending candidates before: ${pendingBefore}`);

  // Turn 1: ask what patterns exist.
  const turn1 = await (
    await fetch(`${baseUrl}/api/advisor/chat?mode=agent&debug=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message:
          "Do you have any patterns or lessons you've noticed about me? Tell me what you've seen so far."
      }),
      signal: AbortSignal.timeout(90_000)
    })
  ).json();
  const assistant1 = turn1.answer || "(failed)";
  console.log(`\nTurn 1 assistant: ${assistant1.slice(0, 200)}`);

  // Turn 2: explicit specific confirmation referencing the pattern.
  const turn2 = await (
    await fetch(`${baseUrl}/api/advisor/chat?mode=agent&debug=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message:
          "Yes — please save the pattern about users frequently asking about 401k contribution limits. That one is correct — graduate it now.",
        history: [
          {
            role: "user",
            content: "Do you have any patterns or lessons you've noticed about me? Tell me what you've seen so far."
          },
          { role: "assistant", content: assistant1 }
        ]
      }),
      signal: AbortSignal.timeout(120_000)
    })
  ).json();
  console.log(`\nTurn 2 answer: ${(turn2.answer ?? turn2.error ?? "").slice(0, 200)}`);
  const toolsCalled: string[] = [];
  for (const s of turn2?.debug?.specialists ?? []) {
    for (const step of s?.trace ?? []) {
      if (step.kind === "tool_call") toolsCalled.push(step.toolName);
    }
  }
  console.log(`Tools called this turn: ${toolsCalled.join(", ") || "(none)"}`);

  // Check DB — any new AgentLesson with a graduation rationale that quotes turn 2?
  const after = await (await fetch(`${baseUrl}/api/lessons?agent=1`)).json();
  console.log(
    `\nAgent lessons now: ${(after.agentLessons ?? []).length} (pending ${after.candidates.length})`
  );
  for (const l of after.agentLessons ?? []) {
    console.log(`  - [${l.topic}] ${l.patternSummary.slice(0, 80)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
