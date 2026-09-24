// 本番（ブラウザを立ち上げて録画）を回す前に、APIとのやり取りだけを検証する。
// background.js と同じ形で1回だけ呼び、返ってきた計画が条件を満たすか確かめる。
//
//   cd lab && node 001-form-agent/script/preflight.mjs
//
// 1回あたり1〜2円。本番を回して途中で落ちるより、はるかに安く速く原因が分かる。
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "_local");
const pick = (f, e) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : process.env[e] || "").trim();
const KEY = pick("apikey.txt", "ANTHROPIC_API_KEY");
const WS = pick("workspace.txt", "ANTHROPIC_WORKSPACE_ID");
if (!KEY) { console.error("APIキーがありません（_local/apikey.txt）"); process.exit(1); }

// ---- background.js と同じものをここに写す ------------------------------
const FILL_TOOL = {
  name: "fill_form",
  description: "フォームの各欄に入れる値を、まとめて返す",
  input_schema: {
    type: "object",
    properties: {
      fills: {
        type: "array", description: "埋める欄。埋めないものは含めない",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" }, value: { type: "string" }, reason: { type: "string" }
          },
          required: ["ref", "value", "reason"]
        }
      },
      ask: { type: "array", items: { type: "string" } },
      done: { type: "boolean" }
    },
    required: ["fills"]
  }
};

const PROFILE = {
  "氏名（漢字）": "山田 太郎", "氏名（カナ）": "やまだ たろう",
  "メールアドレス": "taro@example.com", "電話番号": "090-1234-5678",
  "勤務先": "株式会社サキドリ", "その他": "従業員規模 51〜100名"
};
const NOTE = "請求書の宛名を変更したいです。製品や料金の問い合わせではありません。急ぎです。連絡はメールで。";

// 本番と同じツリー（動作確認用フォームを読んだ結果に相当）
const TREE = [
  'textbox "会社名" [ref_1] required hint="株式会社サキドリ"',
  'textbox "お名前" [ref_2] required hint="山田 太郎"',
  'textbox "お名前（全角カナ）" [ref_3] required hint="ヤマダ タロウ"',
  'textbox "電話番号" [ref_4] required maxlength=4',
  'textbox "電話番号" [ref_5] required maxlength=4',
  'textbox "電話番号" [ref_6] required maxlength=4',
  'textbox "メールアドレス" [ref_7] required hint="taro@example.com"',
  'combobox "従業員規模" [ref_8] required value="選択してください" options="選択してください／1〜10名／11〜50名／51〜100名／101〜300名"',
  'combobox "ご検討時期" [ref_9] required value="選択してください" options="選択してください／すぐに導入したい／3ヶ月以内／6ヶ月以内／1年以内／情報収集のみ"',
  'radio "製品について" [ref_10] group="kind"',
  'radio "料金について" [ref_11] group="kind"',
  'radio "その他" [ref_12] group="kind"',
  'checkbox "メール" [ref_13] group="byMail"',
  'checkbox "電話" [ref_14] group="byTel"',
  'textbox "お問い合わせ内容" [ref_15]',
  'checkbox "同意する" [ref_16] required',
  'button "送信する" [ref_17]'
].join("\n");

function systemPrompt(profile, note) {
  const p = Object.entries(profile).map(([k, v]) => `- ${k}：${v}`).join("\n");
  return `あなたはWebフォームの記入を手伝います。欄の一覧を受け取り、埋める値をまとめて返してください。

## 利用者の情報（端末に保存されているもの）
${p}

## 今回の指示
${note}

## 埋め方
- **必須の欄（required）は、空のまま残さない。** 保存された情報に無くても、指示の内容から最も妥当なものを選ぶ。
  選択肢のある欄（combobox・radio）は必ずどれかを選ぶこと。**空欄だと人が送信できません**
- **推測したときは reason にその旨を書く。**
- **次の3つだけは推測せず、ask に入れる：** 金額／生年月日などの個人を特定する情報／同意・承諾のチェック
- 任意の欄は、手がかりが無ければ埋めなくてよい
- **button は返さない**
- すでに正しい値が入っている欄は返さない

## 書式をそろえる
- 「全角カナ」「フリガナ」とある欄はカタカナに直す
- 電話番号や郵便番号が複数の欄に分かれていたら、自分で分割して入れる
- checkbox と radio は value を checked にする

## error="…" が付いている欄
送信して怒られた欄です。そのエラー文を読んで、正しい値に直してください。`;
}

