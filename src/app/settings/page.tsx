"use client";

import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROVIDERS } from "@/lib/ai-providers";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import type { ProviderKeyStatus } from "@/types";

export default function SettingsPage() {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      setError("Webview Tauri non détectée : lancez « npm run tauri dev ».");
      setLoading(false);
      return;
    }

    let cancelled = false;
    tauri
      .listApiKeyStatus()
      .then((list: ProviderKeyStatus[]) => {
        if (cancelled) return;
        setStatus(Object.fromEntries(list.map((item) => [item.provider, item.hasKey])));
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

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 flex items-start gap-3 rounded-lg border px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <div className="text-sm">
          <p className="font-medium">Vos clés ne quittent jamais la machine</p>
          <p className="text-muted-foreground text-xs">
            Elles sont stockées par le backend Rust dans le gestionnaire d&apos;identifiants du
            système (Windows Credential Manager, Keychain macOS, Secret Service Linux) et ne sont
            jamais transmises à la webview.
          </p>
        </div>
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Providers IA
          </CardTitle>
          <CardDescription>
            La saisie et la modification des clés arriveront à l&apos;étape 3.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {PROVIDERS.map((provider) => {
            const hasKey = status[provider.id] ?? false;
            return (
              <div
                key={provider.id}
                className="hover:bg-muted/50 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{provider.label}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {provider.description} · <code>{provider.defaultModel}</code>
                  </p>
                </div>

                {loading ? (
                  <LoaderCircle className="text-muted-foreground size-3.5 animate-spin" />
                ) : !provider.requiresKey ? (
                  <Badge variant="outline">sans clé</Badge>
                ) : hasKey ? (
                  <Badge variant="success">clé enregistrée</Badge>
                ) : (
                  <Badge variant="warning">non configuré</Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
