// 拡張機能がフォームを埋めるところを録画する。
//
//   cd lab && npm install            … 最初の1回だけ
//   cd lab && npm run rec:001        … 撮る
//
// APIキーの渡し方（どちらか）
//   1. lab/001-form-agent/_local/apikey.txt にキーだけを書いたファイルを置く（_local は git に入らない）
//   2. 環境変数 ANTHROPIC_API_KEY
//
// 出力（すべて _local/ の中。git には入りません）
//   run-<時刻>.webp    … アニメーション（そのまま X や紹介ページに貼れる）
//   run-<時刻>-last.png … 最後の画面（確認画面）
//   run-<時刻>.log.txt  … 実況ログ
//   frames/             … 1コマずつのPNG（あとで動画にしたいとき用）
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");                       // 001-form-agent/
const EXT = join(ROOT, "extension");
const OUT = join(ROOT, "_local");
const PORT = Number(process.env.PORT || 8899);
const STAMP = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);

// 埋めてほしいことの指示。動画に出るので、短く具体的に
const NOTE = process.env.NOTE || "資料請求です。請求書の宛名を変更したい件で、急ぎです。連絡はメールで。";

// 設定画面に入れる「自分の情報」。録画用なのでダミー
const PROFILE = {
  "氏名（漢字）": "山田 太郎",
  "氏名（カナ）": "やまだ たろう",       // わざとひらがな。AIが全角カナに直すところを見せる
  "メールアドレス": "taro@example.com",
  "電話番号": "090-1234-5678",           // わざと1本。AIが3つの欄に分けるところを見せる
  "勤務先": "株式会社サキドリ",
  "その他": "従業員規模 51〜100名"
};

// ---------------------------------------------------------------- 準備
function apiKey() {
  const f = join(OUT, "apikey.txt");
  if (existsSync(f)) { const k = readFileSync(f, "utf8").trim(); if (k) return k; }
  const e = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (e) return e;
  console.error(`
APIキーが見つかりません。次のどちらかを用意してください。

  1. ${join(OUT, "apikey.txt")} にキーだけを書く（このフォルダは git に入りません）
  2. 環境変数 ANTHROPIC_API_KEY を設定する

キーは https://console.anthropic.com/settings/keys で発行できます。`);
  process.exit(1);
}

// Edge を先に試す。Chrome は 152 以降、--load-extension を無視するようになった（拡張機能が読み込めない）。
// Edge も Chromium なので、拡張機能の動きも撮れる絵も同じ。
const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"
].filter(Boolean);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
function serve() {
  return new Promise(res => {
    const s = createServer((req, r) => {
      const p = join(EXT, "test", (req.url || "/").split("?")[0] === "/" ? "form.html" : (req.url || "").split("?")[0]);
      if (!existsSync(p)) { r.writeHead(404); r.end("not found"); return; }
      r.writeHead(200, { "content-type": MIME[extname(p)] || "text/plain" });
      r.end(readFileSync(p));
    });
    s.listen(PORT, () => res(s));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- 本体
const KEY = apiKey();
const exe = BROWSERS.find(p => existsSync(p));
if (!exe) { console.error("Chrome か Edge が見つかりません。BROWSER_PATH を指定してください。"); process.exit(1); }

mkdirSync(join(OUT, "frames"), { recursive: true });
rmSync(join(OUT, "frames"), { recursive: true, force: true });
mkdirSync(join(OUT, "frames"), { recursive: true });

const server = await serve();
console.log(`確認用フォーム   http://localhost:${PORT}/`);
console.log(`ブラウザ         ${exe}`);

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: false,                       // 拡張機能を動かすには画面が要る
  defaultViewport: null,
  userDataDir: mkdtempSync(join(tmpdir(), "sk-rec-")),
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",   // これが無いと拡張機能が読み込まれない
    "--window-size=1280,960",
    "--no-first-run", "--no-default-browser-check", "--hide-crash-restore-bubble"
  ]
});

