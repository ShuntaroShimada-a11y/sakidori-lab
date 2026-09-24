// ページの中で動く部分。ここが本体。
//   1. いま開いているフォームを読んで「文字の地図」にする
//   2. Claude の指示どおりに入力・選択する
//   3. 操作した場所に枠を出し、右下に実況を流す
//   4. 終わったら「何をどう入れたか」の確認画面を出す（送信は人が押す）
(() => {
  "use strict";
  if (window.__sakidoriFormAgent) { window.__sakidoriFormAgent.open(); return; }

  // ---------------------------------------------------------------- 定数
  const MAX_TURNS = 24;          // 往復の上限（暴走止め）
  const PAUSE = 450;             // 1手ごとの間。速すぎると何も見えない
  const MAX_TEXT = 6000;         // get_page_text の上限
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------- 画面（Shadow DOM）
  const host = document.createElement("div");
  host.setAttribute("data-sk-ui", "");
  host.setAttribute("data-sk-panel", "");   // 枠と区別するための、パネル専用の目印
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px";
  const sr = host.attachShadow({ mode: "open" });
  sr.innerHTML = `<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif}
  .p{width:320px;max-width:calc(100vw - 32px);background:#111C26;color:#E4EBF2;border:1px solid #2B3B4B;
     border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;font-size:13px;line-height:1.7}
  .h{display:flex;align-items:center;gap:8px;padding:11px 13px;background:#18242F;border-bottom:1px solid #2B3B4B}
  .h b{font-size:12.5px;letter-spacing:.02em}
  .h .x{margin-left:auto;cursor:pointer;color:#8FA2B4;font-size:16px;line-height:1;padding:2px 4px}
  .h .x:hover{color:#E4EBF2}
  .b{padding:13px;max-height:60vh;overflow-y:auto}
  textarea{width:100%;min-height:62px;background:#1B2734;border:1px solid #2B3B4B;border-radius:7px;
    color:#E4EBF2;padding:9px 10px;font-size:13px;line-height:1.6;resize:vertical}
  textarea:focus{outline:2px solid #4F8CF5;outline-offset:-1px}
  .row{display:flex;gap:8px;margin-top:10px}
  button{flex:1;font:inherit;font-weight:700;font-size:13px;padding:9px 12px;border-radius:7px;border:1px solid #2B3B4B;
    background:#243342;color:#E4EBF2;cursor:pointer}
  button.pri{background:#C85E18;border-color:#C85E18;color:#fff}
  button:hover{filter:brightness(1.12)} button:disabled{opacity:.45;cursor:default;filter:none}
  .note{color:#8FA2B4;font-size:11.5px;margin-top:9px;line-height:1.65}
  ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  li{display:flex;gap:8px;align-items:flex-start}
  .pip{width:7px;height:7px;border-radius:50%;flex:none;margin-top:6px;background:#3E5570}
  li.r .pip{background:#4F8CF5} li.a .pip{background:#F2934A} li.a span{color:#F3D7BC}
  li.w .pip{background:#E05A4E} li.w span{color:#F0BDB7}
  li.d .pip{background:#5FC98A} li.d span{color:#BCEBCF}
  li span{color:#AFC0D0;font-size:12.5px}
  .res{border-top:1px solid #2B3B4B;margin-top:12px;padding-top:12px}
  .res h4{margin:0 0 9px;font-size:11px;letter-spacing:.12em;color:#8FA2B4;font-weight:700}
  .f{background:#18242F;border:1px solid #2B3B4B;border-radius:7px;padding:9px 10px;cursor:pointer;margin-bottom:7px}
  .f:hover{border-color:#4F8CF5}
  .f.warn{border-color:#C9A227;background:#231E10}
  .f .lb{font-size:11px;color:#8FA2B4;display:flex;gap:5px;align-items:center}
  .f .vl{font-weight:700;color:#E4EBF2;font-size:13px;word-break:break-all;margin:2px 0 3px}
  .f .rs{font-size:11px;color:#8FA2B4;line-height:1.6}
  .f.warn .lb{color:#E8C55A}
  .err{background:#331715;border:1px solid #7A2D26;border-radius:7px;padding:10px;color:#F0BDB7;font-size:12.5px}
  a{color:#79ACFF;cursor:pointer;text-decoration:underline}
  </style>
  <div class="p">
    <div class="h"><b>sakidori フォーム記入</b><span class="x" id="x">&times;</span></div>
    <div class="b" id="b"></div>
  </div>`;
  document.documentElement.appendChild(host);
  const $b = sr.getElementById("b");
  sr.getElementById("x").onclick = () => { host.remove(); clearMarks(); window.__sakidoriFormAgent = null; };

  // ---------------------------------------------------------------- 枠（ハイライト）
  const marks = [];
  function clearMarks() { while (marks.length) marks.pop().remove(); }
  function mark(el, kind, label) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    const d = document.createElement("div");
    d.setAttribute("data-sk-ui", "");
    const color = kind === "bad" ? "#C4332B" : kind === "read" ? "#2F6FE4" : "#E27A2A";
    d.style.cssText = `all:initial;position:absolute;z-index:2147483646;pointer-events:none;border-radius:5px;
      left:${r.left + scrollX - 3}px;top:${r.top + scrollY - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;
      border:2px solid ${color};box-shadow:0 0 0 4px ${color}28;transition:opacity .3s`;
    if (label) {
      const t = document.createElement("div");
      t.style.cssText = `all:initial;position:absolute;left:0;top:-23px;background:${color};color:#fff;
        font:700 11px/1.6 "Hiragino Sans",system-ui,sans-serif;padding:1px 7px;border-radius:4px;white-space:nowrap`;
      t.textContent = label;
      d.appendChild(t);
    }
    document.body.appendChild(d);
    marks.push(d);
    return d;
  }
  function fade(ms) { const c = marks.slice(); setTimeout(() => c.forEach(d => { d.style.opacity = "0"; setTimeout(() => d.remove(), 320); }), ms); marks.length = 0; }

  // ---------------------------------------------------------------- 文字の地図
  let refs = new Map(), refN = 0;
  let lastTree = "";          // 直近に返したツリー（find はこれを検索する）

  const ours = el => !!(el.closest && el.closest("[data-sk-ui]"));

  function visible(el) {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;      // 親が display:none なら矩形が 0 になる
  }

  const clean = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 60);
  // 「必須」「任意」などの印はラベルから外す（required は別に出しているため）
  const stripMark = s => clean(String(s || "").replace(/[\s]*(必\s*須|任\s*意|required|optional|ひっす)[\s]*/gi, " ").replace(/^[\s*※†]+|[\s*※†]+$/g, ""));
  // 区切り記号だけ、または短すぎるものはラベルとして使わない（「－」「/」など）
  const usable = s => { const t = stripMark(s); return t.length >= 2 && /[\p{L}\p{N}]/u.test(t) ? t : ""; };

  // 要素のテキスト（入力欄の中身は含めない）
  function textOf(el) {
    if (!el || ours(el)) return "";
    if (/^(INPUT|SELECT|TEXTAREA|SCRIPT|STYLE)$/.test(el.tagName)) return "";
    return clean(el.textContent);
  }

  // 実在サイトは label[for] を書いていないことが多いので、何段構えかで探す
  function labelFor(el) {
    const aria = usable(el.getAttribute("aria-label"));
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = usable(by.split(/\s+/).map(id => textOf(document.getElementById(id))).filter(Boolean).join(" "));
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) { const t = usable(textOf(l)); if (t) return t; }
    }
    const wrap = el.closest("label");
    if (wrap) { const t = usable(textOf(wrap)); if (t) return t; }
    // 直前にあるテキスト（実在サイトではこれが一番効く）。
    // 区切り記号（電話番号のあいだの「－」など）は飛ばして、さらに上へ探しに行く。
    let node = el, hops = 0;
    while (node && hops < 4) {
      let sib = node.previousElementSibling;
      while (sib) { const t = usable(textOf(sib)); if (t) return t; sib = sib.previousElementSibling; }
      node = node.parentElement; hops++;
      if (!node || /^(FORM|BODY|MAIN|HTML)$/.test(node.tagName)) break;
    }
    return usable(el.placeholder) || usable(el.title) || usable(el.name) || clean(el.name || "");
  }

  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r && /^(button|link|checkbox|radio|combobox|textbox|heading)$/.test(r)) return r;
    const tag = el.tagName;
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "BUTTON") return "button";
    if (tag === "A" && el.href) return "link";
    if (/^H[1-6]$/.test(tag) || tag === "LEGEND") return "heading";
    if (tag === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      if (t === "hidden" || t === "file") return "";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (/^(submit|button|reset|image)$/.test(t)) return "button";
      return "textbox";
    }
    return "";
  }

  function isRequired(el) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    const box = el.closest("div,li,tr,p,fieldset,section");
    return !!(box && /必\s*須|required|\*/.test(box.textContent || "") && (box.textContent || "").length < 400);
  }

  // 送信後に出るエラー文を拾う（多くのサイトは欄の近くに赤い文字で出す）
  function errorNear(el) {
    const box = el.closest("div,li,tr,p,fieldset,section,label");
    if (!box) return "";
    for (const n of box.querySelectorAll('[class*="err"],[class*="Err"],[class*="invalid"],[role="alert"],[aria-live]')) {
      if (ours(n)) continue;
      const t = clean(n.textContent);
      if (t && t.length < 120) return t;
    }
    if (el.getAttribute("aria-invalid") === "true") return "入力内容を確認してください";
    return "";
  }

  function valueOf(el) {
    const role = roleOf(el);
    if (role === "combobox") return clean(el.selectedOptions?.[0]?.text || "");
    if (role === "checkbox" || role === "radio") return el.checked ? "checked" : "";
    if (el.value != null) return clean(el.value);
    return "";
  }

  function line(el, indent) {
    const role = roleOf(el);
    if (!role) return null;
    if (role === "heading") {
      const t = textOf(el);
      return t ? `${"  ".repeat(indent)}heading "${t}"` : null;
    }
    if (!visible(el)) return null;
    const ref = `ref_${++refN}`;
    refs.set(ref, el);
    const bits = [`${"  ".repeat(indent)}${role} "${labelFor(el) || "(名前なし)"}" [${ref}]`];
    if (isRequired(el)) bits.push("required");
    const v = valueOf(el);
    if (v) bits.push(`value="${v}"`);
    if (el.placeholder) bits.push(`hint="${clean(el.placeholder)}"`);
    if (el.disabled) bits.push("disabled");
    if (role === "combobox") {
      const opts = [...el.options].slice(0, 25).map(o => clean(o.text)).filter(Boolean);
      if (opts.length) bits.push(`options="${opts.join("／")}"`);
    }
    if ((role === "radio" || role === "checkbox") && el.name) bits.push(`group="${clean(el.name)}"`);
    if (el.maxLength > 0 && el.maxLength < 5000) bits.push(`maxlength=${el.maxLength}`);
    const err = errorNear(el);
    if (err) bits.push(`error="${err}"`);     // 送信して怒られた内容。これを読んで直してもらう
    return bits.join(" ");
  }

  function buildTree(root, onlyInteractive) {
    refs = new Map(); refN = 0;
    const out = [];
    const walk = (node, indent) => {
      for (const el of node.children) {
        if (ours(el) || /^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME)$/.test(el.tagName)) continue;
        const l = line(el, indent);
        if (l) {
          if (onlyInteractive && l.trimStart().startsWith("heading")) { /* 飛ばす */ }
          else out.push(l);
        }
        const deeper = /^(FORM|FIELDSET)$/.test(el.tagName) ? indent + 1 : indent;
        walk(el, Math.min(deeper, 4));
      }
    };
    walk(root, 0);
    if (!out.length) return "（このページに、操作できる入力欄は見つかりませんでした）";
    return out.slice(0, 400).join("\n");
  }

  // ---------------------------------------------------------------- 値を入れる
  // React などが使っている内部の setter を経由しないと、入力が無視されるサイトがある
  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fill(el, value) {
    const role = roleOf(el);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (role === "checkbox" || role === "radio") {
      const want = value === false || value === "false" || value === "" ? false : true;
      if (el.checked !== want) el.click();
      return el.checked ? "checked" : "unchecked";
    }
    if (role === "combobox") {
      const want = String(value).trim();
      const opts = [...el.options];
      const hit = opts.find(o => clean(o.text) === want) || opts.find(o => o.value === want)
        || opts.find(o => clean(o.text).includes(want)) || opts.find(o => want.includes(clean(o.text)) && clean(o.text));
      if (!hit) return null;
      el.focus();
      setNative(el, hit.value);
      return clean(hit.text);
    }
    el.focus();
    setNative(el, String(value));
    return String(value);
  }

  // 送信になるものは構造的に押させない
  function isSubmit(el) {
    const t = (el.type || "").toLowerCase();
    if (el.tagName === "INPUT" && /^(submit|image)$/.test(t)) return true;
    if (el.tagName === "BUTTON" && (t === "submit" || t === "")) return true;
    // 文言での判定は「押すと送信されうるもの」だけに限る。
    // チェックボックスやラジオに掛けると「…に同意する」などを誤って弾いてしまう
    if (!/^(BUTTON|A)$/.test(el.tagName) && !(el.tagName === "INPUT" && /^(button|reset)$/.test(t))) return false;
    const label = (labelFor(el) + " " + textOf(el)).slice(0, 40);
    return /送信|確認画面|申し?込|登録する|申請する|次へ|進む|submit/.test(label);
  }

  // まだ埋まっていない必須の欄（直近の buildTree の結果に対して調べる）
  function emptyRequired() {
    return [...refs.values()].filter(el => {
      const r = roleOf(el);
      if (!/^(textbox|combobox)$/.test(r) || el.disabled || !isRequired(el)) return false;
      const v = valueOf(el);
      return !v || (r === "combobox" && /^(選択|選んで|指定|--|―)/.test(v));
    });
  }

  // ---------------------------------------------------------------- 記録
  const filled = [];   // 確認画面に出す記録
  let lastReason = "";

  function record(el, value) {
    const label = labelFor(el) || "(名前なし)";
    const i = filled.findIndex(f => f.el === el);
    const row = { el, label, value: String(value), reason: lastReason, role: roleOf(el) };
    if (i >= 0) filled[i] = row; else filled.push(row);
  }

  // ---------------------------------------------------------------- 頭脳（2つ）
  // Chrome 138 以降の LanguageModel（Gemini Nano）。鍵も通信も要らず、端末の中だけで動く。
  // 道具を呼ばせる仕組みは無いので、「欄の一覧」を渡して「埋める値の一覧」を JSON で返させる。
  const FILL_SCHEMA = {
    type: "object",
    properties: {
      fills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "[ref_N] の N を含む文字列。例 ref_3" },
            value: { type: "string", description: "入れる値。checkbox と radio は checked" },
            reason: { type: "string", description: "なぜその値にしたかを15〜30字の日本語で" }
          },
          required: ["ref", "value"]
        }
      }
    },
    required: ["fills"]
  };

  const LOCAL_RULES = `あなたはWebフォームの記入を手伝います。欄の一覧と利用者の情報から、埋めるべき欄と値だけを返します。

守ること
- 利用者の情報に無いことは書かない。確信が持てない欄は返さない
- すでに値が入っている欄（value=... があるもの）は返さない
- button は絶対に返さない（送信は人が行う）
- 「全角カナ」「フリガナ」とある欄は、カタカナに直して入れる
- 電話番号や郵便番号が複数の欄に分かれているときは、自分で分割して入れる
- hint="…" は入力例。その形式に合わせる
- checkbox と radio は value を checked にする
- 金額・日付・同意のチェックは、指示に明記が無いかぎり返さない`;

  // 入出力の言語は必ず伝える。伝えないと警告が出て、日本語の品質も保証されない
  const LANGS = { expectedInputs: [{ type: "text", languages: ["ja", "en"] }], expectedOutputs: [{ type: "text", languages: ["ja"] }] };

  async function localAvailable() {
    try {
      if (typeof LanguageModel === "undefined") return "なし";
      return await LanguageModel.availability(LANGS);   // unavailable / downloadable / downloading / available
    } catch { return "なし"; }
  }

  let localSession = null;
  async function localAsk(tree, profile, note) {
    if (!localSession) {
      localSession = await LanguageModel.create({
        ...LANGS,
        initialPrompts: [{ role: "system", content: LOCAL_RULES }],
        monitor(m) {
          m.addEventListener("downloadprogress", e => {
            const pct = Math.round((e.loaded || 0) * 100);
            log("r", `AIモデルを取得しています… ${pct}%（初回だけ）`);
          });
        }
      });
    }
    const p = Object.entries(profile || {}).filter(([, v]) => String(v || "").trim())
      .map(([k, v]) => `${k}：${v}`).join("\n") || "（情報が登録されていません）";
    const text = `【利用者の情報】\n${p}\n\n【今回の指示】\n${note || "（とくになし）"}\n\n【フォームの欄】\n${tree}`;
    const raw = await localSession.prompt(text, { responseConstraint: FILL_SCHEMA });
    try { return JSON.parse(raw); } catch { return { fills: [] }; }
  }

  // 進め方（頭脳A・Bで共通）：
  //   読む → まとめて聞く → まとめて埋める → 読み直す、を最大3周。
  //   読み直すので「選んだら欄が増える」にも、「送信して怒られた」にも同じ仕組みで追いつける。
  async function runFill(ask, label, note, profile, stopped) {
    let total = 0, asked = [], calls = 0;

    for (let round = 1; round <= 3; round++) {
      if (stopped()) break;
      clearMarks();
      const tree = buildTree(document.body, true);
      const errs = /error="/.test(tree);
      const rest = emptyRequired();

      // 2周目以降は、はっきりした理由があるときだけ聞き直す。
      // 理由が無ければ1回の呼び出しで終わり。
      if (round > 1 && !errs && !rest.length) break;

      [...refs.values()].slice(0, 60).forEach(el => mark(el, "read"));
      fade(700);
      log("r", round === 1 ? `フォームを読みました（${refs.size}項目）。${label}に聞きます`
        : errs ? "エラーが出ています。内容を読んで直します"
        : `必須が${rest.length}件残っています。読み直します`);
      await sleep(PAUSE);

      calls++;
      const plan = await ask(tree, profile, note);
      const fills = (plan?.fills || []).filter(f => refs.has(String(f.ref)) && roleOf(refs.get(String(f.ref))) !== "button");
      asked = plan?.ask || asked;
      if (!fills.length) { if (round === 1) log("w", "埋められる欄が見つかりませんでした。"); break; }

      for (const f of fills) {
        if (stopped()) break;
        const el = refs.get(String(f.ref));
        if (!el || !el.isConnected || el.disabled) continue;
        // すでに同じ値が入っている欄は触らない（2周目で全部入れ直すのを防ぐ）
        const now = valueOf(el), want = String(f.value ?? "");
        const same = /^(checkbox|radio)$/.test(roleOf(el))
          ? (el.checked === !(want === "" || want === "false"))
          : (now && now === want);
        if (same) continue;
        lastReason = String(f.reason || "").trim();
        if (lastReason) log("a", lastReason);
        clearMarks(); mark(el, "act", lastReason.slice(0, 22));
        await sleep(160);
        const got = fill(el, f.value);
        fade(900);
        if (got !== null) { record(el, got); total++; }
        await sleep(PAUSE);
      }
      await sleep(600);            // 欄が増える・エラーが消えるのを待つ
    }

    if (asked.length) log("w", `人にしか埋められない欄：${asked.join("／")}`);
    log("d", `${filled.length}項目を埋めました（AIへの問い合わせ ${calls} 回）。ご確認のうえ送信してください。`);
  }

  // ---------------------------------------------------------------- 実況
  const logEl = () => sr.getElementById("log");
  function log(kind, text) {
    // 確認画面に切り替わると要素が消えるので、DOM の属性にも残しておく。
    // 拡張機能は隔離された領域で動くため、変数ではなく属性でないと外から読めない。
    try {
      const a = JSON.parse(host.dataset.log || "[]");
      a.push(text);
      host.dataset.log = JSON.stringify(a.slice(-80));
    } catch { host.dataset.log = JSON.stringify([text]); }
    const ul = logEl(); if (!ul) return;
    const li = document.createElement("li");
    li.className = kind;
    li.innerHTML = `<span class="pip"></span><span></span>`;
    li.lastElementChild.textContent = text;
    ul.appendChild(li);
    ul.parentElement.scrollTop = 1e6;
  }

  // ---------------------------------------------------------------- 本体のループ
  async function start(note) {
    lastReason = ""; host.dataset.log = "[]";
    $b.innerHTML = `<ul id="log"></ul><div class="row"><button id="stop">中止する</button></div>`;
    let stopped = false;
    sr.getElementById("stop").onclick = () => { stopped = true; log("w", "中止しました。"); };

    const { profile = {}, brain = "auto", apiKey = "" } = await chrome.storage.local.get(["profile", "brain", "apiKey"]);
    const av = await localAvailable();
    const canLocal = av === "available" || av === "downloadable" || av === "downloading";
    const use = brain === "local" ? "local" : brain === "claude" ? "claude" : (canLocal ? "local" : "claude");

    // Claude 側も同じ形で答えてもらう（背景の service worker が API を呼ぶ）
    const askClaude = async (tree, prof, nt) => {
      let res;
      try { res = await chrome.runtime.sendMessage({ type: "plan", tree, profile: prof, note: nt }); }
      catch { throw new Error("拡張機能との通信が切れました。ページを読み込み直してください。"); }
      if (!res || res.error) throw new Error(res?.error || "応答がありませんでした。");
      return res.plan;
    };

    try {
      if (use === "local") {
        if (!canLocal) throw new Error(`このブラウザではAIを端末内で動かせません（状態：${av}）。`);
        await runFill(localAsk, "ブラウザ内蔵のAI", note, profile, () => stopped);
      } else {
        if (!apiKey) { fail("APIキーが未設定です。設定画面で入れてください。"); return; }
        await runFill(askClaude, "Claude", note, profile, () => stopped);
      }
    } catch (e) {
      // 内蔵AIがだめなら Claude に落とす
      if (use === "local" && apiKey) {
        log("w", String(e.message || e));
        try { await runFill(askClaude, "Claude", note, profile, () => stopped); }
        catch (e2) { fail(String(e2.message || e2)); return; }
      } else {
        fail(String(e.message || e) + (use === "local" ? "\n設定でAPIキーを入れると Claude で動きます。" : ""));
        return;
      }
    }
    done();
  }

  function fail(text) {
    $b.innerHTML = `<div class="err"></div><div class="row"><button id="again">もどる</button><button class="pri" id="opt">設定を開く</button></div>`;
    sr.querySelector(".err").textContent = text;
    sr.getElementById("again").onclick = open;
    sr.getElementById("opt").onclick = () => chrome.runtime.sendMessage({ type: "openOptions" });
  }

  // ---------------------------------------------------------------- 確認画面
  async function done() {
    clearMarks();
    const { profile = {} } = await chrome.storage.local.get("profile");
    const known = Object.values(profile).map(v => String(v || "").trim()).filter(Boolean);
    // 保存した情報そのものでない値（＝推測した値）と、同意のチェックには印をつける
    const isGuess = f => f.role === "checkbox" || !known.some(k => k && (f.value.includes(k) || k.includes(f.value)));

    if (!filled.length) {
      $b.innerHTML = `<div class="note">埋められた欄はありませんでした。設定に情報が入っているか、指示が具体的かを確かめてください。</div>
        <div class="row"><button id="again">もう一度</button><button class="pri" id="opt">設定を開く</button></div>`;
      sr.getElementById("again").onclick = open;
      sr.getElementById("opt").onclick = () => chrome.runtime.sendMessage({ type: "openOptions" });
      return;
    }

    // まだ埋まっていない必須の欄（人が何をすべきか分かるように）
    buildTree(document.body, true);
    const rest = emptyRequired();

    const warnN = filled.filter(isGuess).length;
    $b.innerHTML = `<div class="res" style="border:0;margin:0;padding:0">
      <h4>入力した内容（${filled.length}項目）</h4>
      <div id="list"></div>
      ${rest.length ? `<div class="err" style="margin-bottom:10px"><b>まだ空の必須項目が ${rest.length} 件あります</b><br>${rest.map(el => esc0(labelFor(el))).join("／")}<br>この欄を埋めないと送信できません。</div>` : ""}
      <div class="note">${warnN ? `<b style="color:#E8C55A">⚠ が付いた ${warnN} 項目は、保存した情報そのものではありません。</b>とくに確認してください。<br>` : ""}
      行を押すと、その欄まで移動して光ります。直したい場合はページ上で直接どうぞ。<br>
      <b>送信はこの拡張機能では行いません。</b>内容を確認して、ご自身で送信ボタンを押してください。</div>
      <div class="row"><button id="again">もう一度</button><button class="pri" id="close">閉じる</button></div></div>`;

    const list = sr.getElementById("list");
    for (const f of filled) {
      const g = isGuess(f);
      const d = document.createElement("div");
      d.className = "f" + (g ? " warn" : "");
      d.innerHTML = `<div class="lb"></div><div class="vl"></div><div class="rs"></div>`;
      d.children[0].textContent = (g ? "⚠ " : "") + f.label;
      d.children[1].textContent = f.value || "（空）";
      d.children[2].textContent = f.reason ? "↳ " + f.reason : "";
      d.onclick = () => {
        clearMarks();
        f.el.scrollIntoView({ block: "center", behavior: "smooth" });
        mark(f.el, g ? "bad" : "act", f.label);
        fade(2200);
      };
      list.appendChild(d);
    }
    sr.getElementById("again").onclick = open;
    sr.getElementById("close").onclick = () => { host.remove(); clearMarks(); window.__sakidoriFormAgent = null; };
  }

  // ---------------------------------------------------------------- 最初の画面
  async function open() {
    const st = await chrome.storage.local.get(["apiKey", "profile", "brain"]);
    const av = await localAvailable();
    const canLocal = av === "available" || av === "downloadable" || av === "downloading";
    const brain = st.brain || "auto";
    const use = brain === "local" ? "local" : brain === "claude" ? "claude" : (canLocal ? "local" : "claude");
    if (use === "claude" && !(st.apiKey || "").trim()) {
      $b.innerHTML = `<div class="note">このブラウザでは<b>端末内のAIが使えません</b>（状態：${av}）。<br>
        設定画面で <b>APIキー</b>と<b>よく使う自分の情報</b>を登録すると、Claude で動きます。どちらもこの端末の中だけに保存されます。</div>
        <div class="row"><button class="pri" id="opt">設定を開く</button></div>`;
      sr.getElementById("opt").onclick = () => chrome.runtime.sendMessage({ type: "openOptions" });
      return;
    }
    const n = Object.values(st.profile || {}).filter(v => String(v || "").trim()).length;
    const label = use === "local" ? "ブラウザ内蔵のAI（無料）" : "Claude";
    $b.innerHTML = `<textarea id="note" placeholder="例：資料請求です。導入は来期から検討。&#10;（空でも、保存した情報だけで埋めます）"></textarea>
      <div class="row"><button id="opt">設定</button><button class="pri" id="go">下書きする</button></div>
      <div class="note">${label}が、保存済みの情報 ${n} 項目を使って埋めます。<b>送信はしません</b>——埋めたあと、内容を確認してご自身で送信してください。</div>`;
    const ta = sr.getElementById("note");
    ta.focus();
    sr.getElementById("opt").onclick = () => chrome.runtime.sendMessage({ type: "openOptions" });
    sr.getElementById("go").onclick = () => start(ta.value.trim());
    ta.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") start(ta.value.trim()); };
  }

  window.__sakidoriFormAgent = { open };
  open();
})();
