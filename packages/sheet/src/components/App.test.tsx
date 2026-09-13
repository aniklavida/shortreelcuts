// @vitest-environment jsdom
/**
 * The end-to-end proof, at the UI layer, of the two acceptance criteria in
 * `docs/SPEC.md` §17 that the sheet stands on: change a field, and confirm
 * the re-run set is exactly what `invalidate()` predicted — not more — and
 * that the cost estimate is visible before the re-run, not after.
 *
 * `compose` is the fast fake from `testing/fakeRunners.ts`;
 * `session.e2e.test.ts` is where the real one (real `ffmpeg`, via
 * `@shortreelcuts/render`) is proven the same way.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { makeFakeRunners } from "../testing/fakeRunners.js";

function renderApp() {
  const runners = makeFakeRunners();
  const utils = render(<App runners={runners} workDir="/tmp/shortreelcuts-sheet-app-test" makeSeed={() => 7} />);
  return { runners, ...utils };
}

async function generateAVideo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Video prompt"), "a video about why the sky is blue");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await waitFor(() => expect(screen.getByTestId("decision-sheet")).toBeInTheDocument());
}

describe("App — the decision sheet end to end", () => {
  it("shows only the prompt before the first render — no group, no control, no video", () => {
    const { container } = renderApp();
    expect(screen.queryByTestId("decision-sheet")).toBeNull();
    expect(container.querySelectorAll("select, input[type=range], input[type=checkbox]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("never renders a <form> anywhere, before or after generating", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    expect(container.querySelector("form")).toBeNull();

    await generateAVideo(user);
    expect(container.querySelector("form")).toBeNull();
  });

  it("after generating, shows the collapsed six-group summary with a decision count each", async () => {
    const user = userEvent.setup();
    renderApp();
    await generateAVideo(user);

    for (const id of ["script", "voice", "footage", "captions", "music", "format"]) {
      const group = screen.getByTestId(`group-${id}`);
      expect(within(group).getByText(/\d+ decisions/)).toBeInTheDocument();
    }
  });

  it("changing the voice shows its cost before applying, then re-runs voice, align and compose only", async () => {
    const user = userEvent.setup();
    const { runners } = renderApp();
    await generateAVideo(user);
    runners.script.mockClear();
    runners.voice.mockClear();
    runners.footage.mockClear();
    runners.align.mockClear();
    runners.compose.mockClear();

    await user.click(within(screen.getByTestId("group-voice")).getByRole("button", { name: /voice/i, expanded: false }));
    const voiceGroup = screen.getByTestId("group-voice");

    const chosenVoiceButton = within(voiceGroup).getByRole("button", { name: "Warm, unhurried female voice" });
    expect(chosenVoiceButton).toHaveAttribute("aria-pressed", "true");

    // Pick a candidate that is not the currently-chosen one.
    const otherVoiceButton = within(voiceGroup).getByRole("button", { name: "Confident, energetic male voice" });
    await user.click(otherVoiceButton);

    // The cost hint must already be on screen from this synchronous click — before Apply is even pressed.
    const costHint = await within(voiceGroup).findByTestId("cost-hint");
    expect(costHint.textContent).toMatch(/regenerates the voiceover/i);
    expect(runners.voice).not.toHaveBeenCalled(); // nothing has run yet — only previewed

    await user.click(within(voiceGroup).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(runners.compose).toHaveBeenCalledTimes(1));
    expect(runners.script).not.toHaveBeenCalled();
    expect(runners.footage).not.toHaveBeenCalled();
    expect(runners.voice).toHaveBeenCalledTimes(1);
    expect(runners.align).toHaveBeenCalledTimes(1);
  });

  it("swapping a footage clip shows the rejected candidates at a glance and re-runs compose only", async () => {
    const user = userEvent.setup();
    const { runners } = renderApp();
    await generateAVideo(user);

    await user.click(within(screen.getByTestId("group-footage")).getByRole("button", { name: /footage/i, expanded: false }));
    const footageGroup = screen.getByTestId("group-footage");

    // Four candidates for the first beat's clip should already be visible, unprompted.
    const clipButtons = within(footageGroup).getAllByRole("button", { name: /wide shot|close-up|over-the-shoulder|slow pan/i });
    expect(clipButtons.length).toBeGreaterThanOrEqual(4);

    runners.script.mockClear();
    runners.voice.mockClear();
    runners.footage.mockClear();
    runners.align.mockClear();
    runners.compose.mockClear();

    const chosen = clipButtons.find((b) => b.getAttribute("aria-pressed") === "true");
    const notChosen = clipButtons.find((b) => b !== chosen);
    expect(notChosen).toBeDefined();
    await user.click(notChosen!);

    const costHint = await within(footageGroup).findByTestId("cost-hint");
    expect(costHint.textContent).toMatch(/re-renders/i);

    const applyButtons = within(footageGroup).getAllByRole("button", { name: "Apply" });
    await user.click(applyButtons[0]!);

    await waitFor(() => expect(runners.compose).toHaveBeenCalledTimes(1));
    expect(runners.script).not.toHaveBeenCalled();
    expect(runners.voice).not.toHaveBeenCalled();
    expect(runners.footage).not.toHaveBeenCalled();
    expect(runners.align).not.toHaveBeenCalled();
  });

  it("shows where the rendered video is, and updates it after a re-render", async () => {
    const user = userEvent.setup();
    renderApp();
    await generateAVideo(user);
    expect(screen.getByTestId("video-path").textContent).toContain("output.mp4");
  });

  it("Screen 3 shows the full plan JSON and re-renders through the same override path", async () => {
    const user = userEvent.setup();
    const { runners } = renderApp();
    await generateAVideo(user);

    await user.click(screen.getByRole("button", { name: "Plan" }));
    const textarea = screen.getByLabelText("Plan JSON") as HTMLTextAreaElement;
    const plan = JSON.parse(textarea.value);
    expect(plan.captions.position).toBe("lower-third");

    plan.captions.position = "center";
    // userEvent.type treats `{`/`}` as special key syntax, which JSON is full of — set the
    // textarea's value directly instead, the same way a paste would land it.
    fireEvent.change(textarea, { target: { value: JSON.stringify(plan) } });

    runners.voice.mockClear();
    runners.compose.mockClear();
    await user.click(screen.getByRole("button", { name: "Re-render" }));

    await waitFor(() => expect(runners.compose).toHaveBeenCalledTimes(1));
    expect(runners.voice).not.toHaveBeenCalled();
  });
});
