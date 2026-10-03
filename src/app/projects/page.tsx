"use client";

import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  CircleAlert,
  CloudOff,
  FolderPlus,
  FolderSearch,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Trash,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import type { ProjectInfo, ProjectKind, SubProject } from "@/types";

const ROOTS_KEY = "kitokogit-roots";

type ScanResult = { ok: true; project: ProjectInfo } | { ok: false; error: string };

const KIND_LABEL: Record<ProjectKind, string> = {
  repository: "Dépôt Git",
  monorepo: "Monorepo",
  notInitialized: "Git non initialisé",
};

const KIND_VARIANT: Record<ProjectKind, "info" | "secondary" | "warning"> = {
  repository: "info",
  monorepo: "secondary",
  notInitialized: "warning",
};

export default function ProjectsPage() {
  const [roots, setRoots] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, ScanResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const scan = useCallback(async (path: string) => {
    setBusy(path);
    try {
      const project = await tauri.scanProject(path);
      setResults((prev) => ({ ...prev, [path]: { ok: true, project } }));
    } catch (error) {
      setResults((prev) => ({ ...prev, [path]: { ok: false, error: describeError(error) } }));
    } finally {
      setBusy((current) => (current === path ? null : current));
    }
  }, []);

  // Restaure la liste des dossiers racine puis les rescanne.
  useEffect(() => {
    if (!isTauri()) return;
    let stored: string[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(ROOTS_KEY) ?? "[]") as string[];
    } catch {
      stored = [];
    }
    setRoots(stored);
    stored.forEach((path) => void scan(path));
  }, [scan]);

  function persist(next: string[]) {
    setRoots(next);
    localStorage.setItem(ROOTS_KEY, JSON.stringify(next));
  }

  async function addRoot() {
    const selected = await open({ directory: true, multiple: false, title: "Choisir un dossier racine" });
    if (typeof selected !== "string") return;
    if (roots.includes(selected)) {
      void scan(selected);
      return;
    }
    persist([...roots, selected]);
    void scan(selected);
  }

  function removeRoot(path: string) {
    persist(roots.filter((item) => item !== path));
    setResults((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Dossiers racine</h2>
          <p className="text-muted-foreground text-sm">
            Ajoutez un dossier : KitokoGit détecte automatiquement le dépôt ou ses sous-projets.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => roots.forEach((p) => void scan(p))}>
            <RefreshCw data-icon="inline-start" />
            Rescanner
          </Button>
          <Button size="sm" onClick={() => void addRoot()}>
            <FolderPlus data-icon="inline-start" />
            Ajouter un dossier
          </Button>
        </div>
      </div>

      {!isTauri() && (
        <Notice tone="warning" text="Webview Tauri non détectée : lancez « npm run tauri dev »." />
      )}

      {roots.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FolderSearch className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">Aucun dossier racine</p>
            <p className="text-muted-foreground max-w-sm text-xs">
              Sélectionnez par exemple un dossier de travail contenant plusieurs dépôts, ou un
              dossier unique contenant un <code>.git</code>.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {roots.map((path) => (
          <RootCard
            key={path}
            path={path}
            result={results[path]}
            busy={busy === path}
            onScan={() => void scan(path)}
            onRemove={() => removeRoot(path)}
          />
        ))}
      </div>
    </div>
  );
}

function RootCard({
  path,
  result,
  busy,
  onScan,
  onRemove,
}: {
  path: string;
  result: ScanResult | undefined;
  busy: boolean;
  onScan: () => void;
  onRemove: () => void;
}) {
  const project = result?.ok ? result.project : null;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderSearch className="text-muted-foreground size-4" />
          {project?.name ?? basename(path)}
          {busy && <LoaderCircle className="size-3.5 animate-spin text-sky-500" />}
        </CardTitle>
        <CardDescription className="font-mono text-xs break-all">{path}</CardDescription>
        <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-2 self-start justify-self-end">
          {project && <Badge variant={KIND_VARIANT[project.kind]}>{KIND_LABEL[project.kind]}</Badge>}
          <Button variant="ghost" size="icon-sm" aria-label="Rescanner" onClick={onScan}>
            <RefreshCw />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Retirer" onClick={onRemove}>
            <Trash />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {!result && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <LoaderCircle className="size-3.5 animate-spin" />
            Scan en cours…
          </p>
        )}

        {result && !result.ok && <Notice tone="error" text={result.error} />}

        {project?.error && <Notice tone="warning" text={project.error} />}

        {project?.kind === "notInitialized" && (
          <p className="text-muted-foreground text-sm">
            Aucun dépôt <code>.git</code> trouvé dans ce dossier ni dans ses sous-dossiers directs.
          </p>
        )}

        {project?.subProjects.map((sub) => <SubProjectRow key={sub.path} sub={sub} />)}
      </CardContent>
    </Card>
  );
}

function SubProjectRow({ sub }: { sub: SubProject }) {
  const pending = sub.modifiedFiles + sub.stagedFiles + sub.untrackedFiles;

  let status: { label: string; variant: "success" | "warning" | "info" } = {
    label: "À jour",
    variant: "success",
  };
  if (sub.remoteError) {
    status = { label: "Erreur remote", variant: "warning" };
  } else if (pending > 0) {
    status = { label: `${pending} changement(s)`, variant: "warning" };
  }

  return (
    <div className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition-colors hover:border-border">
      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{sub.name}</p>
          {sub.branch && (
            <span className="text-muted-foreground flex items-center gap-1 font-mono text-xs">
              <GitBranch className="size-3" />
              {sub.branch}
            </span>
          )}
        </div>
        <p className="text-muted-foreground truncate font-mono text-[0.7rem]">{sub.path}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {!sub.hasRemote && (
          <Badge variant="outline" title="Aucun remote configuré">
            <CloudOff className="size-3" />
            local
          </Badge>
        )}
        {sub.behind > 0 && <Badge variant="warning">↓{sub.behind}</Badge>}
        {sub.ahead > 0 && <Badge variant="info">↑{sub.ahead}</Badge>}
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "warning" | "error"; text: string }) {
  const Icon = tone === "error" ? CircleAlert : TriangleAlert;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
