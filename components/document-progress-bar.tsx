"use client";

import { useMemo } from "react";
import { DocumentTopic } from "@/lib/types";
import { cn } from "@/lib/utils";

// Color palette matching the video topic colors
const TOPIC_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
];

interface DocumentProgressBarProps {
  topics: DocumentTopic[];
  totalChars: number;
  selectedTopic: DocumentTopic | null;
  onTopicClick?: (topic: DocumentTopic) => void;
  className?: string;
}

export function DocumentProgressBar({
  topics,
  totalChars,
  selectedTopic,
  onTopicClick,
  className,
}: DocumentProgressBarProps) {
  const segments = useMemo(() => {
    if (totalChars === 0) return [];

    return topics.flatMap((topic, topicIdx) =>
      topic.segments.map((seg) => ({
        left: (seg.charStart / totalChars) * 100,
        width: Math.max(0.5, ((seg.charEnd - seg.charStart) / totalChars) * 100),
        color: TOPIC_COLORS[topicIdx % TOPIC_COLORS.length],
        topic,
        isSelected: selectedTopic?.id === topic.id,
      }))
    );
  }, [topics, totalChars, selectedTopic]);

  return (
    <div className={cn("relative w-full h-2 bg-zinc-800 rounded-full overflow-hidden", className)}>
      {segments.map((seg, idx) => (
        <div
          key={idx}
          className={cn(
            "absolute top-0 h-full rounded-full cursor-pointer transition-opacity",
            seg.color,
            seg.isSelected ? "opacity-100" : "opacity-60 hover:opacity-80"
          )}
          style={{
            left: `${seg.left}%`,
            width: `${seg.width}%`,
          }}
          onClick={() => onTopicClick?.(seg.topic)}
          title={seg.topic.title}
        />
      ))}
    </div>
  );
}
