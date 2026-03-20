"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = {
  "application/pdf": ".pdf",
  "application/epub+zip": ".epub",
  "text/plain": ".txt",
};

const ACCEPTED_EXTENSIONS = [".pdf", ".epub", ".txt"];

interface DocumentUploadProps {
  onUpload: (file: File) => void;
  isLoading?: boolean;
}

export function DocumentUpload({ onUpload, isLoading = false }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return "Unsupported file type. Accepted: PDF, EPUB, TXT";
    }

    const maxSize = ext === ".txt" ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      return `File too large. Maximum size for ${ext}: ${maxMB}MB`;
    }

    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setSelectedFile(null);
        return;
      }
      setError("");
      setSelectedFile(file);
    },
    [validateFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleSubmit = useCallback(() => {
    if (selectedFile && !isLoading) {
      onUpload(selectedFile);
    }
  }, [selectedFile, isLoading, onUpload]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <Card
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer",
          isDragging
            ? "border-blue-500 bg-blue-500/5"
            : "border-zinc-700 hover:border-zinc-500",
          isLoading && "opacity-60 pointer-events-none"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.txt"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="flex flex-col items-center gap-3 text-center">
          {selectedFile ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">{selectedFile.name}</p>
                <p className="text-xs text-zinc-500">{formatFileSize(selectedFile.size)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-500 hover:text-zinc-300"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                  setError("");
                }}
              >
                <X className="w-4 h-4 mr-1" />
                Remove
              </Button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                <Upload className="w-6 h-6 text-zinc-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">
                  Drop your document here or click to browse
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Supports PDF, EPUB, and TXT files (up to 20MB)
                </p>
              </div>
            </>
          )}
        </div>
      </Card>

      {error && (
        <p className="text-sm text-red-400 text-center">{error}</p>
      )}

      {selectedFile && (
        <Button
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full rounded-xl h-11"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <FileText className="w-4 h-4 mr-2" />
              Analyze Document
            </>
          )}
        </Button>
      )}
    </div>
  );
}
