"use client";

import { FileText, BookOpen, FileType } from "lucide-react";
import { DocumentInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DocumentHeaderProps {
  documentInfo: DocumentInfo;
  className?: string;
}

const FILE_TYPE_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  epub: BookOpen,
  txt: FileType,
};

export function DocumentHeader({ documentInfo, className }: DocumentHeaderProps) {
  const Icon = FILE_TYPE_ICONS[documentInfo.fileType] || FileText;

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-zinc-400" />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold text-zinc-100 truncate">
          {documentInfo.title}
        </h1>
        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-0.5">
          {documentInfo.author && <span>{documentInfo.author}</span>}
          <span className="uppercase">{documentInfo.fileType}</span>
          {documentInfo.pageCount && <span>{documentInfo.pageCount} pages</span>}
          <span>{documentInfo.wordCount.toLocaleString()} words</span>
        </div>
      </div>
    </div>
  );
}
