# Design system and visual identity

This document defines the visual identity, tokens, component conventions, and design standards for ShortReelCuts, built with the project's design system.

## 1. Product identity and audience

- **Product:** ShortReelCuts — a self-hosted tool that turns a topic into a short vertical video, showing every decision made along the way and letting the creator change any one of them.
- **Audience:** Creators self-hosting the application on their own machines or private infrastructure.
- **Category:** Creative tool.
- **Theme default:** Dark default (`data-theme="dark"`), with light available (`data-theme="light"`). Dark mode prioritizes visual focus on video media and timelines, while light mode remains fully accessible.
- **Vibe words:** Energetic, clear, confident.

## 2. Brand values

The visual identity is derived through five core parameters in the token layer (`apps/web/app/tokens.css`):

| Parameter | Value | Rationale |
|---|---|---|
| **Hue** | `335` (magenta-rose) | Dynamic, modern creator energy without generic blue or neon saturation. |
| **Chroma** | `0.15` | Vivid enough for active indicators and primary triggers while keeping neutrals clean. |
| **Warmth** | `0.01` | Subtle tint in neutral grays, avoiding sterile cold slate. |
| **Radius scale** | `1.3` | Soft squircle curves (`--r-md`: 13px, `--r-lg`: 18.2px, `--r-xl`: 23.4px) matching modern creator workflows. |
| **Type pairing** | Geometric (`Space Grotesk` + `Manrope`) | Space Grotesk provides confident display headers; Manrope delivers legible, balanced UI copy and numbers. Both OFL. |

## 3. Typography and font licensing

Fonts are self-hosted directly via local packages with zero runtime third-party network requests:

| Face | Role | Weights | Licence | Package |
|---|---|---|---|---|
| **Space Grotesk** | Display titles, wordmark, stage banners | 400, 500, 600, 700 | SIL Open Font License 1.1 (OFL-1.1) | `@fontsource/space-grotesk` |
| **Manrope** | Interface body, labels, buttons, tables | 400, 500, 600, 700 | SIL Open Font License 1.1 (OFL-1.1) | `@fontsource/manrope` |
| **System monospace** | Code snippets, plan JSON, seeds, timestamps | 400, 500 | System fallback stack (`ui-monospace`, `Menlo`, `Monaco`, `Consolas`) | System |

## 4. Iconography and wordmark

- **Wordmark:** Set purely in the display face (`Space Grotesk`, 600 weight). No invented, hand-drawn or clip-art logo marks.
- **Icons:** Lucide icons (`lucide-react`, ISC licence), stroke width 1.75px, sized consistently to adjacent text (16px inline, 18px for buttons, 24px for large state cards).

## 5. Non-negotiables

The interface adheres to the non-negotiable laws of the project's design system:

1. **One primary action per screen:** The home screen has one primary button ("Generate video"). The project page emphasizes the current status action (such as "Download video" when finished or "Retry render" on failure). Secondary controls use outline or ghost styling.
2. **Accent under 5% of any screen:** The accent color (`--acc`, magenta-rose) is reserved for the single primary trigger, active navigation indicator, focus outlines, and active state chips. Surfaces and backgrounds remain calm neutrals.
3. **Labels above inputs:** Every form field has its persistent descriptive label positioned above the control, with helper copy below and inline error messages replacing help copy on validation failures.
4. **No gradients:** Surfaces use flat solid tokens (`--bg`, `--rail`, `--surf`, `--subtle`) with clean hairline borders (`--bd`, `--bd2`).
5. **No coloured left borders:** Status and grouping are communicated through semantic background tints (`--okbg`, `--warnbg`, `--badbg`, `--infobg`) and badges, never colored accent lines.
6. **No emoji in chrome:** Navigation, tab bars, headers, and buttons use plain text and Lucide icons only.
7. **No zebra tables:** Tables use quiet header fills (`--subtle`), 1px row dividers (`--line`), tabular numerals, and hover highlights.
8. **No modals for forms:** Inline disclosure, sheets, or dedicated editor screens are used instead of jarring modal dialogs.
9. **Sentence-case real copy:** Button text follows `verb + object` ("Generate video", "Copy JSON"). Status messages and error alerts use plain, unambiguous language.
10. **Design every state:** Every surface designs six states: empty, loading (skeletons), partial progress, ideal/complete, error, and no access (including the honest "no model connected" state for self-hosters).

## 6. Theme and persistence

Themes are toggled via the `data-theme` attribute on the root document:
- **Default:** `data-theme="dark"`
- **Detection & Persistence:** Checks `localStorage` for `shortreelcuts-theme`, falling back to the user's OS preference (`prefers-color-scheme`), with dark as default.
- **Controls:** An accessible theme toggle button in the header with Sun and Moon icons allows immediate switching.

## 7. Key screens and anatomies

1. **Home screen (`/`):**
   - Header with Wordmark and theme toggle.
   - Hero brief: Clear single-purpose statement.
   - Creation form: Topic prompt textarea, quick duration selection chips, exact second input, and tone selector.
   - Provider status badge: Honest indicator of connected LLM / video generation providers.
2. **Project screen (`/projects/[id]`):**
   - Header: Breadcrumb link back to prompt, job identifier, and status badge.
   - Pipeline progress strip: Linear execution state across stages (`script`, `voice`, `footage`, `align`, `frames`, `compose`).
   - Video result: 9:16 vertical video player container, render metadata, and output download action.
   - Decision sheet: Grouped breakdown of all decisions, chosen candidates, and recorded reasons, with interactive candidate inspection and cost preview.
3. **Plan document screen (`/projects/[id]/plan`):**
   - Breadcrumb back to decisions.
   - Plan metadata (version, seed, duration).
   - Monospace inspector with formatted JSON and one-click copy.
