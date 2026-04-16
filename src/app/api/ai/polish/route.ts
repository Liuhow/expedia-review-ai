import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (proxy) opts.httpAgent = new HttpsProxyAgent(proxy);
  return new OpenAI(opts);
}

/**
 * POST /api/ai/polish
 * Takes a follow-up answer + topic and returns a polished sentence to append to the review.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, answer, question } = body as {
      topic: string;
      answer: string;
      question: string;
    };

    if (!topic || !answer) {
      return NextResponse.json({ error: "Missing topic or answer" }, { status: 400 });
    }

    const client = getClient();

    if (!client) {
      // Fallback: simple template
      const sentence = buildFallbackSentence(topic, answer);
      return NextResponse.json({ sentence });
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You polish a hotel guest's follow-up answer into ONE clean review sentence. Rules:
- Output exactly ONE sentence, no more
- Write in first person as a hotel guest
- ONLY fix grammar, spelling, and awkward phrasing — do NOT add new details or expand
- Keep the sentence SHORT: maximum 20 words. If the input is long, condense it
- Do not add information the user didn't provide
- Do not use overly formal or flowery language
- Return ONLY the sentence, no quotes, no JSON`,
        },
        {
          role: "user",
          content: `Topic: ${topic}\nQuestion: ${question}\nGuest's answer: ${answer}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 60,
    });

    const sentence = response.choices[0]?.message?.content?.trim() || buildFallbackSentence(topic, answer);

    return NextResponse.json({ sentence });
  } catch {
    return NextResponse.json(
      { error: "Failed to polish answer." },
      { status: 500 },
    );
  }
}

function buildFallbackSentence(topic: string, answer: string): string {
  const lower = answer.toLowerCase().trim();
  // If the answer is already a decent sentence, just clean it up
  if (lower.length > 40) {
    // Truncate to roughly 20 words
    const words = lower.split(/\s+/);
    if (words.length > 20) {
      return words.slice(0, 18).join(" ") + ".";
    }
    return answer.endsWith(".") ? answer : answer + ".";
  }
  // Simple templates
  return `The ${topic} was ${lower}.`;
}
