"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  LoaderCircle,
  Send,
  Sparkles,
  TriangleAlert,
  WandSparkles,
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
import {
  buildDiffForPrompt,
  generateLocalCommitMessage,
  isEmptyDiff,
} from "@/lib/commit-message";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import type { DiffBundle, GitOperationResult, SubProject, WorkflowOptions } from "@/types";

/** Vrai si la première ligne respecte `type(scope): description`. */
const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/;

interface CommitAiModalProps {
  sub: SubProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: WorkflowOptions;
  onFinished: (path: string, result: GitOperationResult) => void;
}

export function CommitAiModal({
  sub,
  open,
  onOpenChange,
  options,
  onFinished,
}: CommitAiModalProps) {
  const [bundle, setBundle] = useState<DiffBundle | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffInfo, setDiffInfo] = useState({ bytes: 0, truncated: false });
  const [origin, setOrigin] = useState<"local" | "manual">("local");

  const regenerate = useCallback((source: DiffBundle) => {
    setMessage(generateLocalCommitMessage(source));
    setOrigin("local");
  }, []);

  const load = useCallback(
    async (target: SubProject, withMessage: boolean) => {
      if (!isTauri()) {
        setError("Webview Tauri non détectée.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await tauri.getDiffBundle(target.path);
        setBundle(result);
        const prepared = buildDiffForPrompt(result);
        setDiffInfo({ bytes: prepared.bytes, truncated: prepared.truncated });
        if (withMessage) regenerate(result);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setLoading(false);
      }
    },
    [regenerate]
  );

  useEffect(() => {
    if (!open || !sub) return;
    setMessage("");
    setBundle(null);
    setError(null);
    void load(sub, true);
  }, [open, sub, load]);

  const empty = bundle ? isEmptyDiff(bundle) : false;
  const firstLine = message.split("\n")[0] ?? "";
  const looksConventional = CONVENTIONAL.test(firstLine);

  async function handleCommit() {
    if (!sub) return;
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Le message de commit est vide.");
      return;
    }
    if (empty) {
      setError("Aucune modification détectée : il n'y a rien à committer.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await tauri.runGitWorkflow(
        sub.path,
        options.autoAdd,
        trimmed,
        options.autoPush
      );
      onFinished(sub.path, result);
      if (result.success) {
        onOpenChange(false);
      } else if (result.error) {
        setError(
          result.error.details
            ? `${result.error.message}\n${result.error.details}`
            : result.error.message
        );
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Message de commit
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {sub?.path}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={origin === "local" ? "secondary" : "outline"}>
            {origin === "local" ? "Heuristique locale" : "Édité manuellement"}
          </Badge>
          {diffInfo.truncated && (
            <Badge variant="warning">
              diff tronqué · {Math.round(diffInfo.bytes / 1024)} Ko
            </Badge>
          )}
          {options.autoAdd && <Badge variant="info">Auto-Add</Badge>}
          {options.autoPush && <Badge variant="info">Auto-Push</Badge>}
        </div>

        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Analyse des modifications…
          </p>
        ) : (
          <ScrollArea className="max-h-[46vh]">
            <div className="space-y-3 pr-1">
              {empty && (
                <div className="border-amber-500/30 bg-amber-500/5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  <span>Aucune modification détectée dans ce dépôt.</span>
                </div>
              )}

              <textarea
                value={message}
                onChange={(event) => {
                  setMessage(event.currentTarget.value);
                  setOrigin("manual");
                }}
                spellCheck={false}
                rows={7}
                placeholder="feat(scope): description courte à l'impératif"
                className={cn(
                  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]",
                  empty && "opacity-60"
                )}
              />

              <div className="text-muted-foreground flex items-center justify-between text-[0.7rem]">
                <span
                  className={cn(
                    "flex items-center gap-1",
                    !looksConventional && firstLine.length > 0 && "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {looksConventional ? (
                    <>Conventional Commits ✓</>
                  ) : (
                    <>
                      <CircleAlert className="size-3" />
                      Format attendu : type(scope): description
                    </>
                  )}
                </span>
                <span className={cn(firstLine.length > 72 && "text-amber-600 dark:text-amber-400")}>
                  {firstLine.length}/72
                </span>
              </div>
            </div>
          </ScrollArea>
        )}

        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => bundle && regenerate(bundle)}
            disabled={loading || !bundle}
          >
            <WandSparkles data-icon="inline-start" />
            Régénérer
          </Button>
          <Button onClick={() => void handleCommit()} disabled={submitting || loading || empty}>
            {submitting ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Send data-icon="inline-start" />
            )}
            Committer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
