// Lesson validator. Runs in Node (CI) and in the browser (index.html review view).
// Errors block a deploy. Warnings are things a reviewer should look at.

const QUOTE_RE = /[“"]([^“”"]+)[”"]/g;
const ANY_QUOTE_RE = /[“”"]/;

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function validateLesson(lesson, week) {
  const errors = [];
  const warnings = [];
  const passage = lesson.source?.passage ?? "";
  const approved = lesson.review?.status === "approved";

  if (!lesson.id) errors.push("lesson has no id");
  if (!passage.trim()) errors.push("source.passage is empty");
  if (/PASTE SECTION|COPY THE EXACT WORDS/.test(JSON.stringify(lesson))) {
    errors.push("placeholder text is still in the lesson");
  }

  // Week plan agreement
  const planned = week?.lessons?.find((l) => l.id === lesson.id);
  if (!planned) {
    errors.push(`${lesson.id} is not in week plan ${week?.week_id ?? "(none)"}`);
  } else {
    if (String(planned.section) !== String(lesson.source?.section)) {
      errors.push(`source.section ${lesson.source?.section} differs from the week plan (${planned.section})`);
    }
    for (const key of ["title", "objective", "day"]) {
      if (planned[key] !== lesson[key]) warnings.push(`${key} differs from the week plan`);
    }
    if (lesson.practice?.text && planned.practice !== lesson.practice.text) {
      warnings.push("practice.text differs from the week plan");
    }
  }

  // Script
  if (lesson.type === "audio") {
    const text = lesson.script?.text ?? "";
    const [min, max] = lesson.script?.target_words ?? [0, Infinity];
    const words = countWords(text);
    if (words < min || words > max) {
      errors.push(`script is ${words} words; target is ${min}-${max}`);
    }
    const quoted = [...text.matchAll(QUOTE_RE)].map((m) => m[1]);
    for (const q of quoted) {
      if (!passage.includes(q)) errors.push(`script quotes text that is not in the passage: "${q}"`);
    }
    if (quoted.length === 0 && ANY_QUOTE_RE.test(text)) {
      errors.push("script has an unpaired quotation mark");
    }
  }

  // Claims
  if (!Array.isArray(lesson.claims) || lesson.claims.length === 0) {
    errors.push("lesson has no claims");
  }
  for (const c of lesson.claims ?? []) {
    if (!c.support_span || !passage.includes(c.support_span)) {
      errors.push(`support_span is not an exact substring of the passage: "${c.claim}"`);
    }
  }
  const open = (lesson.outside_source_claims ?? []).filter((c) => c.status === "needs_human_check");
  if (open.length) {
    const msg = `${open.length} outside-source claim(s) still need a human check`;
    (approved ? errors : warnings).push(msg);
  }

  // Check activity
  const check = lesson.check;
  if (check?.type === "sort") {
    const lists = Object.keys(check.lists ?? {});
    if (lists.length !== 2) errors.push("check.lists must name exactly two lists");
    const used = new Set();
    for (const item of check.items ?? []) {
      if (!lists.includes(item.list)) errors.push(`sort item has an unknown list: "${item.text}"`);
      used.add(item.list);
      if (!item.feedback) errors.push(`sort item has no feedback: "${item.text}"`);
      if (!item.misconception) errors.push(`sort item names no misconception: "${item.text}"`);
      if (!item.passage_term || !passage.includes(item.passage_term)) {
        errors.push(`sort item's passage_term is not in the passage: "${item.text}"`);
      }
    }
    if ((check.items ?? []).length < 4) errors.push("sort check needs at least 4 items");
    if (used.size < 2) errors.push("sort check must use both lists");
  } else if (check?.options) {
    const right = check.options.filter((o) => o.correct);
    if (right.length !== 1) errors.push("check.options must have exactly one correct option");
    for (const o of check.options) {
      if (!o.correct && !o.misconception) errors.push(`wrong option names no misconception: "${o.text}"`);
      if (!o.feedback) errors.push(`option has no feedback: "${o.text}"`);
    }
  } else if (lesson.type === "audio") {
    errors.push("lesson has no check activity");
  }

  // Retrieval
  if (lesson.retrieval) {
    const target = week?.lessons?.find((l) => l.id === lesson.retrieval.of);
    if (!target || target.day >= lesson.day) {
      errors.push("retrieval must point to a lesson earlier in the week");
    }
  }

  // Reflection
  if (!lesson.reflection?.prompt) errors.push("lesson has no reflection prompt");
  for (const f of lesson.reflection?.fields ?? []) {
    if (!f.id || !f.label) errors.push("reflection field needs an id and a label");
  }

  // Approval
  if (approved && !lesson.review.approved_on) warnings.push("approved lesson has no review.approved_on date");

  return { errors, warnings };
}

// ---- Node command line: node tools/validate.mjs ----
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("validate.mjs")) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const weeks = {};
  for (const f of fs.readdirSync("content/weeks")) {
    const w = read(path.join("content/weeks", f));
    weeks[w.week_id] = w;
  }
  let failed = false;
  for (const f of fs.readdirSync("content/lessons").filter((n) => n.endsWith(".json"))) {
    const lesson = read(path.join("content/lessons", f));
    const { errors, warnings } = validateLesson(lesson, weeks[lesson.week_id]);
    const status = lesson.review?.status ?? "draft";
    console.log(`\n${f} [${status}] ${errors.length ? "FAIL" : "ok"}`);
    for (const e of errors) console.log(`  error: ${e}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
    if (errors.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
