import { NextRequest, NextResponse } from "next/server";
import { extractStructuredInsight } from "@/lib/ai/insight";
import { ReviewTopic } from "@/types/ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const topic = body.topic as ReviewTopic;
    const answer = body.answer as string;

    if (!topic || typeof answer !== "string" || !answer.trim()) {
      return NextResponse.json(
        { error: "Invalid request payload." },
        { status: 400 }
      );
    }

    const result = await extractStructuredInsight({
      topic,
      answer,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to extract insight." },
      { status: 500 }
    );
  }
}
