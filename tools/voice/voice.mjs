// Narrate a lesson script with Kokoro, a text-to-speech model that runs locally.
//
//   node voice.mjs w01-d1 --voice af_heart               full lesson -> content/audio/w01-d1.mp3
//   node voice.mjs w01-d1 --voice af_heart --sample      first two paragraphs -> drafts/voice/
//
// The full run only narrates APPROVED lessons, reads the script word for word, and
// records a fingerprint of the text so the validator can tell if the script changed
// after the audio was made. Run from anywhere; paths are relative to the repo root.

import fs from "node:fs";
import path from "node:path";
import { fingerprint } from "../validate.mjs";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";
import { Mp3Encoder } from "@breezystack/lamejs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const lessonId = args.find((a) => !a.startsWith("--"));
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const VOICE = flag("voice", "af_heart");
const SPEED = Number(flag("speed", 1));
const SAMPLE = args.includes("--sample");
if (!lessonId) { console.error("usage: node voice.mjs <lesson-id> [--voice name] [--speed 1] [--sample]"); process.exit(2); }

const lessonPath = path.join(root, "content/lessons", `${lessonId}.json`);
const raw = fs.readFileSync(lessonPath, "utf8");
const lesson = JSON.parse(raw);
const text = lesson.script?.text ?? lesson.intro;
if (!text) { console.error(`${lessonId} has no script or intro to read`); process.exit(2); }
if (!SAMPLE && lesson.review?.status !== "approved") {
  console.error(`${lessonId} is not approved. Only approved lessons are narrated (use --sample to audition a voice).`);
  process.exit(1);
}

// Respellings for words the voice gets wrong. Applied to the spoken text only.
const SAY = JSON.parse(fs.readFileSync(path.join(root, "tools/voice/pronunciations.json"), "utf8"));
const spoken = (s) => Object.entries(SAY).reduce((t, [word, as]) => t.replace(new RegExp(`\\b${word}\\b`, "g"), as), s);

let paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
if (SAMPLE) paragraphs = paragraphs.slice(0, 2);

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
if (!(VOICE in tts.voices)) { console.error(`unknown voice "${VOICE}". Voices: ${Object.keys(tts.voices).join(", ")}`); process.exit(2); }

const RATE = 24000;
const silence = (seconds) => new Float32Array(Math.round(RATE * seconds));
const parts = [silence(0.3)];
const started = Date.now();
for (const [p, para] of paragraphs.entries()) {
  const sentences = para.match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const audio = await tts.generate(spoken(sentence), { voice: VOICE, speed: SPEED });
    if (audio.sampling_rate !== RATE) throw new Error(`unexpected sample rate ${audio.sampling_rate}`);
    parts.push(audio.audio, silence(0.28));
  }
  parts.push(silence(p === paragraphs.length - 1 ? 0.4 : 0.55));
}
const total = parts.reduce((n, a) => n + a.length, 0);
const pcm = new Int16Array(total);
let at = 0;
for (const a of parts) { for (let i = 0; i < a.length; i++) pcm[at + i] = Math.max(-1, Math.min(1, a[i])) * 32767; at += a.length; }

const encoder = new Mp3Encoder(1, RATE, 64);
const chunks = [];
for (let i = 0; i < pcm.length; i += 1152) chunks.push(Buffer.from(encoder.encodeBuffer(pcm.subarray(i, i + 1152))));
chunks.push(Buffer.from(encoder.flush()));
const mp3 = Buffer.concat(chunks);
const duration = Math.round(total / RATE);

const outDir = path.join(root, SAMPLE ? "drafts/voice" : "content/audio");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, SAMPLE ? `${lessonId}-${VOICE}.mp3` : `${lessonId}.mp3`);
fs.writeFileSync(outFile, mp3);
console.log(`${path.relative(root, outFile)}: ${duration}s of audio, ${(mp3.length / 1024).toFixed(0)} KB, made in ${Math.round((Date.now() - started) / 1000)}s`);

if (!SAMPLE) {
  const audio = {
    file: `content/audio/${lessonId}.mp3`, voice: `kokoro:${VOICE}`, duration_seconds: duration,
    script_fingerprint: fingerprint(text),
  };
  // Replace only the audio line so the rest of the hand-formatted file is untouched.
  // A lesson written without an audio field gets one just before its review block.
  const base = /"audio":\s*\{[^}]*\}/.test(raw) ? raw : raw.replace(/(\n  )"review":/, `$1"audio": {},\n$1"review":`);
  const updated = base.replace(/"audio":\s*\{[^}]*\}/, `"audio": ${JSON.stringify(audio).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, "{ ").replace(/\}$/, " }")}`);
  if (updated === raw) throw new Error("could not find the audio field to update");
  fs.writeFileSync(lessonPath, updated);
  console.log(`updated ${path.relative(root, lessonPath)}`);
}
