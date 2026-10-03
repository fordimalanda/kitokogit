"use client";

import { FolderPlus, Layers, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ProjectKind } from "@/types";

/** Identifiant de la vue « tous les projets ». */
export const GLOBAL_VIEW = "*";

export interface ProjectTab {
  path: string;
  label: string;
  kind: ProjectKind;
  subCount: number;
  /** Nombre de sous-projets ayant des modifications en attente. */
  changedCount: number;
}

interface ProjectHeaderProps {
  projects: ProjectTab[];
  active: string;
  onSelect: (value: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
}

const KIND_SHORT: Record<ProjectKind, string> = {
  repository: "dépôt",
  monorepo: "monorepo",
  notInitialized: "non initialisé",
};

export function ProjectHeader({
  projects,
  active,
  onSelect,
  onAdd,
  onRefresh,
  autoRefresh,
  onAutoRefreshChange,
}: ProjectHeaderProps) {
  const totalRepos = projects.reduce((total, project) => total + project.subCount, 0);
  const totalChanged = projects.reduce((total, project) => total + project.changedCount, 0);
  const anyChanges = totalChanged > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Projets</h2>
          <p className="text-muted-foreground text-sm">
            {projects.length} dossier(s) racine · {totalRepos} dépôt(s)
            {" · "}
            {anyChanges ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {totalChanged} dépôt(s) à pousser
              </span>
            ) : (
              "tout est à jour"
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={autoRefresh}
              onCheckedChange={onAutoRefreshChange}
              size="sm"
              aria-label="Suivi automatique des modifications"
            />
            <span className="text-muted-foreground text-xs">Suivi auto</span>
          </div>

          <Button variant="outline" size="sm" onClick={onRefresh} disabled={projects.length === 0}>
            <RefreshCw data-icon="inline-start" />
            Rescanner
          </Button>
          <Button size="sm" onClick={onAdd}>
            <FolderPlus data-icon="inline-start" />
            Ajouter un dossier
          </Button>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => onSelect(GLOBAL_VIEW)}
            aria-current={active === GLOBAL_VIEW ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
              active === GLOBAL_VIEW
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted/60"
            )}
          >
            <Layers className="size-3.5" />
            Vue globale
            {anyChanges && <span className="size-1.5 rounded-full bg-amber-500" />}
          </button>

          {projects.map((project) => {
            const isActive = active === project.path;
            return (
              <button
                key={project.path}
                type="button"
                onClick={() => onSelect(project.path)}
                aria-current={isActive ? "page" : undefined}
                title={`${project.path}\n${KIND_SHORT[project.kind]}${
                  project.changedCount > 0
                    ? `\n${project.changedCount} dépôt(s) avec des modifications`
                    : ""
                }`}
                className={cn(
                  "focus-visible:ring-ring/50 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
                  isActive ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60"
                )}
              >
                {project.changedCount > 0 && (
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      isActive ? "bg-primary-foreground" : "bg-amber-500"
                    )}
                  />
                )}
                <span className="max-w-40 truncate">{project.label}</span>
                {project.changedCount > 0 ? (
                  <Badge variant={isActive ? "secondary" : "warning"}>
                    {project.changedCount}
                  </Badge>
                ) : (
                  project.subCount > 1 && (
                    <Badge variant={isActive ? "secondary" : "outline"}>{project.subCount}</Badge>
                  )
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
