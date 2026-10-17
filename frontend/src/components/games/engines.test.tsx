import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MYSTERY } from "@/lib/api/mock/fixtures";
import { LogicGridEngine } from "./logic-grid";
import { MysteryEngine } from "./mystery-case";
import { TextAnswerEngine } from "./text-answer";

describe("TextAnswerEngine", () => {
  it("submits the trimmed answer and clears on a definitive result", async () => {
    const onSubmit = vi.fn(async () => true);
    render(<TextAnswerEngine puzzle={{ kind: "riddle", id: "r", text: "What has keys?" }} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Your answer");
    await userEvent.type(input, "  piano  {enter}");
    expect(onSubmit).toHaveBeenCalledWith({ kind: "riddle", text: "piano" });
    expect(input).toHaveValue("");
  });

  it("keeps the input when sending failed", async () => {
    render(<TextAnswerEngine puzzle={{ kind: "word", id: "w", prompt: "p", template: "Better late than ___.", letters: 5 }} onSubmit={async () => false} />);
    const input = screen.getByLabelText("Your answer");
    await userEvent.type(input, "never{enter}");
    expect(input).toHaveValue("never");
    expect(screen.getByRole("img", { name: "blank, 5 letters" })).toBeInTheDocument();
  });

  it("is disabled with a reason when it's not your turn", () => {
    render(<TextAnswerEngine puzzle={{ kind: "riddle", id: "r", text: "?" }} onSubmit={vi.fn()} disabled disabledReason="Nova is answering" />);
    expect(screen.getByLabelText("Your answer")).toBeDisabled();
    expect(screen.getByPlaceholderText("Nova is answering")).toBeInTheDocument();
  });
});

describe("LogicGridEngine", () => {
  const puzzle = { kind: "logic" as const, id: "g", size: 4 as const, rules: "rules", givens: [[1, null, null, 4], [null, 4, 1, null], [2, null, null, 3], [null, 3, 2, null]] };

  it("marks conflicting cells without relying on colour alone", async () => {
    render(<LogicGridEngine puzzle={puzzle} onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Row 1, column 2"), "1");
    expect(screen.getByLabelText(/Row 1, column 2, conflicts/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/wavy underline/)).toBeInTheDocument();
  });

  it("only enables checking once the grid is full, then sends it", async () => {
    const onSubmit = vi.fn(async () => true);
    render(<LogicGridEngine puzzle={puzzle} onSubmit={onSubmit} />);
    const check = screen.getByRole("button", { name: "Check solution" });
    expect(check).toBeDisabled();
    const fill: [number, number, number][] = [[0, 1, 2], [0, 2, 3], [1, 0, 3], [1, 3, 2], [2, 1, 1], [2, 2, 4], [3, 0, 4], [3, 3, 1]];
    for (const [r, c, v] of fill) await userEvent.type(screen.getByLabelText(`Row ${r + 1}, column ${c + 1}`), String(v));
    expect(check).toBeEnabled();
    await userEvent.click(check);
    expect(onSubmit).toHaveBeenCalledWith({ kind: "logic", grid: [[1, 2, 3, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]] });
  });

  it("does not let givens be edited", () => {
    render(<LogicGridEngine puzzle={puzzle} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Row 1, column 1, given")).toHaveAttribute("readonly");
  });
});

describe("MysteryEngine", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip the solution like the server does
  const { solution, clues, ...rest } = MYSTERY;
  const puzzle = { ...rest, kind: "mystery" as const, clues: clues.map(({ id, title, location }) => ({ id, title, location })) };

  it("requires suspect, method and motive before accusing", async () => {
    const onSubmit = vi.fn(async () => true);
    render(<MysteryEngine puzzle={puzzle} revealed={[]} onInspect={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Accuse" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a suspect.")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Dr. Felix Hale"));
    await userEvent.selectOptions(screen.getByLabelText("How?"), "Poison in the honey jar");
    await userEvent.selectOptions(screen.getByLabelText("Why?"), "To silence a report of malpractice");
    await userEvent.click(screen.getByRole("button", { name: "Accuse" }));
    expect(onSubmit).toHaveBeenCalledWith({ kind: "mystery", suspectId: "hale", method: "Poison in the honey jar", motive: "To silence a report of malpractice" });
  });

  it("asks the server to reveal a clue on inspect", async () => {
    const onInspect = vi.fn(async () => {});
    render(<MysteryEngine puzzle={puzzle} revealed={[]} onInspect={onInspect} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Inspect The tea tray" }));
    expect(onInspect).toHaveBeenCalledWith("tray");
  });
});
