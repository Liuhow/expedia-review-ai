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
  getPipelineIssuesForLLM,
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

  // Pipeline keyword matching failed — use LLM for smart context-aware follow-up
  const client = getClient();
  if (client && draftReview.length > 0) {
    try {
      const dimensionLabels = getDimensionLabels(id);
      const answeredSet = new Set(answeredTopics.map((t: string) => t.toLowerCase()));

      // Filter out dimensions whose coarse topic is already answered
      const availableDimensions = dimensionLabels.filter((label) => {
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

      // Get pipeline issues for context (priority + evidence)
      const pipelineContext = getPipelineIssuesForLLM(id);
      const issuesSummary = pipelineContext.issues
        .filter((i) => !answeredSet.has(i.coarseTopic))
        .slice(0, 5)
        .map((i) => `- ${i.coarseTopic} (${i.dimension}): priority ${i.priority}, type: ${i.issueType}, evidence: "${i.evidence}"`)
        .join("\n");

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a smart hotel review assistant. Analyze the user's review draft and decide the best follow-up.

You have TWO strategies:
1. **User-centric**: If the user's LAST sentence mentions a specific topic (e.g. "shuttle", "breakfast", "noisy neighbors"), ask a relevant follow-up question about THAT topic. The question should dig deeper into what the user is writing about.
2. **Pipeline-driven**: If the user's last sentence is generic or wraps up a thought (e.g. "Overall it was nice.", "We had a good time."), suggest the highest-priority information gap from the pipeline issues list.

Return JSON with these fields:
- "strategy": "user_centric" or "pipeline_driven"
- "dimension": the matched dimension name from the available list (EXACTLY as listed), or "general" if none fit
- "question": a natural, specific follow-up question (max 15 words). For user-centric, ask about what THEY mentioned. For pipeline-driven, introduce the gap topic naturally.
- "rationale": one short sentence explaining why this question helps (max 15 words)
- "chips": array of 6 short (1-3 word) quick-reply options that DIRECTLY answer the question. These must be specific to the question, NOT generic.

Rules:
- Semantic matching: "breakfast" → "restaurant", "shuttle" → "location", "noisy" → "noise level", "hot room" → "air conditioning"
- If the review already covers a dimension, skip it
- Keep questions conversational and easy to answer
- Chips MUST be relevant answers to YOUR question. E.g. if question is "What was the issue with breakfast?" → chips like "Limited options", "Not fresh", "Long wait", "Cold food", "Crowded", "Overpriced". If question is "How was the shuttle service?" → "On time", "Frequent", "Long wait", "Unreliable", "Comfortable", "Hard to find"
- If user sentiment is negative, chips should be mostly negative issues. If positive, chips should be positive aspects.
- Return ONLY valid JSON, nothing else`,
          },
          {
            role: "user",
            content: `Review draft: "${draftReview}"

Available dimensions (with info gaps): ${availableDimensions.join(", ")}

Pipeline priority issues:
${issuesSummary || "No priority issues available."}

Generate the best follow-up.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 150,
      });

      const raw = response.choices[0]?.message?.content?.trim() || "";
      let llmResult: { strategy?: string; dimension?: string; question?: string; rationale?: string; chips?: string[] } = {};
      try {
        const jsonStr = raw.replace(/^```json?\s*/, "").replace(/\s*```$/, "");
        llmResult = JSON.parse(jsonStr);
      } catch {
        llmResult = { dimension: raw.toLowerCase(), strategy: "pipeline_driven" };
      }

      const detected = (llmResult.dimension || "general").toLowerCase();
      const llmChips = Array.isArray(llmResult.chips) && llmResult.chips.length > 0 ? llmResult.chips : null;

      // Helper: apply LLM overrides (question, rationale, chips) to a follow-up result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const applyLLMOverrides = (fu: any) => {
        if (llmResult.question) fu.question = llmResult.question;
        if (llmResult.rationale) fu.rationale = llmResult.rationale;
        if (llmChips) {
          fu.quickReplies = llmChips;
          // Determine negative chips: if user sentiment is negative, all chips are negative
          const sentimentNeg = draftReview.toLowerCase().match(/terrible|bad|awful|dirty|noisy|rude|slow|uncomfortable|disappointing|worst|horrible|poor|broken|disgusting|issue|problem/);
          fu.negativeChips = sentimentNeg ? llmChips : [];
        }
      };

      if (detected !== "general") {
        // Try dimension-level match first
        const followUp = buildFollowUpForDimension(id, detected, draftReview, rating);
        if (followUp && !answeredSet.has(followUp.topic.toLowerCase())) {
          applyLLMOverrides(followUp);
          return NextResponse.json(followUp);
        }

        // Fallback: try as coarse topic
        const coarseTopics = getCoarseTopics(id);
        if (coarseTopics.includes(detected) && !answeredSet.has(detected)) {
          const topicFollowUp = buildFollowUpForTopic(id, detected, draftReview, rating);
          if (topicFollowUp) {
            applyLLMOverrides(topicFollowUp);
            return NextResponse.json(topicFollowUp);
          }
        }
      }

      // LLM said "general" or no pipeline match
      const general = getGeneralFollowUp(draftReview, rating);
      if (general) {
        if (detected === "general") applyLLMOverrides(general);
        return NextResponse.json(general);
      }
    } catch {
      // LLM failed — try general fallback
      const general = getGeneralFollowUp(draftReview, rating);
      if (general) return NextResponse.json(general);
    }
  }

  return NextResponse.json({ topic: null });
}
