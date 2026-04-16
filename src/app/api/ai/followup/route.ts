import { NextRequest, NextResponse } from "next/server";
import { generateFollowUpQuestion } from "@/lib/ai/followup";
import { ReviewTopic } from "@/types/ai";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const selectedTopic = body.selectedTopic as ReviewTopic;
    const reason = body.reason as string;
    const currentReviewText = body.currentReviewText as string;

    if (!selectedTopic || !reason || typeof currentReviewText !== "string") {
      return NextResponse.json(
        { error: "Invalid request payload." },
        { status: 400 }
      );
    }

    const result = await generateFollowUpQuestion({
      selectedTopic,
      reason,
      currentReviewText,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate follow-up question." },
      { status: 500 }
    );
  }
}
