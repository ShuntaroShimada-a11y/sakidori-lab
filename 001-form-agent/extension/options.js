// 設定の保存と読み込み。保存先は chrome.storage.local（この端末の中だけ）。
const FIELDS = {
  name: "氏名（漢字）", kana: "氏名（カナ）", romaji: "氏名（ローマ字）", birth: "生年月日",
  email: "メールアドレス", tel: "電話番号", zip: "郵便番号", pref: "都道府県",
  city: "市区町村", addr: "番地・建物", company: "勤務先", dept: "部署・役職", misc: "その他"
};
const $ = id => document.getElementById(id);

// storage には「日本語のラベル → 値」で入れる。そのまま Claude に渡すため
async function load() {
  const { apiKey = "", profile = {} } = await chrome.storage.local.get(["apiKey", "profile"]);
  $("apiKey").value = apiKey;
  for (const [id, label] of Object.entries(FIELDS)) $(id).value = profile[label] || "";
}

async function save() {
  const profile = {};
  for (const [id, label] of Object.entries(FIELDS)) {
    const v = $(id).value.trim();
    if (v) profile[label] = v;
  }
  await chrome.storage.local.set({ apiKey: $("apiKey").value.trim(), profile });
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
