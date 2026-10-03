"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FileDiff, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

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
import type { DiffBundle, SubProject } from "@/types";

interface DiffViewerProps {
  sub: SubProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; bundle: DiffBundle }
  | { status: "error"; message: string };

/** Coloration ligne à ligne d'un diff unifié. */
function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git")) {
    return "text-muted-foreground";
  }
  if (line.startsWith("@@")) {
    return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
  }
  if (
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity index")
  ) {
    return "text-amber-600 dark:text-amber-400";
  }
  if (line.startsWith("+")) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (line.startsWith("-")) {
    return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  }
  if (line.startsWith("#")) {
    return "text-muted-foreground italic";
  }
  return "";
}

function DiffBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="font-mono text-[0.7rem] leading-relaxed">
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "rounded-[2px] px-3 whitespace-pre-wrap",
            lineClass(line)
          )}
        >
          {line.length > 0 ? line : "\u00a0"}
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  variant,
  children,
}: {
  title: string;
  count: number;
  variant: "info" | "warning" | "secondary";
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="bg-muted/50 flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-medium">{title}</span>
        <Badge variant={variant}>{count}</Badge>
      </header>
      <div className="py-2">{children}</div>
    </section>
  );
}

export function DiffViewer({ sub, open, onOpenChange }: DiffViewerProps) {
  const [state, setState] = useState<State>({ status: "idle" });

  /** Recharge le diff d'un sous-projet (bouton « Rafraîchir »). */
  const refresh = useCallback(async (target: SubProject) => {
    if (!isTauri()) {
      setState({ status: "error", message: "Webview Tauri non détectée." });
      return;
    }
    setState({ status: "loading" });
    try {
      setState({ status: "ready", bundle: await tauri.getDiffBundle(target.path) });
    } catch (error) {
      setState({ status: "error", message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    if (!open || !sub) return;
    if (!isTauri()) {
      setState({ status: "error", message: "Webview Tauri non détectée." });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    tauri
      .getDiffBundle(sub.path)
      .then((bundle) => {
        if (!cancelled) setState({ status: "ready", bundle });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [open, sub]);

  const bundle = state.status === "ready" ? state.bundle : null;
  const stagedFiles = bundle ? countFiles(bundle.staged) : 0;
  const unstagedFiles = bundle ? countFiles(bundle.unstaged) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDiff className="size-4" />
            {sub?.name ?? "Diff"}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {sub?.path}
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            Lecture du diff…
          </p>
        )}

        {state.status === "error" && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{state.message}</span>
          </div>
        )}

        {bundle && (
          <ScrollArea className="h-[58vh] rounded-lg border">
            <div className="space-y-3 p-3">
              {stagedFiles === 0 && unstagedFiles === 0 && bundle.untracked.length === 0 && (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  Aucune modification dans ce dépôt.
                </p>
              )}

              <Section title="Indexé (prêt à committer)" count={stagedFiles} variant="info">
                <DiffBlock text={bundle.staged} />
              </Section>

              <Section title="Modifications non indexées" count={unstagedFiles} variant="warning">
                <DiffBlock text={bundle.unstaged} />
              </Section>

              <Section
                title="Fichiers non suivis"
                count={bundle.untracked.length}
                variant="secondary"
              >
                <div className="font-mono text-[0.7rem]">
                  {bundle.untracked.map((path) => (
                    <div key={path} className="px-3 py-0.5 text-emerald-700 dark:text-emerald-400">
                      + {path}
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => sub && void refresh(sub)}
            disabled={state.status === "loading" || !sub}
          >
            <RefreshCw data-icon="inline-start" />
            Rafraîchir
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Compte les fichiers d'un diff en s'appuyant sur ses en-têtes `diff --git`. */
function countFiles(diff: string): number {
  return diff.split("\n").filter((line) => line.startsWith("diff --git ")).length;
}
