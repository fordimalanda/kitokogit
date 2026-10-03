import { invoke } from "@tauri-apps/api/core";

import type {
  AiProviderInfo,
  AppSettings,
  ConnectionTest,
  DiffBundle,
  GeneratedCommit,
  GitOperationResult,
  GitStatus,
  HistoryEntry,
  ProjectInfo,
  ProviderKeyStatus,
} from "@/types";

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

/** Transforme une erreur Rust (`GitError`/`AiError`) en message affichable. */
export function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const details = "details" in error && error.details ? `\n${String(error.details)}` : "";
    return `${String((error as { message: unknown }).message)}${details}`;
  }
  return String(error);
}

/**
 * Normalise une erreur structurée venue de Rust
 * (`{ kind, message, details }`) pour pouvoir raisonner sur le `kind`.
 */
export function asStructuredError(
  error: unknown
): { kind: string; message: string; details: string | null } | null {
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    const value = error as { kind: unknown; message: unknown; details?: unknown };
    return {
      kind: String(value.kind),
      message: String(value.message),
      details: value.details ? String(value.details) : null,
    };
  }
  return null;
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
  getDiffBundle: (path: string) => invoke<DiffBundle>("get_diff_bundle", { path }),

  /* ---- Écriture Git ---- */
  gitInit: (path: string) => invoke<string[]>("git_init", { path }),
  gitAddAll: (path: string) => invoke<string[]>("git_add_all", { path }),
  gitCommit: (path: string, message: string) =>
    invoke<string[]>("git_commit", { path, message }),
  gitPush: (path: string) => invoke<string[]>("git_push", { path }),
  gitPull: (path: string, rebase: boolean | null = null) =>
    invoke<string[]>("git_pull", { path, rebase }),
  runGitWorkflow: (path: string, doAdd: boolean, message: string | null, doPush: boolean) =>
    invoke<GitOperationResult>("run_git_workflow", { path, doAdd, message, doPush }),

  /* ---- Journal des commits ---- */
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyAdd: (entry: HistoryEntry) => invoke<HistoryEntry[]>("history_add", { entry }),
  historyClear: () => invoke<void>("history_clear"),

  /* ---- Clés API (stockées côté OS, jamais renvoyées au webview) ---- */
  listApiKeyStatus: () => invoke<ProviderKeyStatus[]>("list_api_key_status"),
  setApiKey: (provider: string, apiKey: string) =>
    invoke<void>("set_api_key", { provider, apiKey }),
  deleteApiKey: (provider: string) => invoke<void>("delete_api_key", { provider }),

  /* ---- Réglages non secrets ---- */
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<void>("save_settings", { settings }),

  /* ---- Intelligence artificielle (appels HTTP côté Rust) ---- */
  aiProviders: () => invoke<AiProviderInfo[]>("ai_providers"),
  generateCommitMessage: (
    path: string,
    provider: string,
    model: string | null,
    customPrompt: string | null,
    ollamaBaseUrl: string | null
  ) =>
    invoke<GeneratedCommit>("generate_commit_message", {
      path,
      provider,
      model,
      customPrompt,
      ollamaBaseUrl,
    }),
  testProviderConnection: (provider: string, model: string | null, ollamaBaseUrl: string | null) =>
    invoke<ConnectionTest>("test_provider_connection", { provider, model, ollamaBaseUrl }),
  listOllamaModels: (baseUrl: string | null) =>
    invoke<string[]>("list_ollama_models", { baseUrl }),
};
