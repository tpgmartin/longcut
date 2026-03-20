"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { DocumentHeader } from "@/components/document-header";
import { DocumentViewer } from "@/components/document-viewer";
import { DocumentProgressBar } from "@/components/document-progress-bar";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  DocumentSegment,
  DocumentTopic,
  DocumentInfo,
} from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { backgroundOperation } from "@/lib/promise-utils";
import dynamic from "next/dynamic";

const SummaryViewer = dynamic(
  () => import("@/components/summary-viewer").then((m) => m.SummaryViewer),
  { ssr: false }
);

type PageState = "IDLE" | "ANALYZING" | "LOADED";
type LoadingStage = "parsing" | "understanding" | "generating" | "processing";

// Topic card colors
const TOPIC_COLORS = [
  "border-blue-500/30 bg-blue-500/5",
  "border-emerald-500/30 bg-emerald-500/5",
  "border-amber-500/30 bg-amber-500/5",
  "border-rose-500/30 bg-rose-500/5",
  "border-violet-500/30 bg-violet-500/5",
];

export default function DocumentAnalysisPage() {
  const params = useParams();
  const documentId = params.id as string;

  // Core state
  const [pageState, setPageState] = useState<PageState>("IDLE");
  const [loadingStage, setLoadingStage] = useState<LoadingStage>("parsing");
  const [documentInfo, setDocumentInfo] = useState<DocumentInfo | null>(null);
  const [segments, setSegments] = useState<DocumentSegment[]>([]);
  const [fullText, setFullText] = useState("");
  const [topics, setTopics] = useState<DocumentTopic[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<DocumentTopic | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<"summary" | "chat" | "document">(
    "summary"
  );

  const hasStarted = useRef(false);

  // Load document data from sessionStorage or API
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const storedData = sessionStorage.getItem(`doc-${documentId}`);
    if (storedData) {
      try {
        const { documentInfo: info, segments: segs, fullText: text } =
          JSON.parse(storedData);
        setDocumentInfo(info);
        setSegments(segs);
        setFullText(text);
        sessionStorage.removeItem(`doc-${documentId}`);
        startAnalysis(info, segs, text);
      } catch {
        setError("Failed to load document data");
      }
    } else {
      // Try loading from cache
      loadFromCache();
    }
  }, [documentId]);

  const loadFromCache = async () => {
    try {
      const res = await fetch("/api/document/check-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });

      const data = await res.json();
      if (data.cached && data.analysis) {
        setPageState("LOADED");
        setTopics(data.analysis.topics || []);
        setSummary(data.analysis.summary || null);
        setSuggestedQuestions(data.analysis.suggested_questions || []);

        // Load full analysis for segments
        const fullRes = await fetch(
          `/api/document/analysis?documentId=${documentId}`
        );
        if (fullRes.ok) {
          const fullData = await fullRes.json();
          setDocumentInfo({
            documentId,
            title: fullData.title,
            author: fullData.author || "",
            fileType: fullData.file_type,
            fileName: fullData.file_name,
            fileSize: fullData.file_size,
            wordCount: fullData.word_count,
            pageCount: fullData.page_count,
          });
          setSegments(fullData.segments || []);
          setFullText(fullData.full_text || "");
        }
      } else {
        setError("Document not found. Please upload it again.");
      }
    } catch {
      setError("Failed to load document");
    }
  };

  const startAnalysis = async (
    info: DocumentInfo,
    segs: DocumentSegment[],
    text: string
  ) => {
    setPageState("ANALYZING");
    setLoadingStage("understanding");

    try {
      // Generate topics and summary in parallel
      setLoadingStage("generating");

      const [topicsResult, summaryResult] = await Promise.allSettled([
        fetch("/api/document/generate-topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segments: segs,
            fullText: text,
            documentInfo: info,
          }),
        }).then((r) => r.json()),

        fetch("/api/document/generate-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segments: segs,
            documentInfo: info,
          }),
        }).then((r) => r.json()),
      ]);

      setLoadingStage("processing");

      if (topicsResult.status === "fulfilled" && topicsResult.value.topics) {
        setTopics(topicsResult.value.topics);
      }

      if (
        summaryResult.status === "fulfilled" &&
        summaryResult.value.summaryContent
      ) {
        setSummary(summaryResult.value.summaryContent);
      }

      setPageState("LOADED");

      // Generate suggested questions in background
      backgroundOperation("suggested-questions", async () => {
        const res = await fetch("/api/document/suggested-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: segs, documentInfo: info }),
        });
        const data = await res.json();
        if (data.questions) {
          setSuggestedQuestions(data.questions);
        }
      });

      // Save analysis in background
      backgroundOperation("save-analysis", async () => {
        await fetch("/api/document/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: info.documentId,
            title: info.title,
            author: info.author,
            fileType: info.fileType,
            fileName: info.fileName,
            fileSize: info.fileSize,
            pageCount: info.pageCount,
            wordCount: info.wordCount,
            segments: segs,
            topics:
              topicsResult.status === "fulfilled"
                ? topicsResult.value.topics
                : null,
            summary:
              summaryResult.status === "fulfilled"
                ? summaryResult.value.summaryContent
                : null,
            fullText: text,
          }),
        });
      });
    } catch (err) {
      console.error("Analysis error:", err);
      setError("Failed to analyze document. Please try again.");
      setPageState("IDLE");
    }
  };

  const handleTopicSelect = useCallback((topic: DocumentTopic) => {
    setSelectedTopic((prev) => (prev?.id === topic.id ? null : topic));
  }, []);

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const message = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsChatLoading(true);

    try {
      const res = await fetch("/api/document/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          segments,
          documentInfo,
          chatHistory: chatMessages.slice(-6),
        }),
      });

      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer || "Sorry, I could not generate a response." },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "An error occurred. Please try again." },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, isChatLoading, segments, documentInfo, chatMessages]);

  // Loading state
  if (pageState === "ANALYZING") {
    const stageLabels: Record<LoadingStage, string> = {
      parsing: "Parsing document...",
      understanding: "Understanding content...",
      generating: "Generating insights...",
      processing: "Processing results...",
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <p className="text-sm text-zinc-400">{stageLabels[loadingStage]}</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  // Not loaded yet
  if (pageState === "IDLE" || !documentInfo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800">
        <DocumentHeader documentInfo={documentInfo} />
        {topics.length > 0 && (
          <DocumentProgressBar
            topics={topics}
            totalChars={fullText.length}
            selectedTopic={selectedTopic}
            onTopicClick={handleTopicSelect}
            className="mt-3"
          />
        )}
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: Document + Topics */}
        <div className="w-1/2 flex flex-col border-r border-zinc-800 overflow-hidden">
          {/* Document viewer */}
          <div className="flex-1 overflow-hidden">
            <DocumentViewer
              segments={segments}
              selectedTopic={selectedTopic}
            />
          </div>

          {/* Topics panel */}
          {topics.length > 0 && (
            <div className="border-t border-zinc-800 p-4 max-h-[40%] overflow-y-auto">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                Key Topics ({topics.length})
              </h3>
              <div className="space-y-2">
                {topics.map((topic, idx) => (
                  <Card
                    key={topic.id}
                    className={cn(
                      "p-3 cursor-pointer border transition-all rounded-xl",
                      selectedTopic?.id === topic.id
                        ? TOPIC_COLORS[idx % TOPIC_COLORS.length]
                        : "border-zinc-800 hover:border-zinc-700 bg-transparent"
                    )}
                    onClick={() => handleTopicSelect(topic)}
                  >
                    <h4 className="text-sm font-medium text-zinc-200">
                      {topic.title}
                    </h4>
                    {topic.quote && (
                      <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                        &ldquo;{topic.quote.text.substring(0, 120)}
                        {topic.quote.text.length > 120 ? "..." : ""}&rdquo;
                      </p>
                    )}
                    {topic.quote?.location && (
                      <span className="text-xs text-zinc-600 mt-1 inline-block">
                        {topic.quote.location}
                      </span>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Tabs */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          {/* Tab headers */}
          <div className="flex border-b border-zinc-800">
            {(["summary", "chat", "document"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex-1 px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors",
                  activeTab === tab
                    ? "text-zinc-100 border-b-2 border-blue-500"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "summary" && (
              <div className="p-4">
                {summary ? (
                  <SummaryViewer content={summary} />
                ) : (
                  <p className="text-sm text-zinc-500">
                    Summary is being generated...
                  </p>
                )}
              </div>
            )}

            {activeTab === "chat" && (
              <div className="flex flex-col h-full">
                {/* Suggested questions */}
                {chatMessages.length === 0 && suggestedQuestions.length > 0 && (
                  <div className="p-4 space-y-2">
                    <p className="text-xs text-zinc-500">Try asking:</p>
                    {suggestedQuestions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setChatInput(q);
                        }}
                        className="block w-full text-left text-sm text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "text-sm rounded-xl px-4 py-3 max-w-[85%]",
                        msg.role === "user"
                          ? "ml-auto bg-blue-600 text-white"
                          : "bg-zinc-800 text-zinc-200"
                      )}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex items-center gap-2 text-zinc-500 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Thinking...
                    </div>
                  )}
                </div>

                {/* Chat input */}
                <div className="p-4 border-t border-zinc-800">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChat();
                        }
                      }}
                      placeholder="Ask about this document..."
                      className="flex-1 bg-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 border border-zinc-700 focus:border-zinc-500"
                    />
                    <button
                      onClick={handleSendChat}
                      disabled={!chatInput.trim() || isChatLoading}
                      className="px-4 py-2.5 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50 hover:bg-blue-500 transition-colors"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "document" && (
              <div className="p-4">
                <div className="prose prose-invert prose-sm max-w-none">
                  {segments.map((seg, i) => (
                    <div key={i} className="mb-4">
                      {seg.sectionTitle && (
                        <h3 className="text-sm font-semibold text-zinc-300 mb-1">
                          {seg.sectionTitle}
                        </h3>
                      )}
                      <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                        {seg.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
