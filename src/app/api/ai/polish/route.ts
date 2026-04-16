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
          content: `You turn a short follow-up answer into ONE natural review sentence. Rules:
- Output exactly ONE sentence, no more
- Write in first person as a hotel guest
- Keep it natural and concise (under 20 words)
- Do not add information the user didn't provide
- Do not use overly formal language
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
  const lower = answer.toLowerCase();
  // If the answer is already a sentence, use it directly
  if (answer.length > 30) return answer;
  // Simple templates
  return `The ${topic} was ${lower}.`;
}
