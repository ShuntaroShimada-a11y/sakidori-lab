// APIを使わずに、content.js を最後まで通す。
// chrome.* を差し替え、AIの代わりに「ツリーを読んで値を決める偽の頭脳」を使う。
// 本番の前にこれを通しておけば、ブラウザ上の実行時エラーはここで出る。
//
//   cd lab && node 001-form-agent/script/dryrun.mjs
//
// 費用ゼロ。落ちたら原因を表示する。
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..", "extension");
const PORT = 8898;
const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome"
].filter(Boolean);
const exe = BROWSERS.find(p => existsSync(p));
if (!exe) { console.error("ブラウザが見つかりません"); process.exit(1); }

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };
const server = createServer((req, r) => {
  const p = join(EXT, "test", (req.url || "/").split("?")[0] === "/" ? "form.html" : (req.url || "").split("?")[0]);
  if (/favicon/.test(req.url || "")) { r.writeHead(204); r.end(); return; }
      if (!existsSync(p)) { r.writeHead(404); r.end("no"); return; }
  r.writeHead(200, { "content-type": MIME[extname(p)] || "text/plain" });
  r.end(readFileSync(p));
});
await new Promise(r => server.listen(PORT, r));

const PROFILE = {
  "氏名（漢字）": "山田 太郎", "氏名（カナ）": "やまだ たろう",
  "メールアドレス": "taro@example.com", "電話番号": "090-1234-5678",
  "勤務先": "株式会社サキドリ", "その他": "従業員規模 51〜100名"
};

const browser = await puppeteer.launch({
  executablePath: exe, headless: false, defaultViewport: null,
  userDataDir: mkdtempSync(join(tmpdir(), "sk-dry-")),
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,960"]
});

let ng = 0;
const check = (c, label, extra = "") => { console.log(`  ${c ? "○" : "×"} ${label}${extra ? "  … " + extra : ""}`); if (!c) ng++; };

