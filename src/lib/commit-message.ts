import type { DiffBundle } from "@/types";

/**
 * Génération du message de commit.
 *
 * Deux stratégies cohabitent :
 * - `generateLocalCommitMessage` : analyse heuristique hors-ligne (Conventional
 *   Commits), utilisée tant qu'aucun provider IA n'est configuré ;
 * - `buildCommitPrompt` : prépare le diff destiné au LLM (tronqué à 4 Ko).
 *
 * À l'étape 3, la génération IA (côté Rust, pour ne pas exposer les clés) prendra
 * le relais avec repli automatique sur l'heuristique locale.
 */

/** Au-delà de cette taille, le diff est tronqué avant envoi au LLM. */
export const DIFF_MAX_BYTES = 4096;

/* ------------------------------------------------------------------ */
/* Préparation du diff pour le LLM                                     */
/* ------------------------------------------------------------------ */

export interface PreparedDiff {
  text: string;
  truncated: boolean;
  bytes: number;
}

const encoder = new TextEncoder();

/** Concatène index + répertoire de travail et tronque proprement si nécessaire. */
export function buildDiffForPrompt(bundle: DiffBundle): PreparedDiff {
  const raw = [bundle.staged, bundle.unstaged]
    .filter((part) => part.trim().length > 0)
    .join("\n");

  const bytes = encoder.encode(raw).length;
  if (bytes <= DIFF_MAX_BYTES) {
    return { text: raw, truncated: false, bytes };
  }

  // Approximation caractères → octets, suffisante pour rester sous la limite
  // (les caractères accentués pèsent 2 octets en UTF-8).
  let cut = raw.slice(0, DIFF_MAX_BYTES);
  if (encoder.encode(cut).length > DIFF_MAX_BYTES) {
    cut = cut.slice(0, Math.floor(DIFF_MAX_BYTES * 0.8));
  }

  // On coupe sur une fin de ligne pour ne pas casser un hunk en plein milieu.
  const lastBreak = cut.lastIndexOf("\n");
  if (lastBreak > 0) cut = cut.slice(0, lastBreak);

  return {
    text: `${cut}\n\n# … diff tronqué (${bytes} octets au total, ${DIFF_MAX_BYTES} envoyés)`,
    truncated: true,
    bytes,
  };
}

export function buildCommitUserPrompt(diff: PreparedDiff): string {
  const warning = diff.truncated
    ? "ATTENTION : ce diff est tronqué. Base-toi uniquement sur ce qui est visible.\n\n"
    : "";
  return `${warning}Voici le diff à résumer :\n\n${diff.text}`;
}

/* ------------------------------------------------------------------ */
/* Heuristique locale                                                  */
/* ------------------------------------------------------------------ */

interface FileStat {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
  isDeleted: boolean;
}

const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock)$/i;
const MANIFEST = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|tsconfig\.json)$/i;
const DOC = /\.(md|mdx|txt|rst)$/i;
const TEST = /(^|\/)(__tests__|tests?|e2e|spec)(\/|$)|\.(test|spec)\.[a-z]+$/i;
const STYLE = /\.(css|scss|sass|less|styl)$/i;
const CI = /(^|\/)\.github(\/|$)|\/\.gitlab-ci|circleci|\.ya?ml$/i;

// Dossiers trop génériques pour servir de scope à eux seuls.
const WEAK_SEGMENTS = new Set(["src", "lib", "app", "source", "code"]);

/** Extrait les fichiers touchés et leur compteur +/- depuis un diff unifié. */
export function parseDiff(diff: string): FileStat[] {
  const files: FileStat[] = [];
  let current: FileStat | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const path = match ? match[2] : line.slice("diff --git ".length);
      current = { path, added: 0, removed: 0, isNew: false, isDeleted: false };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("new file mode")) {
      current.isNew = true;
    } else if (line.startsWith("deleted file mode")) {
      current.isDeleted = true;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    } else if (line.startsWith("+")) {
      current.added += 1;
    } else if (line.startsWith("-")) {
      current.removed += 1;
    }
  }

  return files;
}

/** Les fichiers non suivis n'apparaissent pas dans `git diff` : on les ajoute. */
function withUntracked(files: FileStat[], untracked: string[]): FileStat[] {
  const known = new Set(files.map((file) => file.path));
  const extras = untracked
    .filter((path) => !known.has(path))
    .map<FileStat>((path) => ({ path, added: 0, removed: 0, isNew: true, isDeleted: false }));
  return [...files, ...extras];
}

function detectType(files: FileStat[], added: number, removed: number): string {
  const every = (test: (file: FileStat) => boolean) => files.length > 0 && files.every(test);

  if (every((file) => LOCKFILE.test(file.path) || MANIFEST.test(file.path))) return "chore";
  if (every((file) => DOC.test(file.path))) return "docs";
  if (every((file) => TEST.test(file.path))) return "test";
  if (every((file) => STYLE.test(file.path))) return "style";
  if (every((file) => CI.test(file.path))) return "ci";
  if (every((file) => file.isNew)) return "feat";
  if (every((file) => file.isDeleted)) return "chore";
  if (removed > added) return "fix";
  if (files.some((file) => file.isNew)) return "feat";
  return "refactor";
}

/** Plus long chemin commun, en ignorant les segments trop génériques. */
function commonScope(files: FileStat[]): string | null {
  if (files.length === 1) {
    const base = files[0].path.split("/").pop() ?? files[0].path;
    return base.replace(/\.[^.]+$/, "");
  }

  const directories = files.map((file) => file.path.split("/").slice(0, -1));
  const common: string[] = [];
  for (let depth = 0; ; depth += 1) {
    const segment = directories[0][depth];
    if (!segment || !directories.every((parts) => parts[depth] === segment)) break;
    common.push(segment);
  }

  for (let index = common.length - 1; index >= 0; index -= 1) {
    if (!WEAK_SEGMENTS.has(common[index])) return common[index];
  }
  return null;
}

function buildSubject(files: FileStat[], scope: string | null): string {
  if (files.length === 1) {
    const [file] = files;
    const label = scope ?? "file";
    if (file.isDeleted) return `remove ${label}`;
    if (file.isNew) return `add ${label}`;
    return `update ${label}`;
  }
  const label = scope ? ` in ${scope}` : "";
  if (files.every((file) => file.isNew)) return `add ${files.length} files${label}`;
  return `update ${files.length} files${label}`;
}

/**
 * Message de commit heuristique, au format Conventional Commits.
 * Renvoie une chaîne vide s'il n'y a aucune modification à décrire.
 */
export function generateLocalCommitMessage(bundle: DiffBundle): string {
  const parsed = parseDiff(`${bundle.staged}\n${bundle.unstaged}`);
  const files = withUntracked(parsed, bundle.untracked);
  if (files.length === 0) return "";

  const added = files.reduce((total, file) => total + file.added, 0);
  const removed = files.reduce((total, file) => total + file.removed, 0);
  const scope = commonScope(files);
  const type = detectType(files, added, removed);
  const subject = buildSubject(files, scope);

  const header = `${type}${scope ? `(${scope})` : ""}: ${subject}`;
  const body = files
    .slice(0, 8)
    .map((file) => `- ${file.path}`)
    .join("\n");
  const more = files.length > 8 ? `\n- … et ${files.length - 8} autre(s)` : "";

  return `${header}\n\n${body}${more}`;
}

/** Indique si un bundle ne contient aucune modification. */
export function isEmptyDiff(bundle: DiffBundle): boolean {
  return (
    bundle.staged.trim().length === 0 &&
    bundle.unstaged.trim().length === 0 &&
    bundle.untracked.length === 0
  );
}
