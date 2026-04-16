import { StructuredInsightOutput, ReviewTopic } from "@/types/ai";
import { buildInsightPrompt } from "@/lib/ai/prompts";
import { getOpenAIClient } from "@/lib/ai/openai";

export async function extractStructuredInsight(params: {
  topic: ReviewTopic;
  answer: string;
}): Promise<StructuredInsightOutput> {
  const { topic, answer } = params;

  const client = getOpenAIClient();
  const prompt = buildInsightPrompt({ topic, answer });

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const raw = response.output_text?.trim() ?? "";
    const parsed = JSON.parse(raw) as StructuredInsightOutput;

    return {
      sentiment: parsed.sentiment || "neutral",
      insight: parsed.insight || answer.slice(0, 50),
    };
  } catch {
    return {
      sentiment: "neutral",
      insight: answer.slice(0, 50),
    };
  }
}