try {
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  page.on("console", m => { const x = m.text(); if (m.type() === "error" && !/favicon/i.test(x)) errors.push("console: " + x.slice(0, 200)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });

  // chrome.* を差し替える。AIの代わりに、ツリーを読んで値を決める偽の頭脳を使う。
  await page.evaluate(profile => {
    window.__calls = [];
    const fake = tree => {
      const rows = tree.split("\n").map(l => ({
        ref: (l.match(/\[(ref_\d+)\]/) || [])[1],
        label: (l.match(/"([^"]*)"/) || [])[1] || "",
        line: l
      })).filter(r => r.ref);
      const fills = [];
      const put = (re, value, reason, nth = 0) => {
        const hit = rows.filter(r => re.test(r.label));
        const r = hit[nth];
        if (r && !fills.some(f => f.ref === r.ref)) fills.push({ ref: r.ref, value, reason });
      };
      put(/会社名/, "株式会社サキドリ", "保存された勤務先から");
      put(/^お名前$/, "山田 太郎", "保存された氏名から");
      put(/カナ/, "ヤマダ タロウ", "ひらがなを全角カナに直しました");
      put(/電話/, "090", "電話番号を3つに分けました", 0);
      put(/電話/, "1234", "電話番号を3つに分けました", 1);
      put(/電話/, "5678", "電話番号を3つに分けました", 2);
      put(/メールアドレス/, "taro@example.com", "保存されたメールから");
      put(/従業員規模/, "51〜100名", "保存された情報から");
      put(/検討時期/, "すぐに導入したい", "「急ぎです」とあるので推測しました");
      put(/その他/, "checked", "製品でも料金でもないため");
      put(/^メール$/, "checked", "「連絡はメールで」とあるため");
      put(/お問い合わせ内容/, "請求書の宛名を変更したいです。急ぎでの対応をお願いします。", "指示の内容から");
      put(/種別の詳細/, "請求書の宛名変更について", "選んだあとに現れた欄を埋めました");
      return { fills, ask: ["同意するチェック"], done: true };
    };
    window.chrome = {
      storage: { local: { get: async () => ({ apiKey: "dummy", profile, brain: "claude", workspaceId: "" }) } },
      runtime: {
        sendMessage: async m => {
          if (m?.type !== "plan") return {};
          window.__calls.push(m.tree);
          return { plan: fake(m.tree) };
        },
        openOptionsPage: () => { }
      }
    };
  }, PROFILE);

  // content.js をそのまま読み込む
  await page.addScriptTag({ content: readFileSync(join(EXT, "content.js"), "utf8") });
  await page.waitForFunction(() => !!document.querySelector("[data-sk-panel]")?.shadowRoot?.getElementById("note"), { timeout: 10000 });
  check(true, "パネルが出た");

  await page.evaluate(() => {
    const sr = document.querySelector("[data-sk-panel]").shadowRoot;
    sr.getElementById("note").value = "請求書の宛名を変更したいです。製品や料金の問い合わせではありません。急ぎです。連絡はメールで。";
    sr.getElementById("go").click();
  });

  await page.waitForFunction(() => {
    const sr = document.querySelector("[data-sk-panel]")?.shadowRoot;
    return !!(sr?.getElementById("list") || sr?.querySelector(".err"));
  }, { timeout: 60000, polling: 400 }).catch(() => { });

  const r = await page.evaluate(() => {
    const sr = document.querySelector("[data-sk-panel]")?.shadowRoot;
    const val = n => document.querySelector(`[name=${n}]`)?.value || "";
    return {
      calls: window.__calls.length,
      log: (() => { try { return JSON.parse(document.querySelector("[data-sk-panel]")?.dataset.log || "[]"); } catch { return []; } })(),
      rows: [...(sr?.querySelectorAll(".f") || [])].length,
      err: sr?.querySelector(".err")?.textContent?.trim() || "",
      form: {
        company: val("company"), kana: val("kana"),
        tel: [val("tel1"), val("tel2"), val("tel3")].join("-"),
        email: val("email"), scale: val("scale"), when: val("when"),
        kind: document.querySelector("input[name=kind]:checked")?.value || "",
        detail: val("otherDetail"),
        byMail: !!document.querySelector("[name=byMail]")?.checked,
        agree: !!document.querySelector("[name=agree]")?.checked
      }
    };
  });

  console.log("");
  check(errors.length === 0, "実行時エラーが出ていない", errors.slice(0, 2).join(" / "));
  check(r.form.company === "株式会社サキドリ", "会社名", r.form.company);
  check(r.form.kana === "ヤマダ タロウ", "カナに変換された", r.form.kana);
  check(r.form.tel === "090-1234-5678", "電話番号が3つに分かれた", r.form.tel);
  check(r.form.email === "taro@example.com", "メール", r.form.email);
  check(r.form.scale === "51〜100名", "従業員規模", r.form.scale);
  check(r.form.when === "すぐに導入したい", "ご検討時期（必須）が埋まった", r.form.when || "空のまま");
  check(r.form.kind === "other", "「その他」が選ばれた", r.form.kind);
  check(r.form.detail.length > 3, "選んだあとに現れた欄が埋まった", r.form.detail || "空のまま");
  check(r.form.byMail === true, "連絡方法がメール");
  check(r.form.agree === false, "同意チェックは入れていない");
  check(r.rows >= 12, "確認画面に記録が出た", `${r.rows}件`);
  check(r.calls <= 2, "AIへの問い合わせが2回以内", `${r.calls}回`);
  check(!r.err, "エラー表示が出ていない", r.err);

  console.log("\n— 実況 —");
  r.log.forEach(l => console.log("   " + l));
} catch (e) {
  console.error("\n× 失敗：" + String(e).split("\n")[0]);
  ng++;
} finally {
  await new Promise(r => setTimeout(r, 800));
  browser.process()?.kill("SIGKILL");
  server.close();
}
console.log(ng ? `\n× ${ng}件、期待どおりではありません。直してから本番を回してください。` : "\n○ すべて通りました。本番を回せます。");
process.exit(ng ? 1 : 0);
