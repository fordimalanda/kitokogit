"use client";

import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  KeyRound,
  LoaderCircle,
  Plug,
  Save,
  ShieldCheck,
  Sparkles,
  Trash,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  modelFor,
} from "@/lib/generate-commit";
import { asStructuredError, describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import type { AiProviderInfo, AppSettings, ConnectionTest, ProviderKeyStatus } from "@/types";

type TestOutcome =
  | { status: "ok"; result: ConnectionTest }
  | { status: "error"; message: string; details: string | null };

export default function SettingsPage() {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState<Record<string, TestOutcome | null>>({});
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---------------- Chargement ---------------- */

  useEffect(() => {
    if (!isTauri()) {
      setError("Webview Tauri non détectée : lancez « npm run tauri dev ».");
      setLoading(false);
      return;
    }

    let cancelled = false;
    Promise.all([tauri.aiProviders(), loadSettings(), tauri.listApiKeyStatus()])
      .then(([catalog, stored, statuses]) => {
        if (cancelled) return;
        setProviders(catalog);
        setSettings(stored);
        setHasKey(
          Object.fromEntries((statuses as ProviderKeyStatus[]).map((item) => [item.provider, item.hasKey]))
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- Persistance ---------------- */

  const persist = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      await tauri.saveSettings(next);
    } catch (cause) {
      setError(describeError(cause));
    }
  }, []);

  function patch(changes: Partial<AppSettings>) {
    void persist({ ...settings, ...changes });
  }

  function setModel(providerId: string, model: string) {
    patch({ models: { ...settings.models, [providerId]: model } });
  }

  /* ---------------- Clés API ---------------- */

  async function saveKey(providerId: string) {
    const value = (drafts[providerId] ?? "").trim();
    if (!value) return;
    try {
      await tauri.setApiKey(providerId, value);
      setHasKey((current) => ({ ...current, [providerId]: true }));
      setDrafts((current) => ({ ...current, [providerId]: "" }));
      setOutcomes((current) => ({ ...current, [providerId]: null }));
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function deleteKey(providerId: string) {
    try {
      await tauri.deleteApiKey(providerId);
      setHasKey((current) => ({ ...current, [providerId]: false }));
      setOutcomes((current) => ({ ...current, [providerId]: null }));
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  /* ---------------- Test de connexion ---------------- */

  async function test(providerId: string) {
    setTesting((current) => ({ ...current, [providerId]: true }));
    setOutcomes((current) => ({ ...current, [providerId]: null }));
    try {
      const result = await tauri.testProviderConnection(
        providerId,
        settings.models?.[providerId]?.trim() || null,
        providerId === "ollama" ? settings.ollamaBaseUrl : null
      );
      setOutcomes((current) => ({ ...current, [providerId]: { status: "ok", result } }));
    } catch (cause) {
      const structured = asStructuredError(cause);
      setOutcomes((current) => ({
        ...current,
        [providerId]: {
          status: "error",
          message: structured?.message ?? String(cause),
          details: structured?.details ?? null,
        },
      }));
    } finally {
      setTesting((current) => ({ ...current, [providerId]: false }));
    }
  }

  async function refreshOllama() {
    try {
      setOllamaModels(await tauri.listOllamaModels(settings.ollamaBaseUrl));
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  /* ---------------- Rendu ---------------- */

  return (
    <div className="space-y-4">
      {/* Rappel de sécurité */}
      <div className="bg-muted/40 flex items-start gap-3 rounded-lg border px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <div className="text-sm">
          <p className="font-medium">Vos clés ne quittent jamais la machine</p>
          <p className="text-muted-foreground text-xs">
            Elles sont stockées par le backend Rust dans le gestionnaire d&apos;identifiants du
            système. Les appels aux providers sont également faits par Rust : la webview ne voit
            jamais ni la clé, ni votre code source.
          </p>
        </div>
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {loading && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" />
          Chargement des providers…
        </p>
      )}

      {/* Providers */}
      {providers.map((provider) => {
        const isDefault = settings.provider === provider.id;
        const outcome = outcomes[provider.id] ?? null;
        const configured = !provider.requiresKey || hasKey[provider.id];

        return (
          <Card key={provider.id} className={cn("gap-4", isDefault && "ring-primary/40 ring-1")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="text-muted-foreground size-4" />
                {provider.label}
                {isDefault && <Badge variant="info">par défaut</Badge>}
                {configured ? (
                  <Badge variant="success">prêt</Badge>
                ) : (
                  <Badge variant="warning">non configuré</Badge>
                )}
              </CardTitle>
              <CardDescription>
                {provider.description} ·{" "}
                <button
                  type="button"
                  className="text-foreground inline-flex items-center gap-1 underline"
                  onClick={() => void openUrl(provider.docs)}
                >
                  obtenir une clé
                  <ExternalLink className="size-3" />
                </button>
              </CardDescription>
              <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-2 self-start justify-self-end">
                <Button
                  variant={isDefault ? "secondary" : "outline"}
                  size="sm"
                  disabled={isDefault}
                  onClick={() => patch({ provider: provider.id })}
                >
                  <Sparkles data-icon="inline-start" />
                  {isDefault ? "Provider par défaut" : "Utiliser"}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {/* Clé API */}
              {provider.requiresKey && (
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-64 flex-1">
                    <Input
                      type={revealed[provider.id] ? "text" : "password"}
                      value={drafts[provider.id] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [provider.id]: event.currentTarget.value,
                        }))
                      }
                      placeholder={
                        hasKey[provider.id]
                          ? "•••••••••• (clé enregistrée — collez pour remplacer)"
                          : "Collez votre clé API"
                      }
                      aria-label={`Clé API ${provider.label}`}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      aria-label={revealed[provider.id] ? "Masquer la clé" : "Afficher la clé"}
                      onClick={() =>
                        setRevealed((current) => ({
                          ...current,
                          [provider.id]: !current[provider.id],
                        }))
                      }
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                    >
                      <Eye className="size-4" />
                    </button>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => void saveKey(provider.id)}
                    disabled={!(drafts[provider.id] ?? "").trim()}
                  >
                    <Save data-icon="inline-start" />
                    Enregistrer
                  </Button>

                  {hasKey[provider.id] && (
                    <Button variant="outline" size="sm" onClick={() => void deleteKey(provider.id)}>
                      <Trash data-icon="inline-start" />
                      Supprimer
                    </Button>
                  )}
                </div>
              )}

              {/* Modèle + test */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  list={`models-${provider.id}`}
                  value={settings.models?.[provider.id] ?? ""}
                  onChange={(event) => setModel(provider.id, event.currentTarget.value)}
                  placeholder={`${provider.defaultModel} (défaut)`}
                  aria-label={`Modèle ${provider.label}`}
                  className="min-w-56 flex-1"
                />
                <datalist id={`models-${provider.id}`}>
                  {provider.models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                  {provider.id === "ollama" &&
                    ollamaModels.map((model) => <option key={model} value={model} />)}
                </datalist>

                {provider.id === "ollama" && (
                  <Button variant="ghost" size="sm" onClick={() => void refreshOllama()}>
                    <LoaderCircle data-icon="inline-start" />
                    Modèles installés
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void test(provider.id)}
                  disabled={testing[provider.id] || !configured}
                >
                  {testing[provider.id] ? (
                    <LoaderCircle data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Plug data-icon="inline-start" />
                  )}
                  Tester
                </Button>
              </div>

              {/* Résultat du test */}
              {outcome?.status === "ok" && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <CircleCheck className="mt-px size-3.5 shrink-0" />
                  <span>
                    Connexion réussie en {outcome.result.latencyMs} ms ·{" "}
                    <code>{outcome.result.model}</code>
                    {outcome.result.sample ? ` · « ${outcome.result.sample} »` : ""}
                  </span>
                </div>
              )}

              {outcome?.status === "error" && (
                <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
                  <CircleAlert className="mt-px size-3.5 shrink-0" />
                  <div className="min-w-0 space-y-1">
                    <p>{outcome.message}</p>
                    {outcome.details && (
                      <pre className="text-muted-foreground max-h-24 overflow-auto font-mono text-[0.65rem] whitespace-pre-wrap">
                        {outcome.details}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Réglages globaux */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Réglages globaux</CardTitle>
          <CardDescription>
            Ces valeurs s&apos;appliquent à tous les dépôts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="custom-prompt" className="text-xs font-medium">
              Consignes supplémentaires pour l&apos;IA
            </label>
            <textarea
              id="custom-prompt"
              value={settings.customPrompt}
              onChange={(event) => patch({ customPrompt: event.currentTarget.value })}
              rows={3}
              spellCheck={false}
              placeholder="Ex : les commits de ce projet sont en français, scope toujours en minuscules…"
              className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border px-3 py-2 text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ollama-url" className="text-xs font-medium">
              Adresse du serveur Ollama
            </label>
            <Input
              id="ollama-url"
              value={settings.ollamaBaseUrl}
              onChange={(event) => patch({ ollamaBaseUrl: event.currentTarget.value })}
              placeholder="http://localhost:11434"
              className="max-w-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Repli hors-ligne automatique</p>
              <p className="text-muted-foreground text-xs">
                Si l&apos;IA échoue (pas de réseau, clé absente, quota), générer le message avec
                l&apos;heuristique locale au lieu de bloquer le commit.
              </p>
            </div>
            <Switch
              checked={settings.fallbackToLocal}
              onCheckedChange={(value) => patch({ fallbackToLocal: value })}
              aria-label="Repli hors-ligne automatique"
            />
          </div>

          <p className="text-muted-foreground text-xs">
            Provider actif : <strong>{settings.provider}</strong> · modèle :{" "}
            <code>{modelFor(settings) ?? "défaut du provider"}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
