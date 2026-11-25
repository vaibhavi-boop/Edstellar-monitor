"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const ORDER = ["light", "dark", "system"] as const;
const LABEL = { light: "Light theme", dark: "Dark theme", system: "Match system theme" };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? theme : "system") as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`${LABEL[current]}. Switch to ${LABEL[next].toLowerCase()}`} title={LABEL[current]}>
      <Icon />
    </Button>
  );
}
