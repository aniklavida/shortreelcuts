// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptScreen } from "./PromptScreen.js";

describe("PromptScreen — Screen 1", () => {
  it("renders nothing but the prompt, a duration chip and Generate — no setting is reachable before the first render", () => {
    const { container } = render(<PromptScreen isGenerating={false} onGenerate={vi.fn()} />);

    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(4); // 3 duration chips + Generate
    expect(container.querySelectorAll("select, input")).toHaveLength(0);
    expect(container.querySelector("form")).toBeNull();
  });

  it("disables Generate until a prompt is typed", () => {
    render(<PromptScreen isGenerating={false} onGenerate={vi.fn()} />);
    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Video prompt"), { target: { value: "a video about tea" } });
    expect(generate).not.toBeDisabled();
  });

  it("passes the prompt and the selected duration chip to onGenerate", () => {
    const onGenerate = vi.fn();
    render(<PromptScreen isGenerating={false} onGenerate={onGenerate} />);

    fireEvent.change(screen.getByLabelText("Video prompt"), { target: { value: "a video about tea" } });
    fireEvent.click(screen.getByRole("button", { name: "45s" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "a video about tea", targetSeconds: 45 }));
  });
});
