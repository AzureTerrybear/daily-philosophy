// Draft a lesson with a local Ollama model, then check it with the same validator CI uses.
//
//   node tools/agent/draft.mjs w01-d1 --model qwen3:8b [--think] [--retries 3]
//
// The work is split into small steps, each with its own call and its own checks:
//   1. script      the model writes the body; code adds the practice line
//   2. tomorrow    one teaser line for the next day
//   3. claims      the model picks supporting sentences BY NUMBER; code copies the words
//   4. check       the sort activity; passage terms are picked from a fixed list
//   5. reflection  the journal prompt and two fields
// Anything that must be exact (the passage, spans, ids, the practice, review status) is
// filled in by this script, never typed by the model. Output goes to drafts/<model>/,
// which is never deployed. A human still reviews every draft.

import fs from "node:fs";
import path from "node:path";
import { validateLesson, countWords } from "../validate.mjs";

const args = process.argv.slice(2);
const lessonId = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const MODEL = flag("model", "qwen3:8b");
const RETRIES = Number(flag("retries", 3));
const THINK = args.includes("--think");
const HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
if (!lessonId) { console.error("usage: node tools/agent/draft.mjs <lesson-id> [--model name]"); process.exit(2); }

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const week = fs.readdirSync("content/weeks").map((f) => read(path.join("content/weeks", f)))
  .find((w) => w.lessons.some((l) => l.id === lessonId));
if (!week) { console.error(`${lessonId} is not in any week plan`); process.exit(2); }
const planned = week.lessons.find((l) => l.id === lessonId);
const next = week.lessons.find((l) => l.day === planned.day + 1);

// For now the passage comes from the existing lesson file. A new week would read it
// from the edition's text instead; either way the model never supplies the passage.
const existing = read(`content/lessons/${lessonId}.json`);
if (existing.type !== "audio") { console.error("this script only drafts audio lessons"); process.exit(2); }
const source = existing.source;
const passage = source.passage;

// Exact pieces of the passage the model can point at.
const sentences = passage.split(/(?<=[.!?]”?)\s+/).map((s) => s.trim()).filter(Boolean);
const terms = [...new Set(passage.split(/[,;:.!?—“”\n]+/).map((s) => s.trim()).filter((s) => s.length > 2))];
const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");

const [MIN, MAX] = [190, 240];
const practiceLine = `Today's practice: ${planned.practice.replace(/['‘’"“”]/g, "")}`;
// The tomorrow line is "Tomorrow:" plus 3 to 10 words.
const bodyMin = MIN - countWords(practiceLine) - (next ? 4 : 0);
const bodyMax = MAX - countWords(practiceLine) - (next ? 11 : 0);
const bodyAim = Math.round((bodyMin + bodyMax) / 2);

const context = `LESSON: Day ${planned.day} of "${week.title}", titled "${planned.title}"
CONCEPT: ${planned.concept}
OBJECTIVE: ${planned.objective}
COMMON MISREADING TO CORRECT: ${planned.misconception_targeted}
SOURCE: ${source.author}, ${source.work}, section ${source.section}, translated by ${source.translator}

PASSAGE (your only source):
${passage}`;

const log = [];
let calls = 0;

async function chat(messages, format) {
  const started = Date.now();
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, ...(format ? { format } : {}), stream: false, think: THINK,
      options: { temperature: 0.4, num_ctx: 8192 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const body = await res.json();
  calls++;
  return { text: body.message.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    seconds: Math.round((Date.now() - started) / 1000) };
}

// Run one step: ask, check with `problems(output)`, and on failure send back only
// those problems. Returns the last output even if it still has problems.
async function step(name, system, user, { format, parse = (t) => t, problems }) {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  let out = null;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    const { text, seconds } = await chat(messages, format);
    let issues;
    try { out = parse(text); issues = problems(out); }
    catch (err) { issues = [`The output could not be read: ${err.message}`]; }
    log.push({ step: name, attempt, seconds, issues });
    console.log(`${name} attempt ${attempt}: ${seconds}s${issues.length ? "" : ", ok"}`);
    for (const i of issues) console.log(`  - ${i}`);
    if (issues.length === 0) break;
    messages.push({ role: "assistant", content: text },
      { role: "user", content: `Fix only these problems and return the whole thing again:\n${issues.map((i) => `- ${i}`).join("\n")}` });
  }
  return out;
}

