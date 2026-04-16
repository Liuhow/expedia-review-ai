"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Sparkles, Loader2, X, Check, Send } from "lucide-react";
import { FollowUpResponse } from "@/types";

export interface SmartFollowupSidebarProps {
  followUpData: FollowUpResponse | null;
  isLoading?: boolean;
  onAnswered: (answer: string, topic: string, question: string) => void;
  onDismiss?: () => void;
  onChipToggle?: (chips: string[]) => void;
}

export function SmartFollowupSidebar({
  followUpData,
  isLoading = false,
  onAnswered,
  onDismiss,
  onChipToggle,
}: SmartFollowupSidebarProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"chips" | "listening">("chips");
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Reset on new question
  useEffect(() => {
    setSelected(new Set());
    setPhase("chips");
    setTranscript("");
    setTextInput("");
    setReasonInput("");
    setVoiceError(null);
  }, [followUpData?.topic, followUpData?.question]);

  // Init Web Speech API
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      setVoiceSupported(true);
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
        }
        const current = finalText || event.results[event.results.length - 1]?.[0]?.transcript || "";
        setTranscript(current);
      };

      recognition.onerror = (event: any) => {
        setVoiceError(`Mic error: ${event.error}`);
        setPhase("chips");
      };

      recognition.onend = () => {
        setPhase("chips");
        // Put transcript into text input for review/edit before submitting
        setTranscript((t) => {
          if (t.trim()) {
            setTextInput(t.trim());
          }
          return t;
        });
      };

      recognitionRef.current = recognition;
    }
    return () => { if (recognitionRef.current) recognitionRef.current.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent when chip selection changes (via useEffect to avoid setState-during-render)
  useEffect(() => {
    onChipToggle?.(Array.from(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toggleChip = (chip: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  };

  const negSet = new Set(followUpData?.negativeChips || []);
  const hasNegSelected = Array.from(selected).some((chip) => negSet.has(chip));

  const handleSubmitChips = () => {
    if (selected.size === 0 || !followUpData) return;
    const chips = Array.from(selected).join(", ");
    const answer = reasonInput.trim() ? `${chips} — ${reasonInput.trim()}` : chips;
    onAnswered(answer, followUpData.topic, followUpData.question);
    setReasonInput("");
  };

  const handleSubmitText = () => {
    if (!textInput.trim() || !followUpData) return;
    onAnswered(textInput.trim(), followUpData.topic, followUpData.question);
    setTextInput("");
  };

  const startVoice = () => {
    if (!recognitionRef.current) return;
    setTranscript("");
    setVoiceError(null);
    setPhase("listening");
    try { recognitionRef.current.start(); } catch { /* already started */ }
  };

  const stopVoice = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ok */ }
    }
  };

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="rounded-xl border border-blue-100 bg-gradient-to-b from-blue-50/80 to-white px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
          <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">
            Analyzing your review...
          </span>
        </div>
      </div>
    );
  }

  if (!followUpData) return null;

  // ── Listening ──
  if (phase === "listening") {
    return (
      <div className="rounded-xl border border-blue-200 bg-gradient-to-b from-blue-50/50 to-white px-3.5 py-3 space-y-2">
        <p className="text-[11px] font-semibold text-blue-500 uppercase tracking-wide">Listening...</p>
        <p className="text-xs font-medium text-slate-900">{followUpData.question}</p>
        {transcript && (
          <div className="bg-white rounded-lg p-2 border border-blue-100">
            <p className="text-xs text-slate-700 italic">&ldquo;{transcript}&rdquo;</p>
          </div>
        )}
        <button
          onClick={stopVoice}
          className="w-full px-2.5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5"
        >
          <MicOff className="h-3 w-3" />
          Stop recording
        </button>
        {voiceError && <p className="text-[10px] text-red-500">{voiceError}</p>}
      </div>
    );
  }

  // ── Main: multi-select aspect chips + text input ──
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white px-5 py-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-blue-400" />
          <span className="text-xs font-medium text-slate-400">
            Optional — helps future guests
          </span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 rounded-full hover:bg-slate-100 transition text-slate-300 hover:text-slate-500"
            title="Skip"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Question */}
      <p className="text-sm font-semibold text-slate-800 leading-snug">
        {followUpData.question}
      </p>

      {/* Rationale */}
      {followUpData.rationale && (
        <p className="text-xs text-slate-400 leading-relaxed">
          {followUpData.rationale}
        </p>
      )}

      {/* Multi-select aspect chips */}
      {followUpData.quickReplies && followUpData.quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {followUpData.quickReplies.map((chip) => {
            const isSelected = selected.has(chip);
            return (
              <button
                key={chip}
                onClick={() => toggleChip(chip)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                  isSelected
                    ? "bg-blue-50 border-blue-300 text-blue-700"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
                {chip}
              </button>
            );
          })}
        </div>
      )}

      {/* Negative chip follow-up: ask for reason */}
      {selected.size > 0 && hasNegSelected && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-500">What happened?</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmitChips(); }}
              placeholder="e.g. shower was leaking..."
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            />
            {voiceSupported && (
              <button
                onClick={() => {
                  if (!recognitionRef.current) return;
                  setVoiceError(null);
                  // Use a one-shot recognition for reason input
                  const sr = recognitionRef.current;
                  const prevOnResult = sr.onresult;
                  const prevOnEnd = sr.onend;
                  sr.onresult = (event: any) => {
                    let finalText = "";
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                      if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
                    }
                    const current = finalText || event.results[event.results.length - 1]?.[0]?.transcript || "";
                    if (current.trim()) setReasonInput((prev) => prev ? prev + " " + current.trim() : current.trim());
                  };
                  sr.onend = () => {
                    sr.onresult = prevOnResult;
                    sr.onend = prevOnEnd;
                  };
                  try { sr.start(); } catch { /* already started */ }
                }}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition flex-shrink-0"
                title="Speak your answer"
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add to review button — appears when chips selected */}
      {selected.size > 0 && (
        <button
          onClick={handleSubmitChips}
          className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition"
        >
          Add to review
        </button>
      )}

      {/* Text input + voice row */}
      {selected.size === 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmitText(); }}
              placeholder="Type your answer..."
              className="w-full px-3 py-2 pr-8 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            />
            {textInput.trim() && (
              <button
                onClick={handleSubmitText}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-blue-500 hover:text-blue-700 transition"
              >
                <Send className="h-3 w-3" />
              </button>
            )}
          </div>
          {voiceSupported && (
            <button
              onClick={startVoice}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition flex-shrink-0"
              title="Answer by voice"
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {voiceError && <p className="text-[10px] text-red-500">{voiceError}</p>}
    </div>
  );
}
