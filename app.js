import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.min.mjs";
const MAX_IMAGE_CHARS = 900000; // 1件のデータ上限(約1MB)に収める

const app$ = document.getElementById("app");
const who$ = document.getElementById("who");

// ---------- 小さな道具 ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function show(...nodes) { app$.replaceChildren(...nodes); }
function fmt(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const w = "日月火水木金土"[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日(${w}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function errorBox(e) { console.error(e); return h("p", { class: "err" }, "うまくいきませんでした。時間をおいてもう一度お試しください。"); }
const safeImg = (s) => typeof s === "string" && s.startsWith("data:image/jpeg;base64,");

// ---------- 起動 ----------
if (firebaseConfig.apiKey === "REPLACE_ME") {
  show(h("div", { class: "card" }, h("p", {}, "まだ設定が終わっていません（Firebaseの接続情報が未設定です）。")));
} else {
  const fb = initializeApp(firebaseConfig);
  var auth = getAuth(fb);
  var db = getFirestore(fb);
  onAuthStateChanged(auth, (user) => route(user).catch((e) => show(errorBox(e))));
}

let me = null; // { uid, email, isAdmin, profile }

async function route(user) {
  if (!user) { who$.textContent = ""; return showLogin(); }
  who$.replaceChildren(h("span", {}, user.email), " ", h("button", { class: "link", onclick: () => signOut(auth) }, "ログアウト"));
  const adminSnap = await getDoc(doc(db, "admins", user.uid));
  const profSnap = await getDoc(doc(db, "users", user.uid));
  me = { uid: user.uid, email: user.email, isAdmin: adminSnap.exists(), profile: profSnap.exists() ? profSnap.data() : null };
  if (me.isAdmin) return showAdmin("requests");
  if (!me.profile) return showApply(user);
  if (me.profile.status === "pending") return showPending();
  if (me.profile.status === "rejected") return showRejected();
  return showList();
}

// ---------- 住民 ----------
function showLogin() {
  show(h("div", { class: "card" },
    h("p", {}, "町内会の回覧をスマホで見られます。Googleのアカウントでログインしてください。"),
    h("button", { class: "primary big", onclick: async (ev) => {
      ev.target.disabled = true;
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (e) { ev.target.disabled = false; app$.append(errorBox(e)); }
    } }, "Googleでログイン")));
}

function showApply(user) {
  const name = h("input", { id: "name", maxlength: "50", autocomplete: "name" });
  const han = h("input", { id: "han", maxlength: "30", placeholder: "例：3班" });
  const msg = h("p", { class: "err" });
  show(h("div", { class: "card" },
    h("p", {}, "はじめての方は参加の申請をしてください。役員が確認して承認すると、回覧が見られるようになります。"),
    h("label", { for: "name" }, "お名前"), name,
    h("label", { for: "han" }, "班（分かれば）"), han, msg,
    h("button", { class: "primary big", id: "apply", onclick: async (ev) => {
      if (!name.value.trim()) { msg.textContent = "お名前を入れてください。"; return; }
      ev.target.disabled = true;
      try {
        await setDoc(doc(db, "users", user.uid), {
          name: name.value.trim(), han: han.value.trim(), email: user.email,
          status: "pending", createdAt: serverTimestamp()
        });
        me.profile = { status: "pending" };
        showPending();
      } catch (e) { ev.target.disabled = false; msg.replaceChildren(errorBox(e)); }
    } }, "申請する")));
}
function showPending() {
  show(h("div", { class: "card" }, h("p", {}, "申請を受け付けました。役員の承認をお待ちください。"),
    h("p", { class: "muted" }, "承認されたら、この画面を開き直すと回覧が見られます。")));
}
function showRejected() {
  show(h("div", { class: "card" }, h("p", {}, "この回覧板は、町内会で承認された方だけが見られます。心当たりがあれば役員にご連絡ください。")));
}

async function myReads() {
  const snap = await getDocs(query(collection(db, "reads"), where("uid", "==", me.uid)));
  const m = new Map();
  snap.forEach((d) => m.set(d.data().noticeId, d.data().readAt));
  return m;
}

async function showList() {
  show(h("p", { class: "muted" }, "読み込み中…"));
  const [snap, reads] = await Promise.all([
    getDocs(query(collection(db, "notices"), where("published", "==", true))), myReads()]);
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  if (!items.length) return show(h("div", { class: "card" }, "まだ回覧はありません。"));
  show(h("p", { class: "muted" }, "回覧の一覧（新しい順）"),
    ...items.map((n) => h("div", { class: "card" },
      h("button", { class: "list-item link-like", style: "border:none;background:none;padding:0", onclick: () => showNotice(n.id) },
        h("span", {}, h("b", {}, n.title), h("br"), h("small", { class: "muted" }, fmt(n.createdAt))),
        reads.has(n.id) ? h("span", { class: "badge done" }, "確認済み") : h("span", { class: "badge new" }, "未確認")))));
}

async function loadPages(id) {
  const snap = await getDocs(query(collection(db, "notices", id, "pages"), orderBy("n")));
  const imgs = [];
  snap.forEach((d) => { const s = d.data().data; if (safeImg(s)) imgs.push(h("img", { src: s, alt: `回覧の資料 ${d.data().n + 1}枚目` })); });
  return imgs;
}

async function showNotice(id) {
  show(h("p", { class: "muted" }, "読み込み中…"));
  const nSnap = await getDoc(doc(db, "notices", id));
  if (!nSnap.exists()) return showList();
  const n = nSnap.data();
  const [imgs, reads] = await Promise.all([loadPages(id), myReads()]);
  const readAt = reads.get(id);
  const status = h("div", { id: "readStatus" });
  const renderStatus = (t) => status.replaceChildren(h("p", { class: "ok" }, `${fmt(t)} に確認済み`));
  if (readAt) renderStatus(readAt);
  else status.replaceChildren(h("button", { class: "primary big", id: "readBtn", onclick: async (ev) => {
    ev.target.disabled = true;
    try {
      await setDoc(doc(db, "reads", `${id}_${me.uid}`), {
        noticeId: id, uid: me.uid, name: me.profile.name, han: me.profile.han ?? "", readAt: serverTimestamp()
      });
      const r = await myReads();
      renderStatus(r.get(id) || new Date());
    } catch (e) { ev.target.disabled = false; status.append(errorBox(e)); }
  } }, "見ました"));
  show(h("button", { class: "link", onclick: showList }, "← 一覧へ戻る"),
    h("div", { class: "card" }, h("h2", {}, n.title), h("p", { class: "muted" }, fmt(n.createdAt)),
      h("div", { class: "body" }, n.body), h("div", { class: "pages" }, imgs)),
    h("div", { class: "card" }, status));
}

// ---------- 役員 ----------
function adminTabs(cur) {
  const t = (key, label) => h("button", { "aria-pressed": String(cur === key), onclick: () => showAdmin(key) }, label);
  return h("div", { class: "tabs" }, t("requests", "参加申請"), t("post", "回覧を投稿"), t("notices", "回覧と確認状況"), t("members", "住民一覧"));
}
async function showAdmin(tab) {
  const body = h("div", {}, h("p", { class: "muted" }, "読み込み中…"));
  show(adminTabs(tab), body);
  try {
    if (tab === "requests") await adminRequests(body);
    if (tab === "post") adminPost(body);
    if (tab === "notices") await adminNotices(body);
    if (tab === "members") await adminMembers(body);
  } catch (e) { body.replaceChildren(errorBox(e)); }
}
async function usersBy(status) {
  const snap = await getDocs(query(collection(db, "users"), where("status", "==", status)));
  const a = []; snap.forEach((d) => a.push({ uid: d.id, ...d.data() }));
  return a.sort((x, y) => (x.han + x.name).localeCompare(y.han + y.name, "ja"));
}
async function setStatus(uid, status) {
  await updateDoc(doc(db, "users", uid), { status, decidedAt: serverTimestamp() });
}
async function adminRequests(body) {
  const list = await usersBy("pending");
  if (!list.length) return body.replaceChildren(h("div", { class: "card" }, "新しい申請はありません。"));
  body.replaceChildren(h("p", { class: "muted" }, "町内会の方か確かめて、承認か却下を選んでください。"),
    ...list.map((u) => h("div", { class: "card" },
      h("b", {}, u.name), " ", h("span", { class: "muted" }, u.han || "班の記入なし"), h("br"),
      h("small", { class: "muted" }, `${u.email}　申請：${fmt(u.createdAt)}`),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: async () => { await setStatus(u.uid, "approved"); showAdmin("requests"); } }, "承認"),
        h("button", { onclick: async () => { await setStatus(u.uid, "rejected"); showAdmin("requests"); } }, "却下")))));
}
async function adminMembers(body) {
  const [ok, ng] = await Promise.all([usersBy("approved"), usersBy("rejected")]);
  const row = (u, label, next) => h("tr", {}, h("td", {}, u.han), h("td", {}, u.name),
    h("td", {}, h("button", { onclick: async () => { await setStatus(u.uid, next); showAdmin("members"); } }, label)));
  body.replaceChildren(
    h("div", { class: "card" }, h("h3", {}, `承認済み（${ok.length}人）`),
      h("table", {}, h("tr", {}, h("th", {}, "班"), h("th", {}, "名前"), h("th", {}, "")), ok.map((u) => row(u, "承認を取り消す", "rejected")))),
    h("div", { class: "card" }, h("h3", {}, `却下・取り消し（${ng.length}人）`),
      h("table", {}, ng.map((u) => row(u, "承認する", "approved")))));
}

