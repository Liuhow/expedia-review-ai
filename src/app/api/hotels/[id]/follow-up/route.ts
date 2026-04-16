import { NextResponse } from "next/server";
import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getHotelById } from "@/lib/data-store";
import {
  getInitialFollowUps,
  getFollowUpContext,
  buildKeywordFollowUp,
} from "@/lib/pipeline-followup";

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (proxy) opts.httpAgent = new HttpsProxyAgent(proxy);
  return new OpenAI(opts);
}

/* ═══════════════════════════════════════════════════════════
   SYSTEM PROMPT — single source of truth for follow-up logic
   ═══════════════════════════════════════════════════════════ */

const SYSTEM_PROMPT = `You are a smart hotel review follow-up assistant. Your job is to help hotel guests write more detailed, useful reviews by asking ONE follow-up question at a time.

## Context
- Everything the user writes is about a HOTEL stay. Words like "shuttle", "pool", "breakfast", "parking" all refer to the HOTEL's services.
- You have access to a pipeline database that identifies information gaps and stale/outdated information in this hotel's existing reviews.
- Your goal: help the guest provide details that fill these gaps or verify potentially outdated information.

## Decision Logic

Analyze the user's LAST sentence/phrase in their review draft. Then choose ONE of these strategies:

### Strategy A — User Topic Follow-up (when user mentions a specific topic)
If the last sentence mentions a recognizable hotel topic (e.g., "breakfast", "shuttle", "room", "wifi", "staff", "pool", "noise", "parking", "location"...):
1. Check if this topic relates to any pipeline issue (gap or stale).
2. If YES: ask a follow-up that helps fill that gap or verify stale info. Include a verification option in the chips if there's stale data (e.g., if old reviews said "restaurant under construction", add a chip like "Still under renovation" or "Now open").
3. If NO pipeline issue: still ask a relevant follow-up about their topic to get more details. For example, "breakfast is good" → "What did you enjoy most about breakfast?"

### Strategy B — Pipeline Priority (when user's input is complete/generic)
If the last sentence wraps up a thought, is very generic ("Overall good stay"), or the user wrote a long paragraph covering their topic fully:
1. Pick the highest-priority pipeline issue that hasn't been covered yet.
2. Introduce the topic naturally as a new question.

## Rules
1. You MUST always return a follow-up question. Never return empty or null.
2. The question must be concise (max 15 words), natural, and easy to answer.
3. Generate 6 quick-reply chips that DIRECTLY ANSWER your question:
   - Chips must be specific to YOUR question (not generic hotel aspects).
   - If user sentiment is negative → chips should be issue-related (e.g., "Long wait", "Cold food", "Limited options").
   - If user sentiment is positive → chips should be positive aspects (e.g., "Great variety", "Fresh food", "Friendly staff").
   - If there's stale/outdated info for this topic, include 1-2 verification chips (e.g., "Still an issue", "Now fixed", "Under renovation").
4. Mark which chips are "negative" (issue-related) — these trigger a "What happened?" text input for details.
5. Skip topics the user has already covered in their review or that appear in the answered topics list.
6. For semantic matching: "breakfast" relates to "restaurant/dining", "shuttle" relates to "location/transport", "noisy" relates to "noise level/room", "hot room" relates to "air conditioning".

## Output Format
Return ONLY valid JSON:
{
  "topic": "the coarse topic category (room/service/breakfast/pool/parking/location/wifi/facilities/dining/overall)",
  "question": "Your follow-up question here?",
  "rationale": "Brief reason why this helps (max 12 words)",
  "quickReplies": ["Chip 1", "Chip 2", "Chip 3", "Chip 4", "Chip 5", "Chip 6"],
  "negativeChips": ["Chip 3", "Chip 4"]
}

Note: negativeChips is a subset of quickReplies — only the chips that represent negative/issue aspects.`;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hotel = getHotelById(id);
  if (!hotel) return NextResponse.json({ error: "Hotel not found." }, { status: 404 });

  const body = (await req.json()) as {
    draftReview?: string;
    mode?: "initial" | "draft";
    rating?: number;
    answeredTopics?: string[];
  };

  const mode = body.mode || "draft";
  const draftReview = body.draftReview?.trim() || "";
  const rating = body.rating || 0;
  const answeredTopics = body.answeredTopics || [];

  // ── Mode: initial (empty textarea — return top 3 priority questions) ──
  if (mode === "initial") {
    const followUps = getInitialFollowUps(id, 3, rating);
    return NextResponse.json({ followUps });
  }

  // ── Mode: draft — use LLM for context-aware follow-up, keyword fallback if no API key ──
  const client = getClient();
  if (!client) {
    // No API key — use keyword-based matching (considers user input)
    const result = buildKeywordFollowUp(id, draftReview, rating, answeredTopics);
    return NextResponse.json(result);
  }

  try {
    // Build comprehensive context for LLM
    const context = getFollowUpContext(id, answeredTopics);

    const userMessage = `Hotel: "${hotel.name}"
Rating given: ${rating > 0 ? `${rating}/10` : "not yet rated"}

Review draft:
"${draftReview}"

Already answered topics: ${answeredTopics.length > 0 ? answeredTopics.join(", ") : "none"}

Pipeline issues for this hotel (sorted by priority):
${context.issuesSummary || "No issues detected."}

Available dimensions with info gaps: ${context.availableDimensions.join(", ") || "none"}

Generate the best follow-up question.`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const raw = response.choices[0]?.message?.content?.trim() || "";
    let result;
    try {
      const jsonStr = raw.replace(/^```json?\s*/, "").replace(/\s*```$/, "");
      result = JSON.parse(jsonStr);
    } catch {
      // JSON parse failed — return a safe fallback
      result = null;
    }

    if (result && result.topic && result.question && Array.isArray(result.quickReplies)) {
      return NextResponse.json({
        topic: result.topic,
        question: result.question,
        rationale: result.rationale || "",
        quickReplies: result.quickReplies.slice(0, 6),
        negativeChips: Array.isArray(result.negativeChips) ? result.negativeChips : [],
      });
    }

    // LLM returned something unparseable — use keyword fallback
    return NextResponse.json(buildKeywordFollowUp(id, draftReview, rating, answeredTopics));
  } catch {
    // LLM call failed — use keyword fallback
    return NextResponse.json(buildKeywordFollowUp(id, draftReview, rating, answeredTopics));
  }
}