// 1. Script body ------------------------------------------------------------
const body = await step("script",
  `You write short philosophy lessons that are read aloud to adult learners. You are careful and literal: you explain what the passage says and nothing more.`,
  `${context}

Write the spoken script for this lesson in four paragraphs:
1. An everyday modern situation that raises the lesson's question. (about ${Math.round(bodyAim * 0.2)} words)
2. What the passage says, in plain modern English, following its order. Say "Epictetus says" rather than quoting. (about ${Math.round(bodyAim * 0.4)} words)
3. The common misreading named above, and how the passage itself answers it. (about ${Math.round(bodyAim * 0.25)} words)
4. Return to the opening situation and apply the idea to it. (about ${Math.round(bodyAim * 0.15)} words)

Rules:
- Total length ${bodyMin} to ${bodyMax} words. Aim for ${bodyAim}.
- Short sentences. No quotation marks of any kind. No headings, lists or labels.
- Do not add history, biography or ideas that are not in the passage.
- Do not state the practice and do not mention tomorrow; those lines are added afterwards.
Return only the script text.`,
  { parse: (t) => t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(),
    problems: (t) => {
      const issues = [];
      const n = countWords(t);
      if (n < bodyMin) issues.push(`The script is ${n} words. It must be at least ${bodyMin}. Add about ${bodyAim - n} words by developing paragraphs 2 and 3; do not repeat sentences.`);
      if (n > bodyMax) issues.push(`The script is ${n} words. It must be at most ${bodyMax}. Cut about ${n - bodyAim} words.`);
      if (/["“”‘]|(^|[\s(])['’]\w/m.test(t)) issues.push("The script contains quotation marks. Remove them and reword so none are needed.");
      if (/tomorrow/i.test(t)) issues.push("The script mentions tomorrow. Remove that.");
      return issues;
    } });

// 2. Tomorrow line ----------------------------------------------------------
let tomorrow = null;
if (next) {
  tomorrow = await step("tomorrow",
    `You write one-line teasers for the next lesson in a philosophy course.`,
    `Tomorrow's lesson is titled "${next.title}". Its idea: ${next.concept}.
Write one short teaser of at most 10 words that hints at it without explaining it. No quotation marks. Do not begin with the word Tomorrow. Return only the teaser.`,
    { parse: (t) => t.replace(/^tomorrow:?\s*/i, "").replace(/["“”]/g, "").split("\n")[0].trim(),
      problems: (t) => (countWords(t) > 10 || countWords(t) < 3 ? [`The teaser is ${countWords(t)} words. It must be 3 to 10 words.`] : []) });
}
const scriptText = [body, practiceLine, tomorrow ? `Tomorrow: ${tomorrow.charAt(0).toLowerCase()}${tomorrow.slice(1)}` : null]
  .filter(Boolean).join("\n\n");

// 3. Claims -----------------------------------------------------------------
const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const inScript = (s) => flat(s).length > 0 && flat(body).includes(flat(s));

const claimsOut = await step("claims",
  `You check a lesson script against its source passage. You are strict and literal.`,
  `PASSAGE, as numbered sentences:
${numbered}

SCRIPT:
${body}

Do two things.
A. claims: list each statement the script makes about what the passage says (4 to 7 of them). For each give the claim in the script's words and passage_sentence = the number of the ONE passage sentence that most directly supports it. Check that the sentence really says it.
B. unsupported: list every statement in the SCRIPT that no passage sentence supports, such as a stronger claim than the passage makes, a fact about the author, or a generalisation. Copy the statement from the script and say in note why the passage does not support it. Only list statements that are actually in the script. Everyday examples used as illustrations do not count. If there are none, return an empty list.`,
  { format: { type: "object", required: ["claims", "unsupported"], properties: {
      claims: { type: "array", minItems: 4, maxItems: 7, items: { type: "object", required: ["claim", "passage_sentence"],
        properties: { claim: { type: "string" }, passage_sentence: { type: "integer", minimum: 1, maximum: sentences.length } } } },
      unsupported: { type: "array", items: { type: "object", required: ["claim", "note"],
        properties: { claim: { type: "string" }, note: { type: "string" } } } } } },
    parse: JSON.parse,
    problems: (o) => {
      const issues = [];
      for (const c of o.claims) if (!sentences[c.passage_sentence - 1]) issues.push(`passage_sentence ${c.passage_sentence} does not exist; use 1 to ${sentences.length}.`);
      for (const u of o.unsupported) if (!inScript(u.claim)) issues.push(`"${u.claim}" is not a statement from the script. Under unsupported, copy statements from the SCRIPT only, or remove this entry.`);
      if (new Set(o.claims.map((c) => c.passage_sentence)).size < 3) issues.push("The claims point at fewer than three different passage sentences. Cover more of the passage.");
      return issues;
    } });

// 4. Sort check -------------------------------------------------------------
const check = await step("check",
  `You design short practice activities for adult learners. Each one tests a single idea and is built to catch a specific mistake.`,
  `${context}

Design a sorting activity. The learner reads a scenario and sorts six short statements into two lists.
- scenario: one or two sentences describing a modern situation. Do not reuse the script's opening situation.
- question: one sentence telling the learner what to sort.
- list_a_name and list_b_name: the two list headings, 1 to 4 words each.
- all_correct: one sentence shown when all six are right.
- items: exactly six, three per list, in mixed order. Each is something specific from the scenario, 4 to 12 words. Include at least two that a learner is likely to get wrong.
  - list: "a" or "b".
  - passage_term: the phrase from the passage that this item is an example of.
  - misconception: a kebab-case tag for the mistaken belief that would make a learner put THIS item in the wrong list. Items in list a and items in list b are wrong for different reasons, so they need different tags. Use two or three tags in total.
  - feedback: one or two sentences shown after the learner answers, saying which list and why, in the passage's terms.
- misconception_notes: for every tag used, one sentence for the learner explaining that mistake.`,
  { format: { type: "object", required: ["scenario", "question", "list_a_name", "list_b_name", "all_correct", "items", "misconception_notes"], properties: {
      scenario: { type: "string" }, question: { type: "string" },
      list_a_name: { type: "string" }, list_b_name: { type: "string" }, all_correct: { type: "string" },
      items: { type: "array", minItems: 6, maxItems: 6, items: { type: "object",
        required: ["text", "list", "passage_term", "misconception", "feedback"], properties: {
          text: { type: "string" }, list: { type: "string", enum: ["a", "b"] },
          passage_term: { type: "string", enum: terms },
          misconception: { type: "string" }, feedback: { type: "string" } } } },
      misconception_notes: { type: "array", items: { type: "object", required: ["tag", "note"],
        properties: { tag: { type: "string" }, note: { type: "string" } } } } } },
    parse: (t) => {
      const o = JSON.parse(t);
      const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      for (const i of o.items) i.misconception = kebab(i.misconception);
      for (const n of o.misconception_notes) n.tag = kebab(n.tag);
      return o;
    },
    problems: (o) => {
      const issues = [];
      for (const k of ["list_a_name", "list_b_name"]) if (countWords(o[k]) > 4) issues.push(`${k} is too long. Use a heading of 1 to 4 words.`);
      const a = o.items.filter((i) => i.list === "a").length;
      if (a !== 3) issues.push(`List a has ${a} items and list b has ${6 - a}. Each needs exactly three.`);
      for (const i of o.items) if (!passage.includes(i.passage_term)) issues.push(`passage_term "${i.passage_term}" is not in the passage.`);
      const tags = new Set(o.items.map((i) => i.misconception));
      for (const t of tags) if (/^(none|n-a|na|no-misconception|correct)$/.test(t)) issues.push(`"${t}" is not a misconception. Every item needs a tag naming the mistaken belief that would send it to the wrong list.`);
      if (tags.size < 2) issues.push("Every item has the same misconception tag. Wrongly moving a list-a item and wrongly moving a list-b item are different mistakes; give them different tags.");
      if (tags.size > 3) issues.push(`There are ${tags.size} misconception tags. Use two or three in total.`);
      for (const t of tags) if (!o.misconception_notes.some((n) => n.tag === t)) issues.push(`misconception_notes has no entry for "${t}".`);
      return issues;
    } });

// 5. Reflection -------------------------------------------------------------
const reflection = await step("reflection",
  `You write journal prompts for adult learners.`,
  `${context}

After the lesson the learner writes a short page in their own journal applying the idea to their own life. It should prepare them for this practice: ${planned.practice}
Write:
- prompt: one sentence inviting them to pick something from their own life.
- fields: exactly two short boxes to fill in, which together apply the lesson's idea (for example its two sides). Each has a label of 2 to 6 words and a hint of one short sentence.`,
  { format: { type: "object", required: ["prompt", "fields"], properties: {
      prompt: { type: "string" },
      fields: { type: "array", minItems: 2, maxItems: 2, items: { type: "object", required: ["label", "hint"],
        properties: { label: { type: "string" }, hint: { type: "string" } } } } } },
    parse: JSON.parse,
    problems: (o) => o.fields.filter((f) => countWords(f.label) > 8).map((f) => `The label "${f.label}" is too long. Use 2 to 6 words.`) });

// Assemble and validate -------------------------------------------------------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "field";
const lesson = {
  id: lessonId, type: "audio", week_id: week.week_id, day: planned.day,
  title: planned.title, objective: planned.objective, builds_on: planned.builds_on,
  source,
  // Retrieval and follow-up depend on earlier approved lessons; they are kept as written by the reviewer.
  ...(existing.retrieval ? { retrieval: existing.retrieval } : { retrieval: null }),
  ...(existing.practice_followup ? { practice_followup: existing.practice_followup } : {}),
  script: { target_words: [MIN, MAX], text: scriptText },
  claims: claimsOut.claims.map((c) => ({ claim: c.claim, support_span: sentences[c.passage_sentence - 1] ?? "" })),
  outside_source_claims: claimsOut.unsupported.filter((c) => inScript(c.claim)).map((c) => ({ ...c, status: "needs_human_check" })),
  check: {
    type: "sort", scenario: check.scenario, question: check.question, all_correct: check.all_correct,
    lists: { a: check.list_a_name, b: check.list_b_name },
    misconception_notes: Object.fromEntries(check.misconception_notes.map((n) => [n.tag, n.note])),
    items: check.items,
  },
  reflection: {
    prompt: reflection.prompt,
    fields: reflection.fields.map((f, i) => ({ id: `${slug(f.label)}_${i}`, ...f })),
    saved_to_handbook: true,
  },
  practice: { text: planned.practice, followed_up_in: existing.practice?.followed_up_in ?? null },
  audio: { file: null, voice: null, duration_seconds: null },
  review: { status: "draft", reviewer_notes: `Drafted by ${MODEL}. Not yet reviewed.`, approved_on: null },
  release_date: null,
};

const others = Object.fromEntries(week.lessons.filter((l) => fs.existsSync(`content/lessons/${l.id}.json`))
  .map((l) => [l.id, read(`content/lessons/${l.id}.json`)]));
const { errors, warnings } = validateLesson(lesson, week, others);
const unresolved = log.filter((e, i) => e.issues.length && log[i + 1]?.step !== e.step).flatMap((e) => e.issues.map((x) => `${e.step}: ${x}`));

const outDir = path.join("drafts", MODEL.replace(/[^a-z0-9.]+/gi, "-") + (THINK ? "-think" : ""));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${lessonId}.json`), JSON.stringify(lesson, null, 2) + "\n");
const seconds = log.reduce((s, e) => s + e.seconds, 0);
fs.writeFileSync(path.join(outDir, `${lessonId}.log.json`),
  JSON.stringify({ model: MODEL, think: THINK, calls, seconds, errors, warnings, unresolved, log }, null, 2) + "\n");

console.log(`\n${countWords(scriptText)} words, ${calls} calls, ${seconds}s`);
for (const e of errors) console.log(`  validator error: ${e}`);
for (const w of warnings ?? []) console.log(`  validator warning: ${w}`);
for (const u of unresolved) console.log(`  unresolved: ${u}`);
const passed = errors.length === 0 && unresolved.length === 0;
console.log(`${passed ? "PASSED" : "FAILED"}. Draft: ${path.join(outDir, `${lessonId}.json`)}`);
process.exit(passed ? 0 : 1);
