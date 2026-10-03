"use client";

import { useEffect } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Limite d'erreur de l'App Router.
 *
 * Sans ce fichier, toute exception levée pendant le rendu laisse une page morte
 * (« This page couldn't load ») sans aucune information exploitable. Ici, le
 * message réel est affiché, ce qui rend le diagnostic immédiat.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Visible dans les outils de développement de la webview.
    console.error("[KitokoGit]", error);
  }, [error]);

  return (
    <div className="space-y-4">
      <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-3 rounded-lg border px-4 py-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Une erreur est survenue dans cette page</p>
          <pre className="text-muted-foreground max-h-56 overflow-auto font-mono text-[0.7rem] whitespace-pre-wrap">
            {error.message || String(error)}
            {error.digest ? `\n\ndigest : ${error.digest}` : ""}
          </pre>
        </div>
      </div>

      <Button variant="outline" onClick={reset}>
        <RefreshCw data-icon="inline-start" />
        Réessayer
      </Button>
    </div>
  );
}
