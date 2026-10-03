"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CircleCheck,
  FolderKanban,
  GitBranch,
  LoaderCircle,
  Rocket,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeError, isTauri, tauri } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

const STATS = [
  { label: "Dépôts suivis", value: "—", delta: "", icon: FolderKanban, tone: "text-sky-500" },
  { label: "Branches actives", value: "—", delta: "", icon: GitBranch, tone: "text-violet-500" },
  { label: "Commits IA", value: "—", delta: "", icon: Sparkles, tone: "text-emerald-500" },
  { label: "Workflows lancés", value: "—", delta: "", icon: Rocket, tone: "text-amber-500" },
];

type BackendState =
  | { status: "loading" }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export default function DashboardPage() {
  const [backend, setBackend] = useState<BackendState>({ status: "loading" });

  useEffect(() => {
    if (!isTauri()) {
      setBackend({
        status: "error",
        message:
          "Webview Tauri non détectée. Lancez l'application avec « npm run tauri dev » pour accéder au backend Rust.",
      });
      return;
    }

    let cancelled = false;
    tauri
      .gitVersion()
      .then((version) => {
        if (!cancelled) setBackend({ status: "ready", version });
      })
      .catch((error: unknown) => {
        if (!cancelled) setBackend({ status: "error", message: describeError(error) });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Bandeau d'accueil */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-6 text-white shadow-sm">
        <div className="absolute -top-16 -right-10 size-48 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute -bottom-20 left-24 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative space-y-3">
          <Badge className="border-white/25 bg-white/15 text-white">
            <Sparkles className="size-3" />
            Étape 1 · backend Rust
          </Badge>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            KitokoGit, votre copilote Git 👋
          </h2>
          <p className="max-w-xl text-sm text-white/85">
            Scannez vos dossiers racine, détectez les dépôts et sous-projets, puis laissez l&apos;IA
            rédiger vos messages de commit et pousser vos modifications.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href="/projects"
              className={buttonVariants({
                className: "bg-white text-indigo-600 hover:bg-white/90",
              })}
            >
              Ajouter un dossier racine
            </Link>
            <Button variant="ghost" className="text-white hover:bg-white/15 hover:text-white">
              Voir la documentation
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </div>

      {/* Statistiques */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="gap-4 py-4">
              <CardContent className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs font-medium">{stat.label}</p>
                  <p className="font-heading text-2xl font-semibold tracking-tight">
                    {stat.value}
                  </p>
                  {stat.delta && (
                    <p className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <TrendingUp className="size-3" />
                      {stat.delta}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg",
                    stat.tone
                  )}
                >
                  <Icon className="size-4.5" />
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* État du backend Rust */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Backend Rust
            </CardTitle>
            <CardDescription>
              Vérification de la liaison entre la webview et le moteur Git natif.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-muted/50 flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs">
              {backend.status === "loading" && (
                <>
                  <LoaderCircle className="size-3.5 animate-spin text-sky-500" />
                  <span className="text-muted-foreground">
                    Interrogation de la commande `git_version`…
                  </span>
                </>
              )}
              {backend.status === "ready" && (
                <>
                  <CircleCheck className="size-3.5 text-emerald-500" />
                  <span>{backend.version}</span>
                </>
              )}
              {backend.status === "error" && (
                <>
                  <TriangleAlert className="size-3.5 text-amber-500" />
                  <span className="text-muted-foreground whitespace-pre-wrap">
                    {backend.message}
                  </span>
                </>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              L&apos;appel passe par <code>invoke(&quot;git_version&quot;)</code> : si une version de
              Git s&apos;affiche ci-dessus, la chaîne Tauri → Rust fonctionne.
            </p>
          </CardContent>
        </Card>

        {/* Feuille de route */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Prochaines étapes</CardTitle>
            <CardDescription>Le chantier est livré par incréments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              { label: "Scanner multi-projets + Git CLI", done: true },
              { label: "Tableau de bord et sous-cartes", done: false },
              { label: "Génération de commit par IA", done: false },
              { label: "Clés API et réglages", done: false },
            ].map((step) => (
              <div
                key={step.label}
                className="hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    step.done ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                  )}
                >
                  {step.done ? <CircleCheck className="size-4" /> : <Users className="size-4" />}
                </span>
                <p className="text-sm font-medium">{step.label}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
