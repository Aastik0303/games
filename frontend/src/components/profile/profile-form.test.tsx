import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/api/types";
import { ProfileForm } from "./profile-form";
import { emptyDraft, safeNext, toProfileInput, validateProfile } from "./profile-validation";

describe("profile validation", () => {
  it("requires name, age band and guidelines; never asks for gender", () => {
    const errors = validateProfile(emptyDraft());
    expect(Object.keys(errors).sort()).toEqual(["ageBand", "displayName", "guidelinesAccepted"]);
    expect(JSON.stringify(emptyDraft())).not.toMatch(/gender|birth/i);
  });

  it("blocks under-13 and contact details in names", () => {
    const d = { ...emptyDraft(), displayName: "me@example.com", ageBand: "under_13" as const, guidelinesAccepted: true };
    const errors = validateProfile(d);
    expect(errors.ageBand).toMatch(/13 and over/);
    expect(errors.displayName).toBeTruthy();
  });

  it("drops interests unless the person opted in", () => {
    const d = { ...emptyDraft(), displayName: "Nova", ageBand: "18_24" as const, guidelinesAccepted: true, interests: ["riddles" as const] };
    expect(toProfileInput(d).interests).toEqual([]);
    expect(toProfileInput({ ...d, useInterestsForMatching: true }).interests).toEqual(["riddles"]);
  });

  it("only allows same-origin relative redirects", () => {
    expect(safeNext("/play")).toBe("/play");
    expect(safeNext("//evil.test")).toBe("/");
    expect(safeNext("https://evil.test")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("<ProfileForm />", () => {
  it("shows an error summary and does not submit when invalid", async () => {
    const onSubmit = vi.fn();
    render(<ProfileForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Create profile" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/Please fix the following/);
    expect(screen.queryByLabelText(/gender/i)).not.toBeInTheDocument();
  });

  it("submits a valid profile", async () => {
    const onSubmit = vi.fn(async () => ({}) as Session);
    render(<ProfileForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Display name"), "Quill");
    await userEvent.selectOptions(screen.getByLabelText("Age band"), "25_34");
    await userEvent.click(screen.getByLabelText(/I agree to the/));
    await userEvent.click(screen.getByRole("button", { name: "Create profile" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Quill", ageBand: "25_34", interests: [], consent: { guidelinesAccepted: true, useInterestsForMatching: false } }),
    );
  });

  it("explains minor safeguards when a minor age band is chosen", async () => {
    render(<ProfileForm onSubmit={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Age band"), "13_15");
    expect(screen.getByText(/matched only with people in their own age group/)).toBeInTheDocument();
  });
});
