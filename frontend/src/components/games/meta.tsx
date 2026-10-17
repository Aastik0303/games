import { Brain, Grid3x3, Search, Type } from "lucide-react";
import type { Difficulty, GameKind } from "@/lib/api/types";

export const KIND_META: Record<GameKind, { label: string; icon: typeof Type; accent: string }> = {
  word: { label: "Word", icon: Type, accent: "text-violet-300" },
  riddle: { label: "Riddle", icon: Brain, accent: "text-cyan-300" },
  logic: { label: "Logic", icon: Grid3x3, accent: "text-magenta-300" },
  mystery: { label: "Mystery", icon: Search, accent: "text-violet-300" },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
