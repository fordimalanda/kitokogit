import { invoke } from "@tauri-apps/api/core";

import type { GitError, GitStatus, ProjectInfo, ProviderKeyStatus } from "@/types";

/**
 * Couche unique d'accès au backend Rust.
 *
 * Aucun composant ne doit appeler `invoke` directement : tout passe par ici,
 * ce qui garde les noms de commandes et les types au même endroit.
 */

/** Vrai si l'application tourne bien dans la webview Tauri (et pas dans un navigateur). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Transforme une erreur Rust (`GitError`) en message affichable. */
export function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const gitError = error as GitError;
    const details = gitError.details ? `\n${gitError.details}` : "";
    return `${gitError.message}${details}`;
  }
  return String(error);
}

export const tauri = {
  /* ---- Diagnostic ---- */
  gitVersion: () => invoke<string>("git_version"),

  /* ---- Scan de projets ---- */
  scanProject: (path: string) => invoke<ProjectInfo>("scan_project", { path }),
  discoverRepositories: (root: string, maxDepth = 3) =>
    invoke<string[]>("discover_repositories", { root, maxDepth }),

  /* ---- Lecture Git ---- */
  gitStatus: (path: string) => invoke<GitStatus>("git_status", { path }),
  getGitDiff: (path: string, staged = false) =>
    invoke<string>("get_git_diff", { path, staged }),

  /* ---- Écriture Git ---- */
  gitInit: (path: string) => invoke<string[]>("git_init", { path }),
  gitAddAll: (path: string) => invoke<string[]>("git_add_all", { path }),
  gitCommit: (path: string, message: string) =>
    invoke<string[]>("git_commit", { path, message }),
  gitPush: (path: string) => invoke<string[]>("git_push", { path }),

  /* ---- Clés API (stockées côté OS, jamais renvoyées au webview) ---- */
  listApiKeyStatus: () => invoke<ProviderKeyStatus[]>("list_api_key_status"),
  setApiKey: (provider: string, apiKey: string) =>
    invoke<void>("set_api_key", { provider, apiKey }),
  deleteApiKey: (provider: string) => invoke<void>("delete_api_key", { provider }),
};
