"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  CloudOff,
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
import { isEmptyDiff } from "@/lib/commit-message";
import {
  generateCommitMessage,
  loadSettings,
  type CommitGeneration,
} from "@/lib/generate-commit";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import type {
  AppSettings,
  DiffBundle,
  GitOperationResult,
  SubProject,
  WorkflowOptions,
} from "@/types";

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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [bundle, setBundle] = useState<DiffBundle | null>(null);
  const [generation, setGeneration] = useState<CommitGeneration | null>(null);
  const [message, setMessage] = useState("");
  const [edited, setEdited] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les réglages (provider, modèle, consignes) ne changent pas pendant la session.
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  // Lecture du diff puis génération, à chaque ouverture.
  useEffect(() => {
    if (!open || !sub || !settings || !isTauri()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setGeneration(null);
    setMessage("");
    setEdited(false);
    setBundle(null);

    tauri
      .getDiffBundle(sub.path)
      .then(async (loaded) => {
        if (cancelled) return;
        setBundle(loaded);

        const isEmpty = isEmptyDiff(loaded);
        setEmpty(isEmpty);
        if (isEmpty) return;

        const generated = await generateCommitMessage(sub.path, loaded, settings);
        if (cancelled) return;
        setGeneration(generated);
        setMessage(generated.message);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sub, settings]);

  const regenerate = useCallback(async () => {
    if (!sub || !settings) return;
    setGenerating(true);
    setError(null);
    try {
      const generated = await generateCommitMessage(sub.path, bundle, settings);
      setGeneration(generated);
      setMessage(generated.message);
      setEdited(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setGenerating(false);
    }
  }, [sub, settings, bundle]);

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
        setError(describeError(result.error));
      }
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const firstLine = message.split("\n")[0] ?? "";
  const looksConventional = CONVENTIONAL.test(firstLine);
  const busy = loading || generating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Message de commit
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{sub?.path}</DialogDescription>
        </DialogHeader>

        {/* Origine du message */}
        <div className="flex flex-wrap items-center gap-2">
          {generation?.origin === "ai" && (
            <Badge variant="info">
              {generation.provider} · {generation.model}
            </Badge>
          )}
          {generation?.origin === "local" && (
            <Badge variant="warning">
              <CloudOff className="size-3" />
              Repli local
            </Badge>
          )}
          {edited && <Badge variant="secondary">Édité</Badge>}
          {generation?.truncated && (
            <Badge variant="warning">
              diff tronqué · {Math.round(generation.diffBytes / 1024)} Ko
            </Badge>
          )}
          {options.autoAdd && <Badge variant="outline">Auto-Add</Badge>}
          {options.autoPush && <Badge variant="outline">Auto-Push</Badge>}
        </div>

        {/* Raison du repli local */}
        {generation?.warning && (
          <div className="border-amber-500/30 bg-amber-500/5 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">
                IA indisponible ({generation.warning.kind}) — message généré localement.
              </p>
              <p className="mt-0.5">{generation.warning.message}</p>
            </div>
          </div>
        )}

        {busy ? (
          <p className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            {generating ? "Génération du message par l'IA…" : "Analyse des modifications…"}
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
                  setEdited(true);
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
                    !looksConventional &&
                      firstLine.length > 0 &&
                      "text-amber-600 dark:text-amber-400"
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
          <Button variant="outline" onClick={() => void regenerate()} disabled={busy || empty}>
            <WandSparkles data-icon="inline-start" />
            {generation?.origin === "local" ? "Réessayer l'IA" : "Régénérer"}
          </Button>
          <Button onClick={() => void handleCommit()} disabled={submitting || busy || empty}>
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
