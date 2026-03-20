"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { DocumentSegment, DocumentTopic } from "@/lib/types";
import { cn } from "@/lib/utils";
import * as ScrollArea from "@radix-ui/react-scroll-area";

interface DocumentViewerProps {
  segments: DocumentSegment[];
  selectedTopic: DocumentTopic | null;
  onLocationClick?: (charStart: number, charEnd?: number) => void;
}

export function DocumentViewer({
  segments,
  selectedTopic,
  onLocationClick,
}: DocumentViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIdx, setCurrentSearchIdx] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  // Build set of highlighted segment indices from selected topic
  const highlightedSegments = useMemo(() => {
    if (!selectedTopic) return new Set<number>();
    const indices = new Set<number>();
    for (const seg of selectedTopic.segments) {
      for (let i = seg.segmentIdx; i <= seg.endSegmentIdx; i++) {
        indices.add(i);
      }
    }
    return indices;
  }, [selectedTopic]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setCurrentSearchIdx(0);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results: number[] = [];
    segments.forEach((seg, idx) => {
      if (seg.text.toLowerCase().includes(query)) {
        results.push(idx);
      }
    });
    setSearchResults(results);
    setCurrentSearchIdx(0);
  }, [searchQuery, segments]);

  // Scroll to highlighted segment when topic changes
  useEffect(() => {
    if (!selectedTopic || selectedTopic.segments.length === 0) return;
    const firstIdx = selectedTopic.segments[0].segmentIdx;
    const el = segmentRefs.current.get(firstIdx);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedTopic]);

  // Scroll to search result
  useEffect(() => {
    if (searchResults.length === 0) return;
    const idx = searchResults[currentSearchIdx];
    const el = segmentRefs.current.get(idx);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentSearchIdx, searchResults]);

  const navigateSearch = useCallback(
    (direction: "next" | "prev") => {
      if (searchResults.length === 0) return;
      setCurrentSearchIdx((prev) => {
        if (direction === "next") return (prev + 1) % searchResults.length;
        return (prev - 1 + searchResults.length) % searchResults.length;
      });
    },
    [searchResults.length]
  );

  const setSegmentRef = useCallback(
    (idx: number) => (el: HTMLDivElement | null) => {
      if (el) segmentRefs.current.set(idx, el);
      else segmentRefs.current.delete(idx);
    },
    []
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        {isSearchOpen ? (
          <>
            <Search className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search document..."
              className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
              autoFocus
            />
            {searchResults.length > 0 && (
              <span className="text-xs text-zinc-500">
                {currentSearchIdx + 1}/{searchResults.length}
              </span>
            )}
            <button onClick={() => navigateSearch("prev")} className="text-zinc-500 hover:text-zinc-300">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button onClick={() => navigateSearch("next")} className="text-zinc-500 hover:text-zinc-300">
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setIsSearchOpen(false);
                setSearchQuery("");
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <Search className="w-4 h-4" />
            Search
          </button>
        )}
      </div>

      {/* Document content */}
      <ScrollArea.Root className="flex-1 overflow-hidden">
        <ScrollArea.Viewport ref={scrollViewportRef} className="h-full w-full">
          <div className="p-4 space-y-3">
            {segments.map((segment, idx) => {
              const isHighlighted = highlightedSegments.has(idx);
              const isSearchMatch = searchResults.includes(idx);
              const isCurrentSearch =
                searchResults.length > 0 && searchResults[currentSearchIdx] === idx;

              return (
                <div
                  key={idx}
                  ref={setSegmentRef(idx)}
                  className={cn(
                    "text-sm leading-relaxed rounded-lg px-3 py-2 transition-colors cursor-pointer",
                    isHighlighted
                      ? "bg-blue-500/15 text-zinc-100 border-l-2 border-blue-500"
                      : isCurrentSearch
                        ? "bg-yellow-500/15 text-zinc-200"
                        : isSearchMatch
                          ? "bg-yellow-500/5 text-zinc-300"
                          : "text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50"
                  )}
                  onClick={() => onLocationClick?.(segment.charStart, segment.charEnd)}
                >
                  {/* Section/page indicator */}
                  {(segment.sectionTitle || segment.pageNumber) && (
                    <div className="text-xs text-zinc-600 mb-1">
                      {segment.pageNumber ? `Page ${segment.pageNumber}` : segment.sectionTitle}
                    </div>
                  )}
                  {segment.text}
                </div>
              );
            })}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          className="flex select-none touch-none p-0.5 bg-transparent transition-colors duration-[160ms] ease-out hover:bg-zinc-800/50 data-[orientation=vertical]:w-2.5"
          orientation="vertical"
        >
          <ScrollArea.Thumb className="flex-1 bg-zinc-700 rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px]" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </div>
  );
}