const t0 = Date.now();
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true", ...(WS ? { "anthropic-workspace-id": WS } : {})
  },
  body: JSON.stringify({
    model: "claude-sonnet-5", max_tokens: 4000,
    system: systemPrompt(PROFILE, NOTE),
    tools: [FILL_TOOL], tool_choice: { type: "tool", name: "fill_form" },
    messages: [{ role: "user", content: `次のフォームを埋めてください。\n\n${TREE}` }]
  })
});
const body = await res.text();
if (!res.ok) {
  let m = body.slice(0, 400); try { m = JSON.parse(body).error.message; } catch { }
  console.error(`× ${res.status}: ${m}`); process.exit(1);
}
const d = JSON.parse(body);
const use = (d.content || []).find(b => b.type === "tool_use" && b.name === "fill_form");
if (!use) { console.error("× fill_form が返ってこなかった"); process.exit(1); }
const plan = use.input || {};
const by = Object.fromEntries((plan.fills || []).map(f => [String(f.ref), f]));

console.log(`1回の呼び出しで返ってきました（${((Date.now() - t0) / 1000).toFixed(1)}秒、入力${d.usage.input_tokens}/出力${d.usage.output_tokens}トークン）\n`);
for (const f of plan.fills || []) console.log(`   ${String(f.ref).padEnd(7)} ${String(f.value).slice(0, 34).padEnd(36)} ${f.reason}`);
if (plan.ask?.length) console.log(`\n   人に聞く：${plan.ask.join("／")}`);

let ng = 0;
const check = (cond, label, extra = "") => { console.log(`  ${cond ? "○" : "×"} ${label}${extra ? "  … " + extra : ""}`); if (!cond) ng++; };
console.log("");
const REQUIRED = ["ref_1", "ref_2", "ref_3", "ref_4", "ref_5", "ref_6", "ref_7", "ref_8", "ref_9"];
const miss = REQUIRED.filter(r => !by[r]);
check(miss.length === 0, "必須の欄がすべて埋まっている", miss.length ? `未記入：${miss.join(", ")}` : "");
check(!!by.ref_9, "「ご検討時期」を選んでいる（前回の積み残し）", by.ref_9 ? `${by.ref_9.value}（${by.ref_9.reason}）` : "空のまま");
check(/^[ァ-ヶー\s]+$/.test(by.ref_3?.value || ""), "カナ欄が全角カタカナ", by.ref_3?.value || "（無し）");
check(by.ref_4?.value === "090" && by.ref_5?.value === "1234" && by.ref_6?.value === "5678",
  "電話番号が3つに分かれている", [by.ref_4?.value, by.ref_5?.value, by.ref_6?.value].join(" / "));
check(!!by.ref_12, "「その他」を選んでいる（指示の内容から）", by.ref_12 ? "選択" : "未選択");
check(!!by.ref_13 && !by.ref_14, "連絡方法がメールだけ", `メール=${!!by.ref_13} 電話=${!!by.ref_14}`);
check(!by.ref_16, "同意のチェックは勝手に入れていない", by.ref_16 ? "入れてしまっている" : "入れていない");
check(!by.ref_17, "送信ボタンを返していない");

console.log(ng ? `\n× ${ng}件、期待どおりではありません。` : "\n○ すべて期待どおり。本番を回せます。");
process.exit(ng ? 1 : 0);
