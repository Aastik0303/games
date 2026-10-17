/**
 * 4×4 mini-sudoku rules. Used by the UI for *assistive* conflict highlighting
 * (the rules are public) and by the mock server for grading. In production the
 * backend grades; the client's view of correctness is never trusted.
 */
export type Grid = (number | null)[][];

const SIZE = 4;
const BOX = 2;

export function emptyGrid(givens: Grid): Grid {
  return givens.map((row) => row.map((v) => v));
}

/** Returns a set of "r,c" keys whose value repeats in a row, column or box. */
export function findConflicts(grid: Grid): Set<string> {
  const conflicts = new Set<string>();
  const check = (cells: [number, number][]) => {
    const byValue = new Map<number, [number, number][]>();
    for (const [r, c] of cells) {
      const v = grid[r]?.[c];
      if (v == null) continue;
      const list = byValue.get(v) ?? [];
      list.push([r, c]);
      byValue.set(v, list);
    }
    for (const list of byValue.values()) {
      if (list.length > 1) for (const [r, c] of list) conflicts.add(`${r},${c}`);
    }
  };
  for (let i = 0; i < SIZE; i++) {
    check(Array.from({ length: SIZE }, (_, c) => [i, c] as [number, number]));
    check(Array.from({ length: SIZE }, (_, r) => [r, i] as [number, number]));
  }
  for (let br = 0; br < SIZE; br += BOX) {
    for (let bc = 0; bc < SIZE; bc += BOX) {
      const cells: [number, number][] = [];
      for (let r = br; r < br + BOX; r++) for (let c = bc; c < bc + BOX; c++) cells.push([r, c]);
      check(cells);
    }
  }
  return conflicts;
}

export function isComplete(grid: Grid): boolean {
  return grid.length === SIZE && grid.every((row) => row.length === SIZE && row.every((v) => v != null && v >= 1 && v <= SIZE));
}

/** A grid is solved when complete, conflict-free and it preserves every given. */
export function isSolved(grid: Grid, givens: Grid): boolean {
  if (!isComplete(grid) || findConflicts(grid).size > 0) return false;
  return givens.every((row, r) => row.every((g, c) => g == null || grid[r][c] === g));
}
