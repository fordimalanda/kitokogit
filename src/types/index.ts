/**
 * Types partagés entre le frontend Next.js et le backend Rust (Tauri).
 *
 * Toutes les structures Rust sont sérialisées en `camelCase` via
 * `#[serde(rename_all = "camelCase")]`, donc les interfaces ci-dessous
 * correspondent exactement à ce que renvoient les commandes `invoke`.
 */

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

export type ProjectKind = "repository" | "monorepo" | "notInitialized";

export interface SubProject {
  /** Nom du dossier (ex: `ado-frontend`). */
  name: string;
  /** Chemin absolu du dépôt. */
  path: string;
  /** Vrai si un dossier/fichier `.git` a été détecté. */
  hasGit: boolean;
  /** Branche courante, `null` si le dépôt n'a encore aucun commit. */
  branch: string | null;
  /** URL du remote `origin`, `null` si absent. */
  remote: string | null;
  /** Vrai si au moins un remote est configuré. */
  hasRemote: boolean;
  /** Nombre de fichiers modifiés (non indexés). */
  modifiedFiles: number;
  /** Nombre de fichiers indexés (staged). */
  stagedFiles: number;
  /** Nombre de fichiers non suivis. */
  untrackedFiles: number;
  /** Nombre de commits locaux non poussés. */
  ahead: number;
  /** Nombre de commits distants non récupérés. */
  behind: number;
  /** Message d'erreur si le dépôt distant est inaccessible (sans planter l'app). */
  remoteError: string | null;
}

export interface ProjectInfo {
  name: string;
  path: string;
  kind: ProjectKind;
  subProjects: SubProject[];
  /** Erreur non bloquante rencontrée pendant le scan. */
  error: string | null;
}

export interface FileChange {
  path: string;
  /** Statut sur 2 caractères tel que renvoyé par `git status --porcelain=v2`. */
  status: string;
}

export interface GitStatus {
  path: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  hasCommits: boolean;
  remote: string | null;
  remoteError: string | null;
}

export interface GitOperationResult {
  success: boolean;
  /** Journal lisible des étapes exécutées (`git add`, `git commit`, …). */
  steps: string[];
  commitHash: string | null;
  error: GitError | null;
}

/** Erreur Git structurée : ne fait jamais planter l'application. */
export interface GitError {
  /** `not_a_repository`, `push_rejected`, `network`, `remote_not_found`, … */
  kind: string;
  message: string;
  /** Sortie stderr complète de Git, à afficher dans les logs. */
  details: string | null;
}

/* ------------------------------------------------------------------ */
/* Providers IA                                                        */
/* ------------------------------------------------------------------ */

export type ProviderId = "openai" | "claude" | "gemini" | "deepseek" | "ollama";

export interface ProviderKeyStatus {
  provider: ProviderId;
  /** Vrai si une clé est enregistrée côté OS. La clé n'est jamais renvoyée. */
  hasKey: boolean;
}
