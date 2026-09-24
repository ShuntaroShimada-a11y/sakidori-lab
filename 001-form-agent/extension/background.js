// 裏で動く部分。Anthropic の API を呼ぶのはここだけ。
// ページの中（content.js）から呼ぶことで、サイト側の CSP の影響を受けずに通信できる。
// APIキーとプロフィールは端末内（chrome.storage.local）にあり、外へは Anthropic 以外に送らない。

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

// 使う8つ以外は全部止める。呼ばれないので、実装もエラー処理も要らなくなる。
// navigate を止めてあるのが安全上も重要（勝手に別のページへ行かせない）。
const DISABLED = [
  "navigate", "screenshot", "zoom",
  "right_click", "middle_click", "double_click", "triple_click", "hover",
  "left_click_drag", "left_mouse_down", "left_mouse_up", "mouse_move", "scroll",
  "key", "hold_key",
  "new_tab", "list_tabs", "switch_tab", "close_tab",
  "file_upload", "read_console", "read_network", "javascript_exec"
];
const CONFIGS = Object.fromEntries(DISABLED.map(k => [k, { enabled: false }]));

function systemPrompt(profile, note) {
  const p = Object.entries(profile || {}).filter(([, v]) => String(v || "").trim());
  return `あなたは、目の前のWebフォームを埋める助手です。日本語で動きます。

## 持っている情報（利用者が端末に保存したもの）
${p.length ? p.map(([k, v]) => `- ${k}：${v}`).join("\n") : "（未設定。フォームに書ける情報がありません）"}

## 今回の指示
${note ? note : "（とくに指示なし。保存されている情報だけで埋めてください）"}

## やること
1. まず read_page でページを読む。どんな項目があるか把握する
2. 上の情報から埋められる欄を、form_input と left_click で埋める
3. 画面が変わった可能性があるとき（選択によって欄が増えるなど）は read_page で読み直す
4. エラーが出たら get_page_text で内容を読み、直してやり直す
5. 埋め終わったら、何も操作せずに終了する

## 守ること
- **送信ボタンは押さない。** 確認して送信するのは人です。埋めるところまでで終わってください
- **確信が持てない欄は空のままにする。** 適当な値を入れない。とくに金額・日付・同意のチェックは慎重に
- 保存されている情報に無いことを創作しない
- CAPTCHA や画像認証が出てきたら、触らずにそこで終了する
- ログインの画面が出てきたら、触らずに終了する

## 書式の変換は自分でやる
- 「全角カナ」「フリガナ」とある欄には、カタカナに直して入れる
- 電話番号や郵便番号が複数の欄に分かれているときは、自分で分割して入れる
- placeholder に例（例：ヤマダ タロウ）があれば、その形式に合わせる

## 行動するたびに、ひとこと日本語で言う
道具を呼ぶ直前に、**何をするかを15〜30字の日本語で1文**書いてください。これは画面に実況として出て、最後の確認画面にも「なぜその値にしたか」として残ります。
例：「フォームを読みます」「名前を全角カナに直して入れます」「エラーが出たので読み直します」

## 終わり方
埋め終わったら、最後に「〇項目を埋めました。ご確認のうえ送信してください。」と1文だけ書いて終了してください。`;
}

async function callClaude(messages, profile, note) {
  const st = await chrome.storage.local.get(["apiKey"]);
  const key = (st.apiKey || "").trim();
  if (!key) return { error: "APIキーが未設定です。拡張機能の設定画面で入れてください。" };

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // ブラウザから直接呼ぶための明示（拡張機能の裏側もブラウザ扱いになる）
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(profile, note),
        tools: [{ type: "browser_toolset_20260801", configs: CONFIGS }],
        messages
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
    return { error: `${res.status}：${msg}` };
  }
  try { return { data: JSON.parse(text) }; }
  catch { return { error: "応答を読めませんでした。" }; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "call") {
    callClaude(msg.messages, msg.profile, msg.note).then(sendResponse);
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
