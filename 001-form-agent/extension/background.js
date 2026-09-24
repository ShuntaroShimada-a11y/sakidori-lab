// 裏で動く部分。Anthropic の API を呼ぶのはここだけ。
// ページの中（content.js）から呼ぶことで、サイト側の CSP の影響を受けずに通信できる。
// APIキーとプロフィールは端末内（chrome.storage.local）にあり、外へは Anthropic 以外に送らない。
//
// 方式：フォームの欄を一覧にして渡し、「どの欄に何を入れるか」をまとめて1回で返させる。
// 1手ずつ道具を呼ばせる往復方式に比べ、呼び出しが 10〜16回 → 1〜3回、費用も時間も数分の一になる。

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 4000;

// 返事の形を決めておく（道具の入力スキーマとして渡し、必ずこの形で返させる）
const FILL_TOOL = {
  name: "fill_form",
  description: "フォームの各欄に入れる値を、まとめて返す",
  input_schema: {
    type: "object",
    properties: {
      fills: {
        type: "array",
        description: "埋める欄。埋めないものは含めない",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "欄の番号。例 ref_3" },
            value: { type: "string", description: "入れる値。checkbox と radio は checked" },
            reason: { type: "string", description: "なぜその値にしたかを15〜40字の日本語で。推測したときはその旨を書く" }
          },
          required: ["ref", "value", "reason"]
        }
      },
      ask: {
        type: "array",
        description: "人にしか埋められない欄の名前（金額・個人情報・同意など）",
        items: { type: "string" }
      },
      done: { type: "boolean", description: "これで埋め終わりなら true" }
    },
    required: ["fills"]
  }
};

function systemPrompt(profile, note) {
  const p = Object.entries(profile || {}).filter(([, v]) => String(v || "").trim());
  return `あなたはWebフォームの記入を手伝います。欄の一覧を受け取り、埋める値をまとめて返してください。

## 利用者の情報（端末に保存されているもの）
${p.length ? p.map(([k, v]) => `- ${k}：${v}`).join("\n") : "（未設定）"}

## 今回の指示
${note ? note : "（とくになし。保存されている情報だけで埋めてください）"}

## 埋め方
- **必須の欄（required）は、空のまま残さない。** 保存された情報に無くても、指示の内容から最も妥当なものを選ぶ。
  選択肢のある欄（combobox・radio）は必ずどれかを選ぶこと。**空欄だと人が送信できません**
- **推測したときは reason にその旨を書く。** 例「『急ぎ』とあるので『すぐに導入したい』を選びました」。
  推測した欄には確認画面で印が付き、人が見直します。だから推測してよい——ただし黙って入れないこと
- **次の3つだけは推測せず、ask に入れる：** 金額／生年月日などの個人を特定する情報／同意・承諾のチェック
- 任意の欄は、手がかりが無ければ埋めなくてよい
- **button は返さない**（送信は人が行います）
- すでに正しい値が入っている欄は返さない

## 書式をそろえる
- 「全角カナ」「フリガナ」とある欄はカタカナに直す
- 電話番号や郵便番号が複数の欄に分かれていたら、自分で分割して入れる
- hint="…" は入力例。その形式に合わせる
- checkbox と radio は value を checked にする

## error="…" が付いている欄
送信して怒られた欄です。**そのエラー文を読んで、正しい値に直してください。**`;
}

async function callClaude(tree, profile, note) {
  const st = await chrome.storage.local.get(["apiKey", "workspaceId"]);
  const key = (st.apiKey || "").trim();
  const ws = (st.workspaceId || "").trim();
  if (!key) return { error: "APIキーが未設定です。拡張機能の設定画面で入れてください。" };

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        ...(ws ? { "anthropic-workspace-id": ws } : {})
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(profile, note),
        tools: [FILL_TOOL],
        tool_choice: { type: "tool", name: "fill_form" },
        messages: [{ role: "user", content: `次のフォームを埋めてください。\n\n${tree}` }]
      })
    });
  } catch (e) {
    return { error: "通信に失敗しました：" + String(e).slice(0, 200) };
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* そのまま */ }
    if (res.status === 401) msg = "APIキーが違います。設定画面で確認してください。";
    if (res.status === 429) msg = "利用が集中しています。少し待ってからお試しください。";
    if (/anthropic-workspace-id/.test(msg)) {
      msg = "このAPIキーは組織全体のキーです。設定画面の「ワークスペースID」を入れるか、ワークスペース内で作り直したキーをお使いください。";
    }
    return { error: `${res.status}：${msg}` };
  }
  try {
    const d = JSON.parse(text);
    const use = (d.content || []).find(b => b.type === "tool_use" && b.name === "fill_form");
    if (!use) return { error: "返事の形が想定と違いました。もう一度お試しください。" };
    return { plan: use.input || {} };
  } catch {
    return { error: "応答を読めませんでした。" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "plan") {
    callClaude(msg.tree, msg.profile, msg.note).then(sendResponse);
    return true; // 非同期で返す
  }
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    return false;
  }
});

// ツールバーのボタンを押したときだけ、そのタブに入り込む（activeTab 権限）
chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {
    // chrome:// など、拡張機能が入れないページ
    console.warn("このページでは動かせません", e);
  }
});
