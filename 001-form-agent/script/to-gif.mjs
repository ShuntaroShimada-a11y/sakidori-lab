// 録画したコマ画像から GIF を作る。
//   cd lab && node 001-form-agent/script/to-gif.mjs
//
// なぜ GIF も要るか：X（旧Twitter）はアニメーションWebPに対応していない。
// GIF で投稿すると X 側で自動的に動画に変換される。
// Zenn・GitHub・紹介ページは WebP のままでよい（軽い）。
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "_local");
const DIR = join(OUT, "frames");
if (!existsSync(DIR)) { console.error("コマ画像がありません。先に録画してください（npm run rec:001）"); process.exit(1); }

const files = readdirSync(DIR).filter(f => f.endsWith(".png")).sort();
if (files.length < 2) { console.error("コマ画像が足りません"); process.exit(1); }

const WIDTH = Number(process.env.WIDTH || 760);   // X の表示幅に合わせる。大きいほど重い
const MAX = Number(process.env.MAX || 40);        // 使うコマ数の上限
const step = Math.max(1, Math.ceil(files.length / MAX));
const use = files.filter((_, i) => i % step === 0);

console.log(`コマ ${files.length} 枚 → ${use.length} 枚（${step}枚おき）・横${WIDTH}px`);

const frames = await Promise.all(use.map(f => sharp(readFileSync(join(DIR, f))).resize({ width: WIDTH }).png().toBuffer()));
const delay = frames.map((_, i) => (i === 0 ? 1400 : i === frames.length - 1 ? 3000 : 420 * step));

const stamp = (readdirSync(OUT).filter(f => /^run-.*\.webp$/.test(f)).sort().pop() || "run").replace(/\.webp$/, "");
const out = join(OUT, `${stamp}.gif`);
const gif = await sharp(frames, { join: { animated: true } }).gif({ loop: 0, delay, colours: 128 }).toBuffer();
writeFileSync(out, gif);

const mb = gif.length / 1024 / 1024;
console.log(`\nGIF  ${out}`);
console.log(`     ${mb.toFixed(1)}MB`);
if (mb > 15) console.log("     ！ X の上限（15MB）を超えています。WIDTH か MAX を小さくしてください");
else console.log("     X にそのまま投稿できます（X 側で動画に変換されます）");
