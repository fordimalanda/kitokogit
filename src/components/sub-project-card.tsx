"use client";

import {
  ArrowDownToLine,
  CircleCheck,
  CloudOff,
  Eye,
  FileDiff,
  GitBranch,
  LoaderCircle,
  Play,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { GitOperationResult, SubProject, WorkflowOptions } from "@/types";

interface SubProjectCardProps {
  sub: SubProject;
  options: WorkflowOptions;
  onOptionsChange: (options: WorkflowOptions) => void;
  onOpenDiff: () => void;
  onOpenCommit: () => void;
  onRunWorkflow: () => void;
  onPull: () => void;
  running: boolean;
  pulling: boolean;
  result: GitOperationResult | null;
}

/** Pastille de statut : vert à jour, orange modifié, rouge erreur remote. */
function statusOf(sub: SubProject): {
  label: string;
  variant: "success" | "warning" | "destructive";
} {
  if (sub.remoteError) {
    return { label: "Erreur remote", variant: "destructive" };
  }
  const pending = sub.stagedFiles + sub.modifiedFiles + sub.untrackedFiles;
  if (pending > 0) {
    return { label: `${pending} modification${pending > 1 ? "s" : ""}`, variant: "warning" };
  }
  return { label: "À jour", variant: "success" };
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="text-muted-foreground truncate text-[0.7rem]">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        size="sm"
        aria-label={label}
      />
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border px-2 py-1.5 text-center">
      <p className={cn("font-heading text-sm font-semibold", value > 0 ? tone : "text-muted-foreground")}>
        {value}
      </p>
      <p className="text-muted-foreground text-[0.65rem]">{label}</p>
    </div>
  );
}

export function SubProjectCard({
  sub,
  options,
  onOptionsChange,
  onOpenDiff,
  onOpenCommit,
  onRunWorkflow,
  onPull,
  running,
  pulling,
  result,
}: SubProjectCardProps) {
  const status = statusOf(sub);
  const changed = sub.stagedFiles + sub.modifiedFiles + sub.untrackedFiles;

  // Liseré de couleur sur le bord gauche de la carte : le dossier « saute aux
  // yeux » dans la liste dès qu'il contient des modifications à pousser.
  const accent =
    status.variant === "destructive"
      ? "border-l-destructive"
      : changed > 0
        ? "border-l-amber-500"
        : "border-l-emerald-500";

  // Un push refusé ou des commits distants en avance ⇒ la synchronisation est
  // l'action la plus utile : on met le bouton en avant.
  const syncSuggested =
    sub.behind > 0 ||
    result?.error?.kind === "push_rejected" ||
    result?.error?.kind === "merge_conflict";

  return (
    <Card className={cn("gap-4 border-l-4", accent)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              status.variant === "destructive"
                ? "bg-destructive"
                : changed > 0
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            )}
          />
          {sub.name}
          {sub.branch && (
            <span className="text-muted-foreground flex items-center gap-1 font-mono text-xs font-normal">
              <GitBranch className="size-3" />
              {sub.branch}
            </span>
          )}
        </CardTitle>
        <CardDescription className="font-mono text-[0.7rem] break-all">
          {sub.path}
        </CardDescription>
        <CardAction className="flex items-center gap-1.5">
          {!sub.hasRemote && (
            <Badge variant="outline" title="Aucun dépôt distant configuré">
              <CloudOff className="size-3" />
              local
            </Badge>
          )}
          {sub.behind > 0 && <Badge variant="warning">↓{sub.behind}</Badge>}
          {sub.ahead > 0 && <Badge variant="info">↑{sub.ahead}</Badge>}
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Compteurs */}
        <div className="grid grid-cols-4 gap-2">
          <Counter label="indexés" value={sub.stagedFiles} tone="text-sky-500" />
          <Counter label="modifiés" value={sub.modifiedFiles} tone="text-amber-500" />
          <Counter label="non suivis" value={sub.untrackedFiles} tone="text-violet-500" />
          <Counter label="amont" value={sub.ahead} tone="text-emerald-500" />
        </div>

        {/* Automates */}
        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleRow
            label="Auto-Add"
            hint="git add -A"
            checked={options.autoAdd}
            disabled={running}
            onCheckedChange={(value) => onOptionsChange({ ...options, autoAdd: value })}
          />
          <ToggleRow
            label="Auto-Commit"
            hint="message IA"
            checked={options.autoCommit}
            disabled={running}
            onCheckedChange={(value) => onOptionsChange({ ...options, autoCommit: value })}
          />
          <ToggleRow
            label="Auto-Push"
            hint="origin / branche"
            checked={options.autoPush}
            disabled={running}
            onCheckedChange={(value) => onOptionsChange({ ...options, autoPush: value })}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={syncSuggested ? "default" : "outline"}
            size="sm"
            onClick={onPull}
            disabled={running || pulling || !sub.hasRemote}
            title={
              sub.hasRemote
                ? "Récupérer et intégrer les commits distants (git pull)"
                : "Aucun dépôt distant configuré"
            }
          >
            {pulling ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <ArrowDownToLine data-icon="inline-start" />
            )}
            Pull &amp; Sync
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenDiff} disabled={running}>
            <FileDiff data-icon="inline-start" />
            Voir le diff
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenCommit} disabled={running}>
            <Sparkles data-icon="inline-start" />
            Message IA
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            onClick={onRunWorkflow}
            disabled={running || changed === 0}
          >
            {running ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            Run Workflow
          </Button>
        </div>

        {/* Journal du dernier workflow */}
        {result && (
          <div className="space-y-2">
            {result.error ? (
              <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {result.error.kind} · {result.error.message}
                  </p>
                  {result.error.details && (
                    <pre className="text-muted-foreground max-h-24 overflow-auto font-mono text-[0.65rem] whitespace-pre-wrap">
                      {result.error.details}
                    </pre>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="size-3.5" />
                Workflow terminé{result.commitHash ? ` · commit ${result.commitHash}` : ""}
              </div>
            )}

            {result.steps.length > 0 && (
              <div className="bg-muted/50 rounded-lg border px-3 py-2 font-mono text-[0.65rem]">
                {result.steps.map((step, index) => (
                  <div key={index} className="text-muted-foreground truncate">
                    <span className="text-emerald-500">›</span> {step}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {sub.remoteError && !result && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-[0.7rem]">
            <Eye className="size-3" />
            {sub.remoteError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
