"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderSearch, LoaderCircle, TriangleAlert } from "lucide-react";

import { CommitAiModal } from "@/components/commit-ai-modal";
import { DiffViewer } from "@/components/diff-viewer";
import { GLOBAL_VIEW, ProjectHeader, type ProjectTab } from "@/components/project-header";
import { SubProjectCard } from "@/components/sub-project-card";
import { Card, CardContent } from "@/components/ui/card";
import { generateLocalCommitMessage, isEmptyDiff } from "@/lib/commit-message";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import {
  loadWorkflowPrefs,
  resolveOptions,
  saveWorkflowPrefs,
  type WorkflowPrefs,
} from "@/lib/workflow-prefs";
import { cn } from "@/lib/utils";
import type { GitOperationResult, ProjectInfo, SubProject, WorkflowOptions } from "@/types";

const ROOTS_KEY = "kitokogit-roots";

type ScanResult = { ok: true; project: ProjectInfo } | { ok: false; error: string };
type Logs = Record<string, GitOperationResult | null>;
type Busy = Record<string, boolean>;

export default function ProjectsPage() {
  const [roots, setRoots] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, ScanResult>>({});
  const [active, setActive] = useState<string>(GLOBAL_VIEW);
  const [prefs, setPrefs] = useState<WorkflowPrefs>({});
  const [diffTarget, setDiffTarget] = useState<SubProject | null>(null);
  const [commitTarget, setCommitTarget] = useState<SubProject | null>(null);
  const [logs, setLogs] = useState<Logs>({});
  const [busy, setBusy] = useState<Busy>({});

  /* ---------------- Scan ---------------- */

  const scan = useCallback(async (path: string) => {
    setBusy((current) => ({ ...current, [path]: true }));
    try {
      const project = await tauri.scanProject(path);
      setResults((current) => ({ ...current, [path]: { ok: true, project } }));
    } catch (error) {
      setResults((current) => ({ ...current, [path]: { ok: false, error: describeError(error) } }));
    } finally {
      setBusy((current) => ({ ...current, [path]: false }));
    }
  }, []);

  useEffect(() => {
    setPrefs(loadWorkflowPrefs());
    if (!isTauri()) return;

    let stored: string[] = [];
    try {
      stored = JSON.parse(window.localStorage.getItem(ROOTS_KEY) ?? "[]") as string[];
    } catch {
      stored = [];
    }
    if (!Array.isArray(stored)) stored = [];

    setRoots(stored);
    stored.forEach((path) => void scan(path));
  }, [scan]);

  function persistRoots(next: string[]) {
    setRoots(next);
    window.localStorage.setItem(ROOTS_KEY, JSON.stringify(next));
  }

  async function addRoot() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choisir un dossier racine",
    });
    if (typeof selected !== "string") return;
    if (!roots.includes(selected)) persistRoots([...roots, selected]);
    setActive(selected);
    void scan(selected);
  }

  function removeRoot(path: string) {
    persistRoots(roots.filter((item) => item !== path));
    setResults((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    if (active === path) setActive(GLOBAL_VIEW);
  }

  /* ---------------- Préférences ---------------- */

  function updateOptions(path: string, options: WorkflowOptions) {
    const next = { ...prefs, [path]: options };
    setPrefs(next);
    saveWorkflowPrefs(next);
  }

  /* ---------------- Workflow ---------------- */

  const runWorkflow = useCallback(
    async (rootPath: string, sub: SubProject) => {
      const options = resolveOptions(prefs, sub.path);
      setBusy((current) => ({ ...current, [sub.path]: true }));

      try {
        let message: string | null = null;

        if (options.autoCommit) {
          const bundle = await tauri.getDiffBundle(sub.path);
          if (isEmptyDiff(bundle)) {
            setLogs((current) => ({
              ...current,
              [sub.path]: {
                success: false,
                steps: [],
                commitHash: null,
                error: {
                  kind: "nothing_to_commit",
                  message: "Aucune modification détectée dans ce dépôt.",
                  details: null,
                },
              },
            }));
            return;
          }
          // Étape 3 : ce message viendra du provider IA (appelé depuis Rust).
          message = generateLocalCommitMessage(bundle);
        }

        const result = await tauri.runGitWorkflow(
          sub.path,
          options.autoAdd,
          message,
          options.autoPush
        );
        setLogs((current) => ({ ...current, [sub.path]: result }));
      } catch (error) {
        setLogs((current) => ({
          ...current,
          [sub.path]: {
            success: false,
            steps: [],
            commitHash: null,
            error: { kind: "unexpected", message: describeError(error), details: null },
          },
        }));
      } finally {
        setBusy((current) => ({ ...current, [sub.path]: false }));
        // On rafraîchit l'état Git réel après les opérations.
        void scan(rootPath);
      }
    },
    [prefs, scan]
  );

  /* ---------------- Données dérivées ---------------- */

  const pairs = useMemo(() => {
    const list: { rootPath: string; sub: SubProject }[] = [];
    for (const [rootPath, result] of Object.entries(results)) {
      if (result.ok) {
        for (const sub of result.project.subProjects) list.push({ rootPath, sub });
      }
    }
    return list;
  }, [results]);

  const tabs: ProjectTab[] = useMemo(
    () =>
      roots.map((path) => {
        const result = results[path];
        const project = result?.ok ? result.project : null;
        return {
          path,
          label: project?.name ?? basename(path),
          kind: project?.kind ?? "repository",
          subCount: project?.subProjects.length ?? 0,
        };
      }),
    [roots, results]
  );

  const visible = active === GLOBAL_VIEW ? pairs : pairs.filter((pair) => pair.rootPath === active);

  /* ---------------- Rendu ---------------- */

  if (!isTauri()) {
    return (
      <Notice
        tone="warning"
        text="Webview Tauri non détectée. Lancez l'application avec « npm run tauri dev »."
      />
    );
  }

  return (
    <div className="space-y-6">
      <ProjectHeader
        projects={tabs}
        active={active}
        onSelect={setActive}
        onAdd={() => void addRoot()}
        onRefresh={() => roots.forEach((path) => void scan(path))}
      />

      {roots.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <FolderSearch className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">Aucun dossier racine</p>
            <p className="text-muted-foreground max-w-md text-xs">
              Sélectionnez un dossier de travail contenant plusieurs dépôts, ou un dossier unique
              contenant un <code>.git</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {roots.map((path) => {
        const result = results[path];
        if (!result) {
          return (
            <p key={path} className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderCircle className="size-3.5 animate-spin" />
              Scan de <span className="font-mono text-xs">{path}</span>…
            </p>
          );
        }

        if (!result.ok) {
          return (
            <div key={path} className="space-y-2">
              <p className="font-mono text-xs break-all">{path}</p>
              <Notice tone="error" text={result.error} />
              <button
                type="button"
                onClick={() => removeRoot(path)}
                className="text-muted-foreground hover:text-foreground text-xs underline"
              >
                Retirer ce dossier
              </button>
            </div>
          );
        }

        if (result.project.error) {
          return <Notice key={path} tone="warning" text={`${basename(path)} — ${result.project.error}`} />;
        }

        if (result.project.kind === "notInitialized") {
          return (
            <Notice
              key={path}
              tone="warning"
              text={`${basename(path)} — aucun dépôt .git trouvé dans ce dossier ni dans ses sous-dossiers directs.`}
            />
          );
        }

        return null;
      })}

      {visible.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map(({ rootPath, sub }) => (
            <SubProjectCard
              key={sub.path}
              sub={sub}
              options={resolveOptions(prefs, sub.path)}
              onOptionsChange={(options) => updateOptions(sub.path, options)}
              onOpenDiff={() => setDiffTarget(sub)}
              onOpenCommit={() => setCommitTarget(sub)}
              onRunWorkflow={() => void runWorkflow(rootPath, sub)}
              running={Boolean(busy[sub.path])}
              result={logs[sub.path] ?? null}
            />
          ))}
        </div>
      )}

      <DiffViewer
        sub={diffTarget}
        open={diffTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDiffTarget(null);
        }}
      />

      <CommitAiModal
        sub={commitTarget}
        open={commitTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCommitTarget(null);
        }}
        options={commitTarget ? resolveOptions(prefs, commitTarget.path) : resolveOptions(prefs, "")}
        onFinished={(path, result) => setLogs((current) => ({ ...current, [path]: result }))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Notice({ tone, text }: { tone: "warning" | "error"; text: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
      )}
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" />
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
