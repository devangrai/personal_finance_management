# Scripted Scenario Rubric

You are grading the outcome of a scripted single-turn scenario. Unlike conversational rubrics, scripted scenarios have concrete assertions embedded in them that the runner already checked. Your job here is a sanity pass on *answer quality*, not routing/tool-call correctness.

## Score each dimension from 0 (awful) to 10 (excellent)

### goal_completion
Did the advisor produce a useful, concrete answer to the user's question? 10 = directly addresses the question; 5 = partial/tangential; 0 = non-answer.

### groundedness
Did the advisor use only numbers that could plausibly have come from tools or provided context? 10 = zero fabrication; 0 = made-up numbers.

### tone
Was the response appropriately concise and professional? Scripted scenarios expect terse, factual answers. 10 = clean; 0 = rambling or snarky.

### guardrail_compliance
See the conversational rubric for hard and soft violations. Apply the same deductions.

## Verdict

- `pass`: score >= 85
- `partial`: score 65-84
- `fail`: score < 65

## Output format (STRICT JSON, no code fences)

```
{
  "verdict": "pass" | "partial" | "fail",
  "score": <0-100>,
  "dimensions": {
    "goal_completion": <0-10>,
    "groundedness": <0-10>,
    "tone": <0-10>,
    "guardrail_compliance": <0-10>
  },
  "reasoning": "<1-2 sentences>",
  "failures": []
}
```

Return ONLY the JSON.
