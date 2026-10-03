import { buildDiffForPrompt, generateLocalCommitMessage } from "@/lib/commit-message";
import { asStructuredError, isTauri, tauri } from "@/lib/tauri-bridge";
import type { AiError, AppSettings, DiffBundle } from "@/types";

/**
 * Orchestration de la génération de message de commit.
 *
 * 1. On tente le provider IA configuré — l'appel HTTP est fait par Rust, la clé
 *    ne quitte donc jamais la machine.
 * 2. En cas d'échec (hors-ligne, clé absente, quota…), on bascule
 *    automatiquement sur l'heuristique locale, en conservant la raison.
 */

export interface CommitGeneration {
  message: string;
  /** `ai` si un provider a répondu, `local` si l'heuristique a pris le relais. */
  origin: "ai" | "local";
  provider: string | null;
  model: string | null;
  /** Erreur qui a déclenché le repli local, le cas échéant. */
  warning: AiError | null;
  diffBytes: number;
  truncated: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider: "openai",
  models: {},
  customPrompt: "",
  ollamaBaseUrl: "http://localhost:11434",
  fallbackToLocal: true,
};

/** Charge les réglages, avec repli sur les valeurs par défaut. */
export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) return DEFAULT_SETTINGS;
  try {
    const settings = await tauri.getSettings();
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      models: settings.models ?? {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Modèle effectif pour le provider courant (`null` ⇒ défaut du provider). */
export function modelFor(settings: AppSettings): string | null {
  const value = settings.models?.[settings.provider];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export async function generateCommitMessage(
  path: string,
  bundle: DiffBundle | null,
  settings: AppSettings
): Promise<CommitGeneration> {
  if (isTauri()) {
    try {
      const result = await tauri.generateCommitMessage(
        path,
        settings.provider,
        modelFor(settings),
        settings.customPrompt?.trim() ? settings.customPrompt : null,
        settings.provider === "ollama" ? settings.ollamaBaseUrl : null
      );

      return {
        message: result.message,
        origin: "ai",
        provider: result.provider,
        model: result.model,
        warning: null,
        diffBytes: result.diffBytes,
        truncated: result.truncated,
      };
    } catch (error) {
      const warning =
        asStructuredError(error) ??
        ({ kind: "unexpected", message: String(error), details: null } satisfies AiError);

      if (!settings.fallbackToLocal) throw error;
      return localFallback(path, bundle, warning);
    }
  }

  return localFallback(path, bundle, null);
}

/** Repli hors-ligne : heuristique Conventional Commits calculée en local. */
async function localFallback(
  path: string,
  bundle: DiffBundle | null,
  warning: AiError | null
): Promise<CommitGeneration> {
  const source = bundle ?? (await tauri.getDiffBundle(path));
  const prepared = buildDiffForPrompt(source);

  return {
    message: generateLocalCommitMessage(source),
    origin: "local",
    provider: null,
    model: null,
    warning,
    diffBytes: prepared.bytes,
    truncated: prepared.truncated,
  };
}
