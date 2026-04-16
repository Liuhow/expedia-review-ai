import { GapCandidate, PropertyContext, ReviewTopic } from "@/types/ai";

export function buildGapDetectionPrompt(params: {
  property: PropertyContext;
  currentReviewText: string;
  coveredTopics: ReviewTopic[];
  candidates: GapCandidate[];
}) {
  const { property, currentReviewText, coveredTopics, candidates } = params;

  return `
You are an AI assistant helping improve hotel review quality.

Your task is to identify the single most important information gap for a specific hotel.

You are given:
1. Property context
2. Candidate topic gaps derived from structured review coverage signals
3. The user's current review draft
4. Topics already covered in the current draft

Goal:
Select ONE topic that:
- is NOT already covered in the user's draft
- is under-covered or stale in recent reviews
- would be valuable for future guests

Rules:
- Do not pick a topic already covered in the current review
- Prefer missing or stale topics over already well-covered topics
- Return valid JSON only
- Be concise

Property context:
${JSON.stringify(property, null, 2)}

Current review draft:
${currentReviewText}

Covered topics in current draft:
${JSON.stringify(coveredTopics)}

Candidate topic gaps:
${JSON.stringify(candidates, null, 2)}

Return ONLY JSON:
{
  "selected_topic": "breakfast",
  "reason": "Breakfast has low recent coverage and is not covered in the user's review.",
  "confidence": 0.86
}
`;
}

export function buildFollowUpPrompt(params: {
  selectedTopic: ReviewTopic;
  reason: string;
  currentReviewText: string;
}) {
  const { selectedTopic, reason, currentReviewText } = params;

  return `
You are generating one short follow-up question for a hotel review flow.

Context:
- Selected topic: ${selectedTopic}
- Reason: ${reason}
- User's current review: ${currentReviewText}

Goal:
Generate ONE short, natural question that:
- is easy to answer
- does not repeat what the user already wrote
- feels helpful, not like a survey
- can be answered by quick reply, text, or voice

Rules:
- Maximum 15 words
- Ask exactly one question
- Return valid JSON only
- Also return 4 concise quick replies suitable for the topic

Return ONLY JSON:
{
  "question": "Did you try the breakfast during your stay?",
  "quick_replies": ["Great", "Okay", "Poor", "Didn't try it"]
}
`;
}

export function buildInsightPrompt(params: {
  topic: ReviewTopic;
  answer: string;
}) {
  const { topic, answer } = params;

  return `
You are extracting structured insight from a short hotel review follow-up answer.

Input:
- Topic: ${topic}
- User answer: ${answer}

Task:
Extract:
- sentiment: one of positive, neutral, negative, mixed
- insight: a short phrase no longer than 10 words

Rules:
- Return valid JSON only
- No explanation text

Return ONLY JSON:
{
  "sentiment": "mixed",
  "insight": "Good quality but limited options"
}
`;
}
