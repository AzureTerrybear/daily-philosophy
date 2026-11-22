# Notes to Myself (daily-philosophy)

Short philosophy lessons grounded in public-domain primary texts, each ending with a journal page the learner writes. The site is live at https://terencegovender.com/philosophy-app/ and deploys from `main` over FTPS. README.md has the layout and the review workflow.

## Commands

- Validate every lesson: `node tools/validate.mjs`. It must pass before any push; CI runs it on every branch.
- Preview: `powershell -ExecutionPolicy Bypass -File tools/serve.ps1`, then open http://localhost:8765/?preview=1&day=N (drafts only show with `preview=1`).
- Narrate an approved lesson: `node tools/voice/voice.mjs <lesson-id> --voice af_heart`. Audition first with `--sample`; add respellings to `tools/voice/pronunciations.json`.

## Rules for lesson content

- Passages are verbatim from the cited edition. Never retype, modernise or "fix" them.
- Every claim needs a `support_span` that is an exact substring of the passage, or of an earlier lesson's passage when the claim has `"from": "<lesson id>"`.
- Anything that is not in the passage (biography, history, definitions of terms) goes in `outside_source_claims` with status `needs_human_check`, ideally with `evidence`.
- Scripts put double quotes only around exact substrings of the passage.
- Only Terence approves. Never set `review.status` to `approved`, or an outside-source claim to `verified`, unless he says so for that lesson.
- Week 1 uses Higginson's Enchiridion (Project Gutenberg 45109). Week 2 uses George Long's Meditations (Standard Ebooks); that edition prints no section numbers, so sections are the standard book.section references, mapped by paragraph order and checked against the text.

## How the course fits together

- `content/course.json` orders the weeks. Days are numbered across the course: Week 2 is Days 8-14, and `?day=8` opens its first lesson. Day 8 unlocks the day after Day 7 is finished.
- Lesson types: `audio` (Week 1 uses a sort check, Week 2 a multiple-choice check), `scenario` (branching, paths fold back) and `thought_experiment` (rating, guided steps, rating, then a check).
- Visitors see only approved lessons; drafts show a "being checked" notice.

## Status (November 2026)

- Week 1 (Stoic Week, Days 1-7): approved, narrated, live.
- Week 2 (Marcus Aurelius, Days 8-14): approved (2026-11-18), narrated, live. Still to do: paste `portfolio/philosophy-landing.html` into the website builder.
- The top bar shows one week at a time with week buttons either side; every day ends with previous/next day links.
- Lessons are currently written with Claude. `tools/agent/draft.mjs` (local model via Ollama) is parked until local models run well with less VRAM.