let code = 0;
try {
  // 拡張機能の裏側（service worker）を捕まえる
  const target = await browser.waitForTarget(t => t.url().startsWith("chrome-extension://"), { timeout: 25000 })
    .catch(() => { throw new Error("拡張機能が読み込まれませんでした。Chrome 152 以降は --load-extension を拒否します。Edge を使ってください（BROWSER_PATH で指定できます）。"); });
  const worker = await target.worker();
  console.log(`拡張機能         ${new URL(target.url()).host}`);

  // 設定を入れる（本来は設定画面から人が入れるところ）
  await worker.evaluate(async (k, p) => { await chrome.storage.local.set({ apiKey: k, profile: p }); }, KEY, PROFILE);
  console.log(`保存した情報     ${Object.keys(PROFILE).length} 項目`);

  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.bringToFront();
  await sleep(600);

  // ツールバーのボタンを押したのと同じことをする
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  if (!tabId) throw new Error("タブを特定できませんでした。");
  await worker.evaluate(async id => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] }); }, tabId);

  const panel = () => page.waitForFunction(
    () => !!document.querySelector("[data-sk-ui]")?.shadowRoot?.getElementById("note"), { timeout: 15000 });
  await panel();

  // ---- 撮影開始
  const frames = [];
  let shooting = true;
  const shoot = (async () => {
    while (shooting) {
      try { frames.push(await page.screenshot({ type: "png" })); } catch { /* 遷移中などは飛ばす */ }
      await sleep(420);
    }
  })();

  // 指示を書いて、下書きを始める
  await page.evaluate(t => {
    const sr = document.querySelector("[data-sk-ui]").shadowRoot;
    sr.getElementById("note").value = t;
    sr.getElementById("go").click();
  }, NOTE);
  console.log(`指示             ${NOTE}`);
  console.log("記入中…（最大3分）");

  // 確認画面かエラーが出るまで待つ
  await page.waitForFunction(() => {
    const sr = document.querySelector("[data-sk-ui]")?.shadowRoot;
    return !!(sr?.getElementById("list") || sr?.querySelector(".err") || sr?.querySelector(".note"));
  }, { timeout: 180000, polling: 800 }).catch(() => console.log("！ 時間切れ。そこまでを保存します。"));

  await sleep(2600);            // 確認画面を数コマ映す
  shooting = false; await shoot;

  // ---- 結果を取り出す
  const info = await page.evaluate(() => {
    const sr = document.querySelector("[data-sk-ui]")?.shadowRoot;
    const log = [...(sr?.querySelectorAll("#log li") || [])].map(li => li.textContent.trim());
    const rows = [...(sr?.querySelectorAll(".f") || [])].map(f => ({
      label: f.children[0].textContent.trim(), value: f.children[1].textContent.trim(), reason: f.children[2].textContent.trim()
    }));
    return { log, rows, error: sr?.querySelector(".err")?.textContent?.trim() || "" };
  });

  const base = join(OUT, `run-${STAMP}`);
  frames.forEach((b, i) => writeFileSync(join(OUT, "frames", String(i).padStart(3, "0") + ".png"), b));
  if (frames.length) writeFileSync(base + "-last.png", frames[frames.length - 1]);
  writeFileSync(base + ".log.txt",
    [`指示：${NOTE}`, "", "— 実況 —", ...info.log, "",
     `— 入力した内容（${info.rows.length}項目）—`,
     ...info.rows.map(r => `${r.label}\n  ${r.value}\n  ${r.reason}`),
     info.error ? `\n— エラー —\n${info.error}` : ""].join("\n"), "utf8");

  // アニメーションにする（最大90コマ・横900px）
  if (frames.length > 1) {
    const step = Math.max(1, Math.ceil(frames.length / 90));
    const use = frames.filter((_, i) => i % step === 0);
    const small = await Promise.all(use.map(b => sharp(b).resize({ width: 900 }).png().toBuffer()));
    const delay = small.map((_, i) => (i === 0 ? 1400 : i === small.length - 1 ? 3200 : 420 * step));
    const webp = await sharp(small, { join: { animated: true } }).webp({ quality: 74, effort: 4, loop: 0, delay }).toBuffer();
    writeFileSync(base + ".webp", webp);
    console.log(`\n動画             ${base}.webp  （${small.length}コマ・${Math.round(webp.length / 1024)}KB）`);
  }

  console.log(`静止画           ${base}-last.png`);
  console.log(`ログ             ${base}.log.txt`);
  console.log(`コマ             ${join(OUT, "frames")}（${frames.length}枚）`);
  if (info.error) { console.log(`\n！ エラー：${info.error}`); code = 1; }
  else console.log(`\n入力できた項目   ${info.rows.length}`);
  info.log.forEach(l => console.log("   ", l));
} catch (e) {
  console.error("\n！ 失敗：", String(e).split("\n")[0]);
  code = 1;
} finally {
  await sleep(1200);
  try { browser.process()?.kill("SIGKILL"); } catch { /* 閉じ損ねても結果は残っている */ }
  server.close();
}
process.exit(code);
