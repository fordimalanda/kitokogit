"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  CloudOff,
  GitCommitHorizontal,
  LoaderCircle,
  ScrollText,
  Sparkles,
  Trash,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import type { HistoryEntry } from "@/types";

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

interface HistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HistoryModal({ open, onOpenChange }: HistoryModalProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTauri()) {
      setError("Webview Tauri non détectée.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(await tauri.historyList());
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function clear() {
    try {
      await tauri.historyClear();
      setEntries([]);
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  const aiCount = entries.filter((entry) => entry.origin === "ai").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="size-4" />
            Journal des commits
          </DialogTitle>
          <DialogDescription>
            Les {entries.length} dernière(s) opérations de commit générées par KitokoGit, dont{" "}
            {aiCount} par IA.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Lecture du journal…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Aucun commit enregistré pour le moment. Lancez un workflow ou un commit IA pour
            alimenter ce journal.
          </p>
        ) : (
          <ScrollArea className="max-h-[56vh]">
            <div className="space-y-2 pr-1">
              {entries.map((entry) => (
                <article key={entry.id} className="space-y-2 rounded-lg border p-3">
                  <header className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium">
                      {entry.origin === "ai" ? (
                        <Sparkles className="size-3 text-violet-500" />
                      ) : (
                        <CloudOff className="text-muted-foreground size-3" />
                      )}
                      {entry.projectName}
                    </span>

                    {entry.branch && (
                      <Badge variant="outline" className="font-mono">
                        {entry.branch}
                      </Badge>
                    )}

                    {entry.provider && (
                      <Badge variant="info">
                        {entry.provider}
                        {entry.model ? ` · ${entry.model}` : ""}
                      </Badge>
                    )}
                    {entry.origin === "local" && <Badge variant="warning">repli local</Badge>}
                    {!entry.success && <Badge variant="destructive">échec</Badge>}

                    <span className="text-muted-foreground ml-auto flex items-center gap-1 text-[0.7rem]">
                      <Clock className="size-3" />
                      {entry.timestamp ? DATE_FORMAT.format(new Date(entry.timestamp)) : "—"}
                    </span>
                  </header>

                  <pre className="bg-muted/40 overflow-x-auto rounded-md border px-3 py-2 font-mono text-[0.7rem] whitespace-pre-wrap">
                    {entry.message}
                  </pre>

                  <footer className="text-muted-foreground flex items-center gap-3 text-[0.7rem]">
                    {entry.commitHash ? (
                      <span className="flex items-center gap-1 font-mono">
                        <GitCommitHorizontal className="size-3" />
                        {entry.commitHash}
                      </span>
                    ) : (
                      <span>aucun commit créé</span>
                    )}
                    <span className="truncate font-mono" title={entry.projectPath}>
                      {entry.projectPath}
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void clear()}
            disabled={entries.length === 0}
            className={cn(entries.length > 0 && "text-destructive")}
          >
            <Trash data-icon="inline-start" />
            Effacer le journal
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
