"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { HotelRecord, ReviewRecord, FollowUpResponse } from "@/types";
import { SmartFollowupSidebar } from "./smart-followup-sidebar";
import { Sparkles, CheckCircle2, Mic, MicOff, Loader2, Star } from "lucide-react";

export interface ReviewCompositionSectionProps {
  hotel: HotelRecord;
  existingReviews: ReviewRecord[];
  prefillQuestion?: { question: string; dimension: string } | null;
  onReviewSubmit?: (review: {
    title?: string;
    text: string;
    rating?: number;
    followUpInsights?: Array<{ topic: string; answer: string }>;
  }) => Promise<void>;
}

export function ReviewCompositionSection({
  hotel,
  existingReviews,
  prefillQuestion,
  onReviewSubmit,
}: ReviewCompositionSectionProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const CATEGORIES = ["Staff & service", "Cleanliness", "Comfort", "Property conditions"] as const;
  const [categoryRatings, setCategoryRatings] = useState<Record<string, number>>({});
  const [categoryHover, setCategoryHover] = useState<Record<string, number>>({});
  const [draftReview, setDraftReview] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Follow-up state
  const [initialFollowUps, setInitialFollowUps] = useState<FollowUpResponse[]>([]);
  const [initialIndex, setInitialIndex] = useState(0);
  const [draftFollowUp, setDraftFollowUp] = useState<FollowUpResponse | null>(null);
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState(false);
  const [initialAnswered, setInitialAnswered] = useState(0);
  const [isPolishing, setIsPolishing] = useState(false);

  const [polishedSegments, setPolishedSegments] = useState<string[]>([]);
  const [answeredTags, setAnsweredTags] = useState<Array<{ topic: string; answer: string }>>([]);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [pausedForPrompt, setPausedForPrompt] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ratingLabels: Record<number, string> = { 2: "Terrible", 4: "Poor", 6: "Okay", 8: "Good", 10: "Excellent" };

  // ── Load initial follow-ups on mount and when rating changes ──
  useEffect(() => {
    fetch(`/api/hotels/${hotel.id}/follow-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "initial", rating }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.followUps && data.followUps.length > 0) {
          setInitialFollowUps(data.followUps);
          // Reset to show first follow-up with updated chips (sentiment from rating)
          if (!draftReview.trim()) {
            setInitialIndex(0);
            setInitialAnswered(0);
          }
        }
      })
      .catch(() => {});
  }, [hotel.id, rating]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice setup ──
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      setVoiceSupported(true);
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let final = "";
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
        }
        if (final) {
          setDraftReview((prev) => {
            const sep = prev && !prev.endsWith(" ") ? " " : "";
            return prev + sep + final;
          });
        }
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
    return () => { if (recognitionRef.current) recognitionRef.current.abort(); };
  }, []);

  // ── Fetch draft-mode follow-up ──
  const answeredTopicsRef = useRef<string[]>([]);
  // Keep ref in sync with answeredTags
  useEffect(() => {
    answeredTopicsRef.current = answeredTags.map((t) => t.topic);
  }, [answeredTags]);

  const fetchDraftFollowUp = useCallback(
    async (review: string, currentRating?: number) => {
      if (!review.trim()) {
        setDraftFollowUp(null);
        return;
      }
      setIsLoadingFollowUp(true);
      try {
        const res = await fetch(`/api/hotels/${hotel.id}/follow-up`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftReview: review,
            mode: "draft",
            rating: currentRating ?? rating,
            answeredTopics: answeredTopicsRef.current,
          }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.topic) {
          setDraftFollowUp(data);
        } else {
          setDraftFollowUp(null);
        }
      } catch {
        setDraftFollowUp(null);
      } finally {
        setIsLoadingFollowUp(false);
      }
    },
    [hotel.id, rating],
  );

  const handleDraftChange = useCallback(
    (text: string) => {
      setDraftReview(text);
      setPolishedSegments([]);
      if (!text.trim()) { setAnsweredTags([]); setPausedForPrompt(false); }
      setDismissed(false);
      setActiveInitialQuestion(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim()) {
        debounceRef.current = setTimeout(() => {
          fetchDraftFollowUp(text);
        }, 800);
      } else {
        setDraftFollowUp(null);
      }
    },
    [fetchDraftFollowUp],
  );

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // ── When rating changes, re-fetch follow-up with new sentiment ──
  const handleRatingChange = useCallback(
    (newRating: number) => {
      setRating(newRating);
      if (draftReview.trim()) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchDraftFollowUp(draftReview, newRating);
        }, 300);
      }
    },
    [draftReview, fetchDraftFollowUp],
  );

  const handleCategoryRating = useCallback(
    (category: string, value: number) => {
      setCategoryRatings((prev) => {
        const next = { ...prev, [category]: value };
        // Auto-compute overall from category average
        const vals = Object.values(next);
        if (vals.length > 0) {
          const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
          setRating(avg);
          if (draftReview.trim()) {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              fetchDraftFollowUp(draftReview, avg);
            }, 300);
          }
        }
        return next;
      });
    },
    [draftReview, fetchDraftFollowUp],
  );

  // Handle prefill
  useEffect(() => {
    if (prefillQuestion) {
      const prompt = `[Regarding ${prefillQuestion.dimension}] `;
      setDraftReview(prompt);
      fetchDraftFollowUp(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQuestion]);

  const toggleVoice = useCallback(() => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDraftReview((cur) => { fetchDraftFollowUp(cur); return cur; });
      }, 400);
    } else {
      try { recognitionRef.current.start(); setIsListening(true); } catch {}
    }
  }, [isListening, fetchDraftFollowUp]);

  // ── Polish answer and append ──
  const polishAndAppend = useCallback(
    async (answer: string, topic: string, question: string) => {
      setIsPolishing(true);
      try {
        const res = await fetch("/api/ai/polish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, answer, question }),
        });
        const data = await res.json();
        const sentence = data.sentence || `The ${topic} was ${answer.toLowerCase()}.`;
        setDraftReview((prev) => {
          const sep = prev.trim() ? " " : "";
          return prev.trim() + sep + sentence;
        });
        setPolishedSegments((prev) => [...prev, sentence]);
      } catch {
        const fallback = `The ${topic} was ${answer.toLowerCase()}.`;
        setDraftReview((prev) => {
          const sep = prev.trim() ? " " : "";
          return prev.trim() + sep + fallback;
        });
        setPolishedSegments((prev) => [...prev, fallback]);
      } finally {
        setIsPolishing(false);
      }
    },
    [],
  );

  // ── Handle follow-up answer (chips/voice/text from sidebar) ──
  const handleAnswered = useCallback(
    async (answer: string, topic: string, question: string) => {
      setAnsweredTags((prev) => {
        const next = [...prev, { topic, answer }];
        // After 3 answered follow-ups, pause and ask user if they want more
        if (next.length >= 3) {
          setPausedForPrompt(true);
          setDraftFollowUp(null);
        }
        return next;
      });
      setSelectedChips([]);
      await polishAndAppend(answer, topic, question);
      // Only auto-fetch next if under 3 answers
      setAnsweredTags((cur) => {
        if (cur.length < 3) {
          setTimeout(() => {
            setDraftReview((review) => {
              fetchDraftFollowUp(review);
              return review;
            });
          }, 300);
        }
        return cur;
      });
    },
    [polishAndAppend, fetchDraftFollowUp],
  );

  // ── Submit ──
  const handleSubmitReview = useCallback(async () => {
    if (!draftReview.trim()) {
      setSubmitError("Please write a review first");
      return;
    }
    if (rating === 0) {
      setSubmitError("Please select a star rating");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const reviewData = { text: draftReview, rating };
      if (onReviewSubmit) {
        await onReviewSubmit(reviewData);
      } else {
        const res = await fetch(`/api/hotels/${hotel.id}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reviewData),
        });
        if (!res.ok) throw new Error("Failed to submit review");
      }
      setSubmitted(true);
      setTimeout(() => {
        setDraftReview("");
        setRating(0);
        setDraftFollowUp(null);
        setPolishedSegments([]);
        setSubmitted(false);
      }, 3000);
    } catch (err) {
      setSubmitError(`Failed to submit: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [draftReview, rating, hotel.id, onReviewSubmit]);

  // ── Success state ──
  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-3" />
        <p className="text-lg font-semibold text-slate-900">Thank you for your review!</p>
        <p className="text-sm text-slate-500 mt-1">Your feedback helps other travelers.</p>
      </div>
    );
  }

  const hasText = draftReview.trim().length > 0;
  const showDraftSidebar = !pausedForPrompt && (draftFollowUp !== null || isLoadingFollowUp);

  const handleDismiss = () => {
    setDraftFollowUp(null);
    setDismissed(true);
    setPausedForPrompt(false);
  };

  const handleWantMore = () => {
    setPausedForPrompt(false);
    fetchDraftFollowUp(draftReview);
  };

  // When user clicks an initial question, add dimension label to textarea as prompt
  const [activeInitialQuestion, setActiveInitialQuestion] = useState<FollowUpResponse | null>(null);

  const handleInitialQuestionClick = (followUp: FollowUpResponse) => {
    // Directly show this follow-up's chips in the sidebar (no text in textarea)
    setDraftFollowUp(followUp);
    setActiveInitialQuestion(followUp);
    setDismissed(false);
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* ── Left: Star rating + Review textarea ── */}
      <div className="lg:col-span-3 space-y-4">
        {/* Overall rating */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-2">
            How would you rate your stay?
          </label>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => {
              const val = star * 2; // 1 star = 2/10, 5 stars = 10/10
              return (
                <button
                  key={star}
                  type="button"
                  onClick={() => handleRatingChange(val)}
                  onMouseEnter={() => setHoverRating(val)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-0.5 transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-7 w-7 transition-colors ${
                      val <= displayRating
                        ? "fill-amber-400 text-amber-400"
                        : "fill-transparent text-slate-300 hover:text-amber-300"
                    }`}
                  />
                </button>
              );
            })}
            {displayRating > 0 && (
              <span className="ml-2 text-sm font-medium text-slate-600">
                {displayRating}/10 {ratingLabels[displayRating] ?? ""}
              </span>
            )}
          </div>
        </div>

        {/* Category ratings */}
        <div className="space-y-2">
          {CATEGORIES.map((cat) => {
            const val = categoryHover[cat] || categoryRatings[cat] || 0;
            return (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-xs text-slate-600 w-32 flex-shrink-0">{cat}</span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const n = star * 2;
                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => handleCategoryRating(cat, n)}
                        onMouseEnter={() => setCategoryHover((p) => ({ ...p, [cat]: n }))}
                        onMouseLeave={() => setCategoryHover((p) => ({ ...p, [cat]: 0 }))}
                        className="p-0.5"
                      >
                        <Star
                          className={`h-4 w-4 transition-colors ${
                            n <= val
                              ? "fill-amber-400 text-amber-400"
                              : "fill-transparent text-slate-300 hover:text-amber-300"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Review textarea */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">
            Write your review
          </label>
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={draftReview}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder={isListening ? "Listening — speak now..." : "Share your experience at this hotel..."}
              className={`w-full px-4 py-3 pr-12 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-slate-800 placeholder:text-slate-400 resize-none transition ${
                isListening ? "border-blue-300 bg-blue-50/30" : "border-slate-200"
              }`}
              rows={7}
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                className={`absolute right-3 bottom-3 p-2 rounded-full transition ${
                  isListening
                    ? "bg-blue-500 text-white shadow-md animate-pulse"
                    : "bg-slate-100 text-slate-400 hover:bg-blue-50 hover:text-blue-500"
                }`}
                title={isListening ? "Stop recording" : "Dictate your review"}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
          </div>
          {isListening && (
            <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              Recording — speak your review, then tap the mic to stop
            </p>
          )}
        </div>

        {/* Tags: answered follow-ups + currently selected chips */}
        {(answeredTags.length > 0 || selectedChips.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {answeredTags.map((tag, idx) => (
              <span
                key={`done-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-700"
              >
                <CheckCircle2 className="h-3 w-3" />
                <span className="font-semibold">{tag.topic}:</span> {tag.answer.length > 25 ? tag.answer.slice(0, 25) + "…" : tag.answer}
              </span>
            ))}
            {selectedChips.map((chip) => (
              <span
                key={`chip-${chip}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-300 text-xs text-blue-700 animate-in fade-in"
              >
                {chip}
              </span>
            ))}
          </div>
        )}

        {/* Polishing indicator */}
        {isPolishing && (
          <div className="flex items-center gap-2 text-xs text-blue-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Adding to your review...
          </div>
        )}

        {/* Error */}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmitReview}
            disabled={isSubmitting || !draftReview.trim() || rating === 0}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-40 transition shadow-sm"
          >
            {isSubmitting ? "Submitting..." : "Submit review"}
          </button>
          {polishedSegments.length > 0 && (
            <span className="text-xs text-slate-400">
              {polishedSegments.length} follow-up{polishedSegments.length > 1 ? "s" : ""} added
            </span>
          )}
        </div>
      </div>

      {/* ── Right: Follow-up sidebar ── */}
      <div className="lg:col-span-2">
        <div className="sticky top-6">
          {!hasText && !activeInitialQuestion && initialFollowUps.length > 0 ? (
            /* Empty state: show top 3 issue questions as clickable prompts */
            <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-blue-400" />
                <span className="text-[11px] font-medium text-slate-400">
                  What would you like to share?
                </span>
              </div>
              <div className="space-y-1.5">
                {initialFollowUps.map((fu, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleInitialQuestionClick(fu)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 transition text-sm text-slate-700 hover:text-blue-700"
                  >
                    {fu.question}
                  </button>
                ))}
              </div>
            </div>
          ) : pausedForPrompt && hasText ? (
            <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white px-3.5 py-3 space-y-2.5 text-center">
              <Sparkles className="h-5 w-5 text-blue-400 mx-auto" />
              <p className="text-sm font-medium text-slate-700">
                Great detail! Want more suggestions?
              </p>
              <p className="text-[11px] text-slate-400">
                {answeredTags.length} topics covered so far
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleWantMore}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition"
                >
                  Yes, more tips
                </button>
                <button
                  onClick={handleDismiss}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium transition"
                >
                  I'm done
                </button>
              </div>
            </div>
          ) : showDraftSidebar ? (
            <SmartFollowupSidebar
              followUpData={draftFollowUp}
              isLoading={isLoadingFollowUp}
              onAnswered={handleAnswered}
              onDismiss={handleDismiss}
              onChipToggle={setSelectedChips}
            />
          ) : hasText && !dismissed ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center">
              <Sparkles className="h-5 w-5 text-slate-300 mx-auto mb-1.5" />
              <p className="text-xs text-slate-400">
                Your review looks great!
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
