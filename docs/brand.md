# ensomi brand

ensomi turns music from something you listen to into something you take part in.

## Name and statement

- Brand: **ensomi**, always lowercase, also at the start of a sentence. Japanese: **えんそみ**.
- A coined name from 演奏 (*ensō*, performance), with 円相 (*ensō*, an open circular gesture) as a secondary association.
- Statement: **ensomi — Play the music around you.**
- 日本語: **えんそみ — 聴く音楽から、参加する音楽へ。**

Release and model names keep their own form where they are data, for example the runtime's `model_name` "Ensomi R2"; page copy says "R2" or "ensomi R2".

## Principles

- **Participation over consumption.** Copy invites the reader to do something with music, not to watch a product.
- **Softness with expressive motion.** Rounded shapes and calm surfaces; motion and the warm accent mark what moves or acts.
- **An open, asymmetric circle, never a closed ring.** The mark is two asymmetric arcs, lavender and rose, overlapping near the top into purple, around an irregular almond-shaped opening, on dark plum with a diagonal division. Flat 2D, rounded, saturated.

## Palette

One theme: dark plum. Tokens live in `public/styles.css`.

| Role | Value | Use |
| --- | --- | --- |
| Ground | `#1c1525` | page background |
| Ground, second half | `#231a2e` | the diagonal split behind the hero |
| Surface | `#2a2036`, `#342944` | panels, fields |
| Text | `#f6f1fb` | body text |
| Muted text | `#c7bcd6` | secondary text |
| Lavender | `#B5B3EF` | links, outline buttons, long notes in the player |
| Rose | `#EAA0B7` | the Japanese statement, accents, taps in the player |
| Intersection purple | `#9562D7` | fills and borders only (step markers, requested-section bands); text on it or in it on the ground stays under 4.5:1 |
| Action and motion | `#F39AAF` → `#FF879F` → `#FF708F` | primary buttons, progress, the playhead and judgement line; nothing else |
| Ink on action | `#2b0f1e` | text on the action gradient and on selected presets |

All text pairs meet WCAG AA on the ground and surfaces (muted text on the raised surface is the lowest at 7.5:1; ink on `#FF708F` is 6.7:1). Field borders (`#8f7dab`) reach 3:1 against the field.

## Shape and type

- Generous type with a rounded face where the system has one (SF Pro Rounded, Hiragino Maru Gothic, M PLUS Rounded 1c), system UI text elsewhere.
- Soft corners with one tighter corner (`26px 26px 26px 10px`) for panels and cards; pills for buttons and presets.

## What to avoid

- Literal music decoration outside the functional player: notes, waveforms, piano keys, rhythm-game imagery.
- The look of an AI infrastructure company: neon grids, terminal aesthetics, glowing gradients as decoration.
- Closing the circle in any motif.

## Voice

Plain, warm and exact. Say what the reader can do and what the system does today; state limits next to claims, as the R2 report does, and claim nothing beyond it.
