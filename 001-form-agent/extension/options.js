// 設定の保存と読み込み。保存先は chrome.storage.local（この端末の中だけ）。
const FIELDS = {
  name: "氏名（漢字）", kana: "氏名（カナ）", romaji: "氏名（ローマ字）", birth: "生年月日",
  email: "メールアドレス", tel: "電話番号", zip: "郵便番号", pref: "都道府県",
  city: "市区町村", addr: "番地・建物", company: "勤務先", dept: "部署・役職", misc: "その他"
};
const $ = id => document.getElementById(id);

// storage には「日本語のラベル → 値」で入れる。そのまま Claude に渡すため
async function load() {
  const { apiKey = "", profile = {}, brain = "auto" } = await chrome.storage.local.get(["apiKey", "profile", "brain"]);
  $("apiKey").value = apiKey;
  $("brain").value = brain;
  for (const [id, label] of Object.entries(FIELDS)) $(id).value = profile[label] || "";
  showAvailability();
}

// ブラウザ内蔵AIが使えるかを調べて出す
const LANGS = {
  expectedInputs: [{ type: "text", languages: ["ja", "en"] }],
  expectedOutputs: [{ type: "text", languages: ["ja"] }]
};

async function showAvailability() {
  const el = $("avail");
  if (typeof LanguageModel === "undefined") {
    el.innerHTML = "<b>このブラウザには内蔵のAIがありません。</b>Claude（APIキー）をお使いください。（内蔵AIは Chrome 138 以降）";
    return;
  }
  let av = "unavailable";
  try { av = await LanguageModel.availability(LANGS); } catch { /* そのまま */ }

  const msg = {
    available: '<b style="color:var(--ok)">内蔵のAIが使えます。</b>APIキーは不要です。',
    downloadable: "<b>内蔵のAIが使えます。</b>初回だけモデルの取得が要ります（数GB）。",
    downloading: "<b>「取得中」の状態です。</b>止まっているように見えるときは、下のボタンで取り直せます。",
    unavailable: "<b>この端末では内蔵のAIを動かせないと表示されています。</b>念のため下のボタンで試せます。だめなら Claude（APIキー）をお使いください。"
  }[av] || `状態：${av}`;

  // available 以外は、いつでも取得を始められるようにする（状態が固まることがあるため）
  el.innerHTML = msg + (av === "available" ? ""
    : ' <button id="dl" style="margin-left:8px;padding:5px 14px;font-size:13px">取得する</button>'
      + '<div id="dlp" class="sub" style="margin-top:6px"></div>');

  const dl = document.getElementById("dl");
  if (!dl) return;
  dl.onclick = async () => {
    const p = document.getElementById("dlp");
    dl.disabled = true; dl.textContent = "取得中…";
    p.innerHTML = "<b>この画面を閉じずに、そのままお待ちください。</b>数GBあるので5〜15分かかります。進捗は飛び飛びに出ます。";
    const t0 = Date.now();
    const tick = setInterval(() => {
      const m = Math.floor((Date.now() - t0) / 60000), sec = Math.floor((Date.now() - t0) / 1000) % 60;
      dl.textContent = `取得中… ${m}分${String(sec).padStart(2, "0")}秒`;
    }, 1000);
    try {
      const s = await LanguageModel.create({
        ...LANGS,
        monitor(m) {
          m.addEventListener("downloadprogress", e => {
            p.innerHTML = `<b>${Math.round((e.loaded || 0) * 100)}%</b> 取得しました。この画面を閉じないでください。`;
          });
        }
      });
      s.destroy?.();
      clearInterval(tick);
      flash("内蔵のAIが使えるようになりました");
      showAvailability();
    } catch (e) {
      clearInterval(tick);
      dl.disabled = false; dl.textContent = "もう一度";
      p.innerHTML = `<b style="color:var(--accent)">取得できませんでした：${String(e.message || e).slice(0, 200)}</b>`;
    }
  };
}

async function save() {
  const profile = {};
  for (const [id, label] of Object.entries(FIELDS)) {
    const v = $(id).value.trim();
    if (v) profile[label] = v;
  }
  await chrome.storage.local.set({ apiKey: $("apiKey").value.trim(), profile, brain: $("brain").value });
  const n = Object.keys(profile).length;
  flash(`保存しました（情報 ${n} 項目）`);
}

function flash(text) {
  const m = $("msg");
  m.textContent = text;
  setTimeout(() => { m.textContent = ""; }, 2600);
}

$("save").onclick = save;
$("reveal").onchange = e => { $("apiKey").type = e.target.checked ? "text" : "password"; };
$("clear").onclick = async () => {
  if (!confirm("APIキーと保存した情報を、すべて消します。よろしいですか。")) return;
  await chrome.storage.local.clear();
  await load();
  flash("消しました");
};
document.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); } });

load();