// 写真・PDFをスマホで読める大きさのJPEGに縮める
function canvasToJpeg(src, w0, h0) {
  for (const maxW of [1600, 1300, 1000, 800]) {
    const scale = Math.min(1, maxW / w0);
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * scale); c.height = Math.round(h0 * scale);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.65, 0.5]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length < MAX_IMAGE_CHARS) return url;
    }
  }
  throw new Error("too-large");
}
async function fileToJpegs(file) {
  if (file.type === "application/pdf") {
    const pdfjs = await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
      const page = await pdf.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 2000 / vp0.width });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      out.push(canvasToJpeg(c, c.width, c.height));
    }
    return out;
  }
  const bmp = await createImageBitmap(file);
  return [canvasToJpeg(bmp, bmp.width, bmp.height)];
}

function adminPost(body) {
  const title = h("input", { id: "title", maxlength: "100", placeholder: "例：第39回 ふれあいフェスティバル" });
  const text = h("textarea", { id: "text", placeholder: "「仕事の型」で作ったチャット文を貼り付けてください" });
  const file = h("input", { id: "file", type: "file", accept: "image/*,application/pdf", multiple: true });
  const preview = h("div", { class: "pages" });
  const area = h("div");
  let pages = [];
  file.addEventListener("change", async () => {
    pages = []; preview.replaceChildren(h("p", { class: "muted" }, "写真を整えています…"));
    try {
      for (const f of file.files) pages.push(...(await fileToJpegs(f)));
      preview.replaceChildren(...pages.map((s) => h("img", { src: s, alt: "プレビュー" })),
        h("p", { class: "muted" }, `${pages.length}枚。スマホで読める大きさに縮めました。`));
    } catch (e) {
      pages = [];
      preview.replaceChildren(h("p", { class: "err" }, e.message === "too-large"
        ? "写真が大きすぎて保存できません。少し離れて撮り直すか、枚数を分けてください。"
        : "写真を読み込めませんでした。別の写真かPDFでお試しください。"));
    }
  });
  const next = h("button", { class: "primary big", id: "toConfirm", onclick: () => {
    if (!title.value.trim() || !text.value.trim()) { area.replaceChildren(h("p", { class: "err" }, "題名と本文を入れてください。")); return; }
    area.replaceChildren(h("div", { class: "confirm" },
      h("p", {}, h("b", {}, "公開すると、承認された住民全員がこの回覧を見られます。")),
      h("p", { class: "muted" }, "後から「非公開に戻す」ことはできますが、すでに見た人の記憶や控えは消せません。内容に問題がなければ公開をおすすめします。"),
      h("div", { class: "row" },
        h("button", { class: "primary", id: "publish", onclick: async (ev) => {
          ev.target.disabled = true;
          try { await publish(title.value.trim(), text.value.trim(), pages); showAdmin("notices"); }
          catch (e) { ev.target.disabled = false; area.append(errorBox(e)); }
        } }, "公開する"),
        h("button", { onclick: () => area.replaceChildren() }, "やめる"))));
  } }, "確認へ進む");
  body.replaceChildren(h("div", { class: "card" },
    h("label", { for: "title" }, "題名"), title,
    h("label", { for: "text" }, "本文"), text,
    h("label", { for: "file" }, "写真・PDF（任意）"), file, preview, h("div", { style: "height:12px" }), next, area));
}
async function publish(title, body, pages) {
  const ref = doc(collection(db, "notices"));
  // 住民に途中の状態を見せないよう、非公開で作ってから公開に切り替える
  await setDoc(ref, { title, body, pageCount: pages.length, published: false, createdAt: serverTimestamp() });
  for (let i = 0; i < pages.length; i++) await setDoc(doc(db, "notices", ref.id, "pages", String(i)), { n: i, data: pages[i] });
  await updateDoc(ref, { published: true, publishedAt: serverTimestamp() });
  return ref.id;
}

