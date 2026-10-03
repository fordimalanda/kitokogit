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

/** Tout ce qui peut partir dans un commit, en un seul aller-retour. */
export interface DiffBundle {
  /** Modifications déjà indexées (`git diff --cached`). */
  staged: string;
  /** Modifications non indexées, résumé des fichiers non suivis inclus. */
  unstaged: string;
  /** Fichiers non suivis (contenu non inclus). */
  untracked: string[];
}

/** Options de la chaîne automatique, globales ou par projet. */
export interface WorkflowOptions {
  autoAdd: boolean;
  autoCommit: boolean;
  autoPush: boolean;
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

/** Catalogue des providers, fourni par le backend Rust (source de vérité). */
export interface AiProviderInfo {
  id: ProviderId;
  label: string;
  description: string;
  /** `false` pour Ollama : un modèle local n'a pas besoin de clé API. */
  requiresKey: boolean;
  defaultModel: string;
  models: string[];
  /** Page où l'utilisateur génère sa clé. */
  docs: string;
}

/** Erreur renvoyée par le module IA (`generate_commit_message`, tests…). */
export interface AiError {
  kind: string;
  message: string;
  details: string | null;
}

/** Message de commit produit par un provider IA. */
export interface GeneratedCommit {
  message: string;
  provider: string;
  model: string;
  diffBytes: number;
  truncated: boolean;
}

/** Résultat d'un test de connexion à un provider. */
export interface ConnectionTest {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  sample: string;
}

/** Réglages non secrets, persistés par Rust dans `settings.json`. */
export interface AppSettings {
  provider: ProviderId;
  /** Modèle retenu par provider. Absent ⇒ modèle par défaut du provider. */
  models: Record<string, string>;
  customPrompt: string;
  ollamaBaseUrl: string;
  fallbackToLocal: boolean;
}

/* ------------------------------------------------------------------ */
/* Historique des commits                                              */
/* ------------------------------------------------------------------ */

/** Une entrée du journal local (20 dernières, `history.json`). */
export interface HistoryEntry {
  id: string;
  /** Horodatage Unix en millisecondes. */
  timestamp: number;
  projectPath: string;
  projectName: string;
  branch: string | null;
  /** `null` si le message vient de l'heuristique locale. */
  provider: string | null;
  model: string | null;
  message: string;
  commitHash: string | null;
  origin: "ai" | "local";
  success: boolean;
}
