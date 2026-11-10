# Notes to Myself

Short philosophy lessons grounded in public-domain primary texts. Each lesson ends with a page the learner writes for their own journal.

## Layout

- `index.html`: the whole site. It loads a lesson and its week plan as JSON.
- `content/weeks/`: week plans (sequence, objectives, misconception targeted each day).
- `content/lessons/`: one JSON file per lesson. The passage is pasted verbatim from the edition, and every claim in the script carries the exact words that support it.
- `tools/validate.mjs`: checks every lesson. It runs in GitHub Actions before each deploy and in the page's reviewer view.
- `tools/serve.ps1`: local preview server for Windows (no Node or Python needed).

## Reviewing a lesson

1. Run `powershell -ExecutionPolicy Bypass -File tools/serve.ps1` (the flag applies to this one run only) and open <http://localhost:8765/?preview=1>.
2. Read the script against the source. The reviewer view at the bottom lists each claim beside its supporting words, plus any claims that come from outside the passage.
3. In the lesson file, set each checked `outside_source_claims[].status` to `verified`, then set `review.status` to `approved` and fill `review.approved_on`.

Visitors only see lessons whose `review.status` is `approved`. A draft shows a "being checked" notice instead.

## Deploying

A push to any branch runs the validator. A push to `main` also deploys `index.html`, `content/` and the validator to the host over FTPS.
