import { FollowUpOutput, ReviewTopic } from "@/types/ai";
import { buildFollowUpPrompt } from "@/lib/ai/prompts";
import { getOpenAIClient } from "@/lib/ai/openai";

const DEFAULT_QUICK_REPLIES: Record<ReviewTopic, string[]> = {
  cleanliness: ["Very clean", "Okay", "Not clean", "Didn't notice"],
  service: ["Great", "Okay", "Poor", "No interaction"],
  breakfast: ["Great", "Okay", "Poor", "Didn't try it"],
  pool: ["Open and good", "Okay", "Not good", "Didn't use it"],
  parking: ["Easy", "Okay", "Difficult", "Didn't park"],
  location: ["Very convenient", "Okay", "Not convenient", "N/A"],
  noise: ["Very quiet", "Okay", "Noisy", "N/A"],
  amenities: ["Great", "Okay", "Poor", "Didn't use them"],
  check_in: ["Smooth", "Okay", "Difficult", "N/A"],
  check_out: ["Smooth", "Okay", "Difficult", "N/A"],
  room_condition: ["Great", "Okay", "Poor", "N/A"],
  wifi: ["Reliable", "Okay", "Poor", "Didn't use it"],
  family_friendly: ["Yes", "Somewhat", "No", "N/A"],
  pet_friendly: ["Yes", "Somewhat", "No", "N/A"],
  safety: ["Yes", "Mostly", "No", "N/A"],
};

const DEFAULT_QUESTIONS: Record<ReviewTopic, string> = {
  cleanliness: "How clean did the property feel during your stay?",
  service: "How was the staff service during your stay?",
  breakfast: "Did you try the breakfast during your stay?",
  pool: "Was the pool open and in good condition?",
  parking: "How convenient was parking at this property?",
  location: "How convenient was the location for your trip?",
  noise: "How quiet was your room during the stay?",
  amenities: "Did you use any amenities during your stay?",
  check_in: "How smooth was check-in at the property?",
  check_out: "How smooth was check-out at the property?",
  room_condition: "How was the room condition during your stay?",
  wifi: "How reliable was the Wi-Fi during your stay?",
  family_friendly: "Did the property feel family-friendly?",
  pet_friendly: "Did the property feel pet-friendly?",
  safety: "Did you feel safe at the property?",
};

export async function generateFollowUpQuestion(params: {
  selectedTopic: ReviewTopic;
  reason: string;
  currentReviewText: string;
}): Promise<FollowUpOutput> {
  const { selectedTopic, reason, currentReviewText } = params;

  const client = getOpenAIClient();
  const prompt = buildFollowUpPrompt({
    selectedTopic,
    reason,
    currentReviewText,
  });

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const raw = response.output_text?.trim() ?? "";
    const parsed = JSON.parse(raw) as FollowUpOutput;

    return {
      question: parsed.question || DEFAULT_QUESTIONS[selectedTopic],
      quick_replies:
        Array.isArray(parsed.quick_replies) && parsed.quick_replies.length > 0
          ? parsed.quick_replies
          : DEFAULT_QUICK_REPLIES[selectedTopic],
    };
  } catch {
    return {
      question: DEFAULT_QUESTIONS[selectedTopic],
      quick_replies: DEFAULT_QUICK_REPLIES[selectedTopic],
    };
  }
}
