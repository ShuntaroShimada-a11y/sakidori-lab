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
async function showAvailability() {
  const el = $("avail");
  if (typeof LanguageModel === "undefined") {
    el.innerHTML = "<b>このブラウザには内蔵のAIがありません。</b>Claude（APIキー）をお使いください。（内蔵AIは Chrome 138 以降）";
    return;
  }
  let av = "unavailable";
  try { av = await LanguageModel.availability(); } catch { /* そのまま */ }
  el.innerHTML = {
    available: "<b style=\"color:var(--ok)\">内蔵のAIが使えます。</b>APIキーは不要です。",
    downloadable: "<b>内蔵のAIが使えます。</b>初めて使うときだけ、モデルの取得に数分かかります（数GB）。",
    downloading: "<b>内蔵のAIを取得中です。</b>終わるまでお待ちください。",
    unavailable: "<b>この端末では内蔵のAIを動かせません。</b>空き容量22GB・メモリ16GB以上が要ります。配信されていない場合もあります。Claude（APIキー）をお使いください。"
  }[av] || `状態：${av}`;
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
