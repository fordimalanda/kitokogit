"use client";

import { FolderPlus, Layers, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectKind } from "@/types";

/** Identifiant de la vue « tous les projets ». */
export const GLOBAL_VIEW = "*";

export interface ProjectTab {
  path: string;
  label: string;
  kind: ProjectKind;
  subCount: number;
}

interface ProjectHeaderProps {
  projects: ProjectTab[];
  active: string;
  onSelect: (value: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
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
}: ProjectHeaderProps) {
  const totalRepos = projects.reduce((total, project) => total + project.subCount, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Projets</h2>
          <p className="text-muted-foreground text-sm">
            {projects.length} dossier(s) racine · {totalRepos} dépôt(s) détecté(s)
          </p>
        </div>
        <div className="flex gap-2">
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
          </button>

          {projects.map((project) => {
            const isActive = active === project.path;
            return (
              <button
                key={project.path}
                type="button"
                onClick={() => onSelect(project.path)}
                aria-current={isActive ? "page" : undefined}
                title={`${project.path}\n${KIND_SHORT[project.kind]}`}
                className={cn(
                  "focus-visible:ring-ring/50 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
                  isActive ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted/60"
                )}
              >
                <span className="max-w-40 truncate">{project.label}</span>
                {project.subCount > 1 && (
                  <Badge variant={isActive ? "secondary" : "outline"}>{project.subCount}</Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
