"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentUpload } from "@/components/document-upload";
import { toast } from "sonner";
import { DocumentInfo, DocumentSegment } from "@/lib/types";

export default function DocumentPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      setIsLoading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/document/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to upload document");
        }

        const { documentInfo, segments, fullText } = (await response.json()) as {
          documentInfo: DocumentInfo;
          segments: DocumentSegment[];
          fullText: string;
        };

        // Store in sessionStorage for the analysis page to pick up
        sessionStorage.setItem(
          `doc-${documentInfo.documentId}`,
          JSON.stringify({ documentInfo, segments, fullText })
        );

        router.push(`/document/${documentInfo.documentId}`);
      } catch (error) {
        console.error("Upload error:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to upload document"
        );
        setIsLoading(false);
      }
    },
    [router]
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">
          Document Analyzer
        </h1>
        <p className="text-zinc-400 text-sm max-w-md">
          Upload a PDF, EPUB, or text file to extract key insights, topics, and
          summaries using AI.
        </p>
      </div>

      <DocumentUpload onUpload={handleUpload} isLoading={isLoading} />
    </div>
  );
}
