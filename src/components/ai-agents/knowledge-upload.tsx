"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { appendKnowledge } from "@/lib/agents/knowledge/append";
import { KNOWLEDGE_FILE_ACCEPT, MAX_UPLOAD_BYTES } from "@/lib/agents/knowledge/limits";

interface Props {
  value: string;
  max: number;
  onChange: (next: string) => void;
}

interface ExtractResponse {
  fileName: string;
  text: string;
  pages: number | null;
  error?: string;
}

export function KnowledgeUpload({ value, max, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    let current = value;

    for (const file of Array.from(files)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is larger than 8 MB`);
        continue;
      }
      setBusy(file.name);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/ai-agents/knowledge/extract", { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as Partial<ExtractResponse>;
        if (!res.ok || !data.text) {
          toast.error(`${file.name}: ${data.error ?? "could not read file"}`);
          continue;
        }

        const result = appendKnowledge(current, file.name, data.text, max);
        if (!result.added) {
          toast.error(`Knowledge base is full (${max.toLocaleString()} characters). Remove some text first.`);
          break;
        }
        current = result.value;
        onChange(current);
        const pages = data.pages ? ` from ${data.pages} page${data.pages === 1 ? "" : "s"}` : "";
        if (result.truncated) {
          toast.warning(`${file.name}: added ${result.added.toLocaleString()} characters${pages}; the rest didn't fit.`);
        } else {
          toast.success(`${file.name}: added ${result.added.toLocaleString()} characters${pages}. Review, then save.`);
        }
      } catch {
        toast.error(`${file.name}: upload failed`);
      } finally {
        setBusy(null);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={KNOWLEDGE_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        className="border-slate-700 text-slate-300"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
        {busy ? `Reading ${busy}…` : "Upload files"}
      </Button>
      <span className="text-xs text-slate-500">PDF, DOCX, TXT, MD or CSV · up to 8 MB each</span>
      <span className={`ml-auto text-xs ${value.length > max * 0.9 ? "text-amber-400" : "text-slate-500"}`}>
        {value.length.toLocaleString()} / {max.toLocaleString()} characters
      </span>
    </div>
  );
}