async function adminNotices(body) {
  const [nSnap, members] = await Promise.all([getDocs(collection(db, "notices")), usersBy("approved")]);
  const items = []; nSnap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  items.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  if (!items.length) return body.replaceChildren(h("div", { class: "card" }, "まだ回覧はありません。"));
  body.replaceChildren(...items.map((n) => {
    const detail = h("div");
    return h("div", { class: "card" },
      h("b", {}, n.title), " ", h("span", { class: "badge" }, n.published ? "公開中" : "非公開"), h("br"),
      h("small", { class: "muted" }, fmt(n.createdAt)),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: () => adminReadStatus(n, members, detail) }, "確認状況を見る"),
        h("button", { onclick: async () => { await updateDoc(doc(db, "notices", n.id), { published: !n.published }); showAdmin("notices"); } },
          n.published ? "非公開に戻す" : "もう一度公開する")),
      detail);
  }));
}
async function adminReadStatus(n, members, detail) {
  detail.replaceChildren(h("p", { class: "muted" }, "読み込み中…"));
  const snap = await getDocs(query(collection(db, "reads"), where("noticeId", "==", n.id)));
  const reads = new Map(); snap.forEach((d) => reads.set(d.data().uid, d.data()));
  const done = members.filter((u) => reads.has(u.uid)).sort((a, b) => reads.get(a.uid).readAt.toMillis() - reads.get(b.uid).readAt.toMillis());
  const yet = members.filter((u) => !reads.has(u.uid));
  detail.replaceChildren(
    h("p", {}, h("b", {}, `確認済み ${done.length}人 ／ まだ ${yet.length}人`)),
    h("table", {}, h("tr", {}, h("th", {}, "班"), h("th", {}, "名前"), h("th", {}, "見た日時")),
      done.map((u) => h("tr", {}, h("td", {}, u.han), h("td", {}, u.name), h("td", {}, fmt(reads.get(u.uid).readAt)))),
      yet.map((u) => h("tr", {}, h("td", {}, u.han), h("td", {}, u.name), h("td", { class: "muted" }, "まだ")))));
}
