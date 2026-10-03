import type { ProviderId } from "@/types";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  description: string;
  /** `false` pour Ollama : un modèle local n'a pas besoin de clé API. */
  requiresKey: boolean;
  defaultModel: string;
  /** Page où l'utilisateur génère sa clé. */
  docs: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT-4o et GPT-4.1",
    requiresKey: true,
    defaultModel: "gpt-4o-mini",
    docs: "https://platform.openai.com/api-keys",
  },
  {
    id: "claude",
    label: "Anthropic Claude",
    description: "Claude Sonnet / Haiku",
    requiresKey: true,
    defaultModel: "claude-sonnet-4-20250514",
    docs: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 2.5 Flash / Pro",
    requiresKey: true,
    defaultModel: "gemini-2.5-flash",
    docs: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "deepseek-chat",
    requiresKey: true,
    defaultModel: "deepseek-chat",
    docs: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    description: "Modèles exécutés sur votre machine",
    requiresKey: false,
    defaultModel: "llama3.1",
    docs: "https://ollama.com/download",
  },
];

/**
 * Prompt système strict : le modèle doit renvoyer *uniquement* le message de
 * commit, au format Conventional Commits, sans phrase d'introduction ni de
 * conclusion. Le nettoyage est refait côté Rust en filet de sécurité.
 */
export const COMMIT_SYSTEM_PROMPT = `Tu es un expert Git. À partir du diff fourni, rédige UN SEUL message de commit.

Règles strictes :
- Format Conventional Commits : type(scope): description
- Types autorisés : feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Première ligne : 72 caractères maximum, à l'impératif, en anglais, sans point final
- Si les changements sont nombreux, ajoute un corps séparé par une ligne vide
- Ne renvoie JAMAIS de balises Markdown, de guillemets englobants, ni de phrase
  d'introduction ou de conclusion
- Réponds uniquement avec le message de commit, rien d'autre`;

export const DIFF_MAX_BYTES = 4096;
