// ブラウザ内蔵AI（Chrome の Gemini Nano）を、録画用の専用プロファイルに取り込む。
//
//   cd lab && node 001-form-agent/script/setup-local-ai.mjs
//
// ・_local/chrome-profile/ に専用のプロファイルを作る（普段使いの Chrome には触りません）
// ・端末の性能判定を回避するフラグを付けて起動し、モデルの取得を促す
// ・2〜4GB のダウンロードになるので時間がかかります。途中で閉じても、次回続きから始まります
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(HERE, "..", "_local", "chrome-profile");
const CHROMES = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].filter(Boolean);

const exe = CHROMES.find(p => existsSync(p));
if (!exe) { console.error("Chrome が見つかりません（内蔵AIは Chrome だけです）。BROWSER_PATH で指定してください。"); process.exit(1); }
mkdirSync(PROFILE, { recursive: true });

// chrome://flags の「Enabled BypassPerfRequirement」に相当する指定
const FEATURES = [
  "OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*",
  "OptimizationGuideModelExecution",
  "AIPromptAPI",
  "AIPromptAPIForExtension",
  "PromptAPIForGeminiNano",
  "PromptAPIForGeminiNanoMultimodalInput"
].join(",");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const size = d => { // モデル置き場の大きさ（MB）
  try {
    let t = 0;
    const walk = p => { for (const e of readdirSync(p, { withFileTypes: true })) {
      const q = join(p, e.name); if (e.isDirectory()) walk(q); else t += statSync(q).size; } };
    walk(join(PROFILE, "optimization_guide_model_store"));
    return Math.round(t / 1024 / 1024);
  } catch { return 0; }
};

console.log(`Chrome        ${exe}`);
console.log(`プロファイル  ${PROFILE}`);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: false,
  defaultViewport: null,
  userDataDir: PROFILE,
  args: [`--enable-features=${FEATURES}`, "--no-first-run", "--no-default-browser-check", "--window-size=1000,760"]
});

try {
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" });

  // 取得を促す。downloadable なら create() が取得を始める
  const kick = () => page.evaluate(async () => {
    if (typeof LanguageModel === "undefined") return { av: "APIなし" };
    let av = "unavailable";
    try { av = await LanguageModel.availability(); } catch (e) { return { av: "確認できず", err: String(e).slice(0, 120) }; }
    if (av === "downloadable" || av === "downloading") {
      try {
        const s = await LanguageModel.create({ monitor(m) { m.addEventListener("downloadprogress", e => { window.__p = e.loaded; }); } });
        s.destroy?.();
        return { av: "available", note: "取得できました" };
      } catch (e) { return { av, err: String(e).slice(0, 120) }; }
    }
    return { av };
  });

  // コンポーネントの更新も促す
  try {
    const cp = await browser.newPage();
    await cp.goto("chrome://components", { waitUntil: "domcontentloaded" });
    await cp.evaluate(() => {
      for (const b of document.querySelectorAll("button")) {
        const row = b.closest("div");
        if (row && /Optimization Guide On Device/i.test(row.innerText || "")) b.click();
      }
    }).catch(() => null);
    await cp.close();
  } catch { /* 読めなくても続行 */ }

  const LIMIT = Number(process.env.MINUTES || 25) * 60 * 1000;
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < LIMIT) {
    const r = await kick().catch(e => ({ av: "評価失敗", err: String(e).slice(0, 80) }));
    const mb = size();
    const line = `${Math.round((Date.now() - t0) / 1000)}秒  状態=${r.av}  モデル置き場=${mb}MB${r.err ? "  " + r.err : ""}${r.note ? "  " + r.note : ""}`;
    if (line.slice(line.indexOf("状態")) !== last) { console.log("  " + line); last = line.slice(line.indexOf("状態")); }
    if (r.av === "available") { console.log("\n○ 使えるようになりました。"); break; }
    if (r.av === "APIなし") { console.log("\n× この Chrome には LanguageModel がありません。"); break; }
    await sleep(15000);
  }
  const mb = size();
  console.log(`\nモデル置き場  ${mb}MB（Gemini Nano なら 2000MB 以上になります）`);
  if (mb < 500) {
    console.log(`
× まだ降りてきていません。考えられること：
  ・この端末がまだ配信の対象になっていない（段階的に広げられています）
  ・GPU の条件を満たしていない（内蔵GPUでは弾かれることがあります）
  時間をおいて、もう一度このコマンドを実行してみてください。`);
  }
} finally {
  await sleep(1000);
  browser.process()?.kill("SIGKILL");
}
process.exit(0);
