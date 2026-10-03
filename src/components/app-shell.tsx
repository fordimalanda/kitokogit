"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  FolderKanban,
  LayoutDashboard,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const THEME_KEY = "kitokogit-theme";

const NAV_ITEMS = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/projects", label: "Projets", icon: FolderKanban },
  { href: "/settings", label: "Paramètres", icon: SettingsIcon },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Tableau de bord", subtitle: "Vue d'ensemble de vos dépôts Git" },
  "/projects": { title: "Projets", subtitle: "Scannez et pilotez vos dépôts" },
  "/settings": { title: "Paramètres", subtitle: "Clés API et préférences" },
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Le thème réel est appliqué par le script inline de `layout.tsx` : on ne fait
  // que synchroniser l'état React après le montage pour éviter tout mismatch SSR.
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  }

  const meta = PAGE_META[pathname] ?? { title: "KitokoGit", subtitle: "" };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* ---------- Barre latérale ---------- */}
      <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-sm">
            <Boxes className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-heading truncate text-sm font-semibold">KitokoGit</p>
            <p className="text-muted-foreground truncate text-xs">Tauri v2 · Next.js</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="text-muted-foreground px-2 pb-1 text-[0.7rem] font-medium tracking-wide uppercase">
            Général
          </p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {active && <span className="bg-primary size-1.5 rounded-full" />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <div className="bg-sidebar-accent/60 flex items-center gap-2.5 rounded-lg p-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 text-xs font-semibold text-white">
              KG
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">KitokoGit</p>
              <p className="text-muted-foreground truncate text-[0.7rem]">v0.1.0</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ---------- Zone principale ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h1 className="font-heading truncate text-sm font-semibold">{meta.title}</h1>
            <p className="text-muted-foreground truncate text-xs">{meta.subtitle}</p>
          </div>

          <div className="relative hidden lg:block">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input placeholder="Rechercher…" className="w-56 pl-8" aria-label="Rechercher" />
          </div>

          <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
            <Bell />
            <span className="bg-destructive absolute top-1.5 right-1.5 size-1.5 rounded-full" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            aria-label={theme === "dark" ? "Activer le thème clair" : "Activer le thème sombre"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>

          <Button size="sm">
            <Plus data-icon="inline-start" />
            <span className="hidden sm:inline">Nouveau</span>
          </Button>
        </header>

        <main key={pathname} className="app-enter flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-6 p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
