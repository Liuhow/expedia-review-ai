import { NextResponse } from "next/server";
import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getHotelById } from "@/lib/data-store";
import {
  buildFollowUpFromPipeline,
  getInitialFollowUps,
  getCoarseTopics,
  getDimensionLabels,
  buildFollowUpForTopic,
  buildFollowUpForDimension,
  getGeneralFollowUp,
} from "@/lib/pipeline-followup";

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (proxy) opts.httpAgent = new HttpsProxyAgent(proxy);
  return new OpenAI(opts);
}

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

  // ── Mode: draft — try instant pipeline matching first, then LLM ──
  const pipelineResult = buildFollowUpFromPipeline(id, draftReview, undefined, rating, answeredTopics);
  if (pipelineResult) {
    return NextResponse.json(pipelineResult);
  }

  // Pipeline keyword matching failed — use LLM for smart dimension matching
  const client = getClient();
  if (client && draftReview.length > 0) {
    try {
      const dimensionLabels = getDimensionLabels(id);
      const answeredSet = new Set(answeredTopics.map((t: string) => t.toLowerCase()));

      // Filter out dimensions whose coarse topic is already answered
      const availableDimensions = dimensionLabels.filter((label) => {
        // Check if any answered topic covers this dimension
        return !answeredTopics.some((at) => {
          const atLower = at.toLowerCase();
          return atLower === label || label.includes(atLower) || atLower.includes(label);
        });
      });

      if (availableDimensions.length === 0) {
        const general = getGeneralFollowUp(draftReview, rating);
        if (general) return NextResponse.json(general);
        return NextResponse.json({ topic: null });
      }

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You analyze hotel review drafts and pick the best follow-up dimension to ask about.

Given the review text and a list of hotel dimensions with information gaps, do TWO things:
1. Check if the LAST sentence/phrase relates to any dimension (semantic match — e.g. "breakfast" → "restaurant", "noisy" → "noise level", "hot room" → "air conditioning and heating")
2. If yes, return that dimension. If not, pick the most valuable dimension NOT YET covered by the review.

Rules:
- If the review already discusses a dimension (even indirectly), skip it. E.g. if review mentions "food was great", then "restaurant" is already covered.
- Return the dimension name EXACTLY as listed.
- If all dimensions are covered, return "general".
- Return ONLY the dimension name, nothing else.`,
          },
          {
            role: "user",
            content: `Review draft: "${draftReview}"\n\nAvailable dimensions (with information gaps): ${availableDimensions.join(", ")}\n\nWhich dimension should the follow-up question be about?`,
          },
        ],
        temperature: 0,
        max_tokens: 30,
      });

      const detected = response.choices[0]?.message?.content?.trim().toLowerCase() || "general";

      if (detected !== "general") {
        // Try dimension-level match first (most precise)
        const followUp = buildFollowUpForDimension(id, detected, draftReview, rating);
        if (followUp && !answeredSet.has(followUp.topic.toLowerCase())) {
          return NextResponse.json(followUp);
        }

        // Fallback: try as coarse topic
        const coarseTopics = getCoarseTopics(id);
        if (coarseTopics.includes(detected) && !answeredSet.has(detected)) {
          const topicFollowUp = buildFollowUpForTopic(id, detected, draftReview, rating);
          if (topicFollowUp) return NextResponse.json(topicFollowUp);
        }
      }

      // LLM said "general" or no pipeline match — return general question
      const general = getGeneralFollowUp(draftReview, rating);
      if (general) return NextResponse.json(general);
    } catch {
      // LLM failed — try general fallback
      const general = getGeneralFollowUp(draftReview, rating);
      if (general) return NextResponse.json(general);
    }
  }

  return NextResponse.json({ topic: null });
}
