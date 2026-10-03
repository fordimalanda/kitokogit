"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderSearch, ListChecks, LoaderCircle, TriangleAlert } from "lucide-react";

import { CommitAiModal } from "@/components/commit-ai-modal";
import { DiffViewer } from "@/components/diff-viewer";
import { GLOBAL_VIEW, ProjectHeader, type ProjectTab } from "@/components/project-header";
import { SubProjectCard } from "@/components/sub-project-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isEmptyDiff } from "@/lib/commit-message";
import {
  DEFAULT_SETTINGS,
  generateCommitMessage,
  loadSettings,
  type CommitGeneration,
} from "@/lib/generate-commit";
import { asStructuredError, describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import {
  loadWorkflowPrefs,
  resolveOptions,
  saveWorkflowPrefs,
  type WorkflowPrefs,
} from "@/lib/workflow-prefs";
import { cn } from "@/lib/utils";
import type {
  AppSettings,
  GitError,
  GitOperationResult,
  HistoryEntry,
  ProjectInfo,
  SubProject,
  WorkflowOptions,
} from "@/types";

const ROOTS_KEY = "kitokogit-roots";
const AUTO_REFRESH_KEY = "kitokogit-auto-refresh";

/** Intervalle du suivi automatique (ms). Suffisamment court pour paraître
 *  instantané, assez long pour rester invisible en consommation. */
const AUTO_REFRESH_MS = 2500;

/** Nombre de fichiers en attente de traitement pour un sous-projet. */
function pendingChanges(sub: SubProject): number {
  return sub.stagedFiles + sub.modifiedFiles + sub.untrackedFiles;
}

type ScanResult = { ok: true; project: ProjectInfo } | { ok: false; error: string };
type Logs = Record<string, GitOperationResult | null>;
type Busy = Record<string, boolean>;

/** Progression de l'orchestration « Run All » d'un dossier racine. */
interface RunAllState {
  rootPath: string;
  done: number;
  total: number;
  current: string;
}

export default function ProjectsPage() {
  const [roots, setRoots] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, ScanResult>>({});
  const [active, setActive] = useState<string>(GLOBAL_VIEW);
  const [prefs, setPrefs] = useState<WorkflowPrefs>({});
  const [diffTarget, setDiffTarget] = useState<SubProject | null>(null);
  const [commitTarget, setCommitTarget] = useState<SubProject | null>(null);
  const [logs, setLogs] = useState<Logs>({});
  const [busy, setBusy] = useState<Busy>({});
  const [pulling, setPulling] = useState<Busy>({});
  const [runAll, setRunAll] = useState<RunAllState | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [autoRefresh, setAutoRefresh] = useState(true);

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
    void loadSettings().then(setSettings);
    if (window.localStorage.getItem(AUTO_REFRESH_KEY) === "false") setAutoRefresh(false);
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

  function toggleAutoRefresh(value: boolean) {
    setAutoRefresh(value);
    window.localStorage.setItem(AUTO_REFRESH_KEY, String(value));
  }

  /**
   * Suivi automatique : rescanne régulièrement les dossiers racine pour que
   * l'état Git affiché reste vrai sans aucune action de l'utilisateur.
   *
   * Le rafraîchissement est suspendu quand la fenêtre est masquée et déclenché
   * immédiatement au retour au premier plan.
   */
  useEffect(() => {
    if (!autoRefresh || !isTauri() || roots.length === 0) return;

    let cancelled = false;

    const tick = async () => {
      if (document.hidden) return;
      try {
        const refreshed = await tauri.refreshProjects(roots);
        if (cancelled) return;

        setResults((current) => {
          const next = { ...current };
          for (const item of refreshed) {
            next[item.root] = item.project
              ? { ok: true, project: item.project }
              : { ok: false, error: item.error ?? "Dossier illisible" };
          }
          return next;
        });
      } catch {
        // Un échec de rafraîchissement ne doit jamais interrompre l'utilisateur.
      }
    };

    const timer = window.setInterval(() => void tick(), AUTO_REFRESH_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [autoRefresh, roots]);

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

  /**
   * Association « dossier racine → sous-projet ».
   * Déclarée avant les callbacks de workflow, qui s'appuient dessus.
   */
  const pairs = useMemo(() => {
    const list: { rootPath: string; sub: SubProject }[] = [];
    for (const [rootPath, result] of Object.entries(results)) {
      if (result.ok) {
        for (const sub of result.project.subProjects) list.push({ rootPath, sub });
      }
    }
    return list;
  }, [results]);

  /* ---------------- Préférences ---------------- */

  function updateOptions(path: string, options: WorkflowOptions) {
    const next = { ...prefs, [path]: options };
    setPrefs(next);
    saveWorkflowPrefs(next);
  }

  /* ---------------- Workflow ---------------- */

  /** Ajoute une entrée au journal local (best-effort : jamais bloquant). */
  const recordHistory = useCallback(
    async (sub: SubProject, generation: CommitGeneration, result: GitOperationResult) => {
      const entry: HistoryEntry = {
        id: `${Date.now()}-${sub.name}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        projectPath: sub.path,
        projectName: sub.name,
        branch: sub.branch,
        provider: generation.provider,
        model: generation.model,
        message: generation.message,
        commitHash: result.commitHash,
        origin: generation.origin,
        success: result.success,
      };

      try {
        await tauri.historyAdd(entry);
      } catch {
        // Le journal est accessoire : une erreur d'écriture ne doit pas
        // invalider un commit réussi.
      }
    },
    []
  );

  /**
   * Exécute la chaîne complète sur un sous-projet.
   *
   * Le traitement est séquentiel, y compris pour « Run All » : le journal reste
   * lisible, le provider IA n'est pas saturé de requêtes simultanées et deux
   * commits ne peuvent pas partir en parallèle sur le même dépôt.
   */
  const executeWorkflow = useCallback(
    async (rootPath: string, sub: SubProject) => {
      const options = resolveOptions(prefs, sub.path);
      setBusy((current) => ({ ...current, [sub.path]: true }));

      try {
        if (!options.autoCommit) {
          const result = await tauri.runGitWorkflow(
            sub.path,
            options.autoAdd,
            null,
            options.autoPush
          );
          setLogs((current) => ({ ...current, [sub.path]: result }));
          return;
        }

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

        // Génération IA côté Rust ; repli automatique sur l'heuristique locale
        // si le provider est injoignable ou non configuré.
        const generation = await generateCommitMessage(sub.path, bundle, settings);

        const result = await tauri.runGitWorkflow(
          sub.path,
          options.autoAdd,
          generation.message,
          options.autoPush
        );
        setLogs((current) => ({ ...current, [sub.path]: result }));
        await recordHistory(sub, generation, result);
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
    [prefs, settings, scan, recordHistory]
  );

  /** Synchronise un dépôt avec son remote (`git pull`). */
  const pull = useCallback(
    async (rootPath: string, sub: SubProject) => {
      setPulling((current) => ({ ...current, [sub.path]: true }));
      try {
        const steps = await tauri.gitPull(sub.path, null);
        setLogs((current) => ({
          ...current,
          [sub.path]: { success: true, steps, commitHash: null, error: null },
        }));
      } catch (error) {
        const structured = asStructuredError(error);
        setLogs((current) => ({
          ...current,
          [sub.path]: {
            success: false,
            steps: [],
            commitHash: null,
            error:
              structured ??
              ({ kind: "unexpected", message: String(error), details: null } satisfies GitError),
          },
        }));
      } finally {
        setPulling((current) => ({ ...current, [sub.path]: false }));
        void scan(rootPath);
      }
    },
    [scan]
  );

  /** « Run All » : enchaîne les sous-projets du dossier qui ont des modifications. */
  const runAllFor = useCallback(
    async (rootPath: string) => {
      const targets = pairs
        .filter((pair) => pair.rootPath === rootPath)
        .map((pair) => pair.sub)
        .filter((sub) => sub.stagedFiles + sub.modifiedFiles + sub.untrackedFiles > 0);

      if (targets.length === 0) return;

      setRunAll({ rootPath, done: 0, total: targets.length, current: targets[0].name });
      try {
        for (let index = 0; index < targets.length; index += 1) {
          const sub = targets[index];
          setRunAll({ rootPath, done: index, total: targets.length, current: sub.name });
          await executeWorkflow(rootPath, sub);
        }
      } finally {
        setRunAll(null);
      }
    },
    [pairs, executeWorkflow]
  );

  /* ---------------- Données dérivées ---------------- */

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
          changedCount: project?.subProjects.filter((sub) => pendingChanges(sub) > 0).length ?? 0,
        };
      }),
    [roots, results]
  );

  const visible = active === GLOBAL_VIEW ? pairs : pairs.filter((pair) => pair.rootPath === active);

  /** Nombre de sous-projets du dossier sélectionné ayant des modifications. */
  const pendingCount = useMemo(
    () =>
      active === GLOBAL_VIEW
        ? 0
        : pairs.filter(
            (pair) =>
              pair.rootPath === active &&
              pair.sub.stagedFiles + pair.sub.modifiedFiles + pair.sub.untrackedFiles > 0
          ).length,
    [pairs, active]
  );

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
        autoRefresh={autoRefresh}
        onAutoRefreshChange={toggleAutoRefresh}
      />

      {active !== GLOBAL_VIEW && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="size-4" />
              Orchestration multi-dépôts
            </p>
            <p className="text-muted-foreground text-xs">
              {pendingCount === 0
                ? "Aucune modification détectée dans les sous-projets de ce dossier."
                : `${pendingCount} sous-projet(s) avec des modifications, traités séquentiellement (Add → Commit IA → Push).`}
            </p>
          </div>

          {runAll && (
            <span className="text-muted-foreground text-xs">
              {runAll.done + 1}/{runAll.total} · {runAll.current}
            </span>
          )}

          <Button
            size="sm"
            onClick={() => void runAllFor(active)}
            disabled={pendingCount === 0 || runAll !== null}
          >
            {runAll ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <ListChecks data-icon="inline-start" />
            )}
            {pendingCount > 0
              ? `Valider et pousser (${pendingCount})`
              : "Valider et pousser"}
          </Button>
        </div>
      )}

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
              onRunWorkflow={() => void executeWorkflow(rootPath, sub)}
              onPull={() => void pull(rootPath, sub)}
              running={Boolean(busy[sub.path])}
              pulling={Boolean(pulling[sub.path])}
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
