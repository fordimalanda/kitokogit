import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/geist";
import "./globals.css";

import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "KitokoGit",
  description:
    "Gestion et automatisation Git multi-projets assistée par IA — Tauri, Next.js et Rust.",
};

/**
 * Script exécuté avant le premier rendu : applique le thème mémorisé pour
 * éviter un flash blanc au démarrage de la fenêtre Tauri.
 */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("kitokogit-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
