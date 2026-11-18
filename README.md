# Notes to Myself

Short philosophy lessons grounded in public-domain primary texts. Each lesson ends with a page the learner writes for their own journal.

## Layout

- `index.html`: the whole site. It loads the course, every week plan and every available lesson as JSON.
- `content/course.json`: the weeks in the order a learner meets them. Days are numbered across the course, so Week 2 runs from Day 8 to Day 14 and `?day=8` opens its first lesson.
- `content/weeks/`: week plans (sequence, objectives, misconception targeted each day). Set `"available": true` on a planned lesson once its file exists.
- `content/lessons/`: one JSON file per lesson. The passage is pasted verbatim from the edition, and every claim carries the exact words that support it.
- `content/audio/`: narration, made with `tools/voice/voice.mjs`.
- `tools/validate.mjs`: checks every lesson. It runs in GitHub Actions before each deploy and in the page's reviewer view.
- `tools/serve.ps1`: local preview server for Windows (no Node or Python needed).
- `portfolio/philosophy-landing.html`: the landing section pasted into the portfolio's website builder. It isn't deployed from here.

## Lesson types

- `audio`: a narrated script, then a check. Week 1 uses a sort (`"check": { "type": "sort" }`); Week 2 uses multiple choice (`"type": "choice"`), where each wrong option names the misreading it represents.
- `scenario`: a branching scenario with pre-made choices. Every path folds back to the same next moment and reaches the ending within four steps.
- `thought_experiment`: the learner rates a worry, walks through three to six guided steps, rates it again, then answers a multiple-choice check. Steps that retell the passage list the claims that support them in `supported_by`.

A lesson can look back to any earlier day in the course, including an earlier week: its retrieval question, its practice follow-up, and claims marked `"from": "<lesson id>"`, which are checked against that lesson's passage.

## Reviewing a lesson

1. Run `powershell -ExecutionPolicy Bypass -File tools/serve.ps1` (the flag applies to this one run only) and open <http://localhost:8765/?preview=1>. Add `&day=8` (or any day) to jump to a lesson.
2. Read the script against the source. The reviewer view at the bottom lists each claim beside its supporting words, plus any claims that come from outside the passage, with a link to the evidence where there is one.
3. In the lesson file, set each checked `outside_source_claims[].status` to `verified`, then set `review.status` to `approved` and fill `review.approved_on`.
4. Narrate the approved lesson: `node tools/voice/voice.mjs w02-d1 --voice af_heart`. Audition a voice first with `--sample`. Add respellings for names the voice gets wrong to `tools/voice/pronunciations.json`.

Visitors only see lessons whose `review.status` is `approved`. A draft shows a "being checked" notice instead.

## Deploying

A push to any branch runs the validator. A push to `main` also deploys `index.html`, `content/` and the validator to the host over FTPS.
