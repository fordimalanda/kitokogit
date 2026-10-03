import type { WorkflowOptions } from "@/types";

/**
 * Préférences de la chaîne `add → commit → push`.
 *
 * Trois niveaux de priorité, du plus faible au plus fort :
 *   1. `DEFAULT_OPTIONS`
 *   2. les réglages globaux (clé `"*"`)
 *   3. les réglages du sous-projet (clé = chemin absolu)
 */

export const DEFAULT_OPTIONS: WorkflowOptions = {
  autoAdd: true,
  autoCommit: true,
  // Le push est désactivé par défaut : c'est l'action la plus difficile à annuler.
  autoPush: false,
};

export const GLOBAL_SCOPE = "*";

const STORAGE_KEY = "kitokogit-workflow";

export type WorkflowPrefs = Record<string, WorkflowOptions>;

export function loadWorkflowPrefs(): WorkflowPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as WorkflowPrefs;
  } catch {
    return {};
  }
}

export function saveWorkflowPrefs(prefs: WorkflowPrefs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** Fusionne défauts → global → projet pour obtenir les options effectives. */
export function resolveOptions(prefs: WorkflowPrefs, path: string): WorkflowOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...prefs[GLOBAL_SCOPE],
    ...prefs[path],
  };
}

/** Indique si le sous-projet a des réglages propres (hors héritage global). */
export function hasOwnOptions(prefs: WorkflowPrefs, path: string): boolean {
  return Boolean(prefs[path]);
}
