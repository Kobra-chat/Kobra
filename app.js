import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  update,
  runTransaction,
  onValue,
  query,
  orderByKey,
  startAt,
  endAt,
  limitToFirst,
  onChildAdded,
  push,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
const EMAIL_SUFFIX = "@kobra-chat.local";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
// ---------- DOM ----------
const loadingScreen = document.getElementById("loadingScreen");
const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");
const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const authSubmit = document.getElementById("authSubmit");
const authError = document.getElementById("authError");
const myAvatar = document.getElementById("myAvatar");
const myUsernameEl = document.getElementById("myUsername");
const logoutBtn = document.getElementById("logoutBtn");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const convList = document.getElementById("convList");
const convEmptyHint = document.getElementById("convEmptyHint");
const emptyState = document.getElementById("emptyState");
const chatView = document.getElementById("chatView");
const chatAvatar = document.getElementById("chatAvatar");
const chatUsername = document.getElementById("chatUsername");
const logEl = document.getElementById("log");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
// ---------- STATE ----------
let mode = "login";
let me = { uid: null, username: null };
let activeChat = null;
let messagesUnsub = null;
let convUnsub = null;
let loadedMessageKeys = new Set();
let sending = false;
// ---------- SEGÉD ----------
function showError(msg) {
  authError.textContent = msg;
  authError.style.display = "block";
}
function clearError() {
  authError.style.display = "none";
}
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function initials(name) {
  return (name || "?").slice(0, 2).toUpperCase();
}
function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 58%, 52%)`;
}
function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts === "object" && typeof ts.seconds === "number") {
    return ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6;
  }
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}
function formatTime(ts) {
  const ms = toMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
}
function normalizeUsername(raw) {
  return raw.trim().toLowerCase();
}
function setAvatar(el, username) {
  el.textContent = initials(username);
  el.style.background = colorFor(username);
}
// ---------- AUTH TAB VÁLTÁS ----------
tabLogin.addEventListener("click", () => {
  mode = "login";
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  authSubmit.textContent = "Bejelentkezés";
  clearError();
});
tabRegister.addEventListener("click", () => {
  mode = "register";
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  authSubmit.textContent = "Regisztráció";
  clearError();
});
authSubmit.addEventListener("click", handleAuth);
authPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuth();
});
async function handleAuth() {
  clearError();
  const username = normalizeUsername(authUsername.value);
  const password = authPassword.value;
  if (!username || username.length < 3) {
    showError("A felhasználónév legalább 3 karakter legyen.");
    return;
  }
  if (!/^[a-z0-9_.-]+$/.test(username)) {
    showError('Csak kisbetű, szám, "_", "-", "." engedélyezett.');
    return;
  }
  if (!password || password.length < 6) {
    showError("A jelszó legalább 6 karakter legyen.");
    return;
  }
  authSubmit.disabled = true;
  const email = username + EMAIL_SUFFIX;
  try {
    if (mode === "register") {
      const usernameRef = ref(db, "usersByName/" + username);
      const reserve = await runTransaction(usernameRef, (current) => {
        if (current !== null) return;
        return "pending";
      });
      if (!reserve.committed) {
        showError("Ez a felhasználónév már foglalt.");
        return;
      }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await update(ref(db), {
          ["usersByName/" + username]: cred.user.uid,
          ["users/" + cred.user.uid]: { username, createdAt: serverTimestamp() }
        });
      } catch (e) {
        await runTransaction(usernameRef, () => null);
        throw e;
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (e) {
    showError(translateAuthError(e));
  } finally {
    authSubmit.disabled = false;
  }
}
function translateAuthError(e) {
  const code = e.code || "";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) {
    return "Hibás felhasználónév vagy jelszó.";}
  if (code.includes("user-not-found")) return "Nincs ilyen felhasználó.";
  if (code.includes("email-already-in-use")) return "Ez a felhasználónév már foglalt.";
  if (code.includes("weak-password")) return "A jelszó túl gyenge, legalább 6 karakter kell.";
  if (code.includes("network-request-failed")) return "Nincs internetkapcsolat.";
  if (code.includes("permission-denied")) {
    return "Nincs jogosultság. Ellenőrizd a Firebase Database szabályokat.";
  }
  return "Hiba történt: " + (e.message || code);
}
logoutBtn.addEventListener("click", () => signOut(auth));
// ---------- AUTH ÁLLAPOT ----------
onAuthStateChanged(auth, async (user) => {
  loadingScreen.classList.add("hidden");
  if (user) {
    try {
      const snap = await get(ref(db, "users/" + user.uid));
      const data = snap.val() || {};
      me = {
        uid: user.uid,
        username: data.username || user.email.split("@")[0]
      };
      myUsernameEl.textContent = me.username;
      setAvatar(myAvatar, me.username);
      authScreen.classList.add("hidden");
      appScreen.classList.remove("hidden");
      attachConvListener();
    } catch (e) {
      showError("Nem sikerült betölteni a profilt.");
      authScreen.classList.remove("hidden");
      appScreen.classList.add("hidden");
    }
  } else {
    me = { uid: null, username: null };
    detachConvListener();
    resetChatView();
    appScreen.classList.add("hidden");
    authScreen.classList.remove("hidden");
  }
});
// ---------- KERESÉS ----------
let searchTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const term = normalizeUsername(searchInput.value);
  if (!term) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }
  searchTimer = setTimeout(() => runSearch(term), 250);
});
async function runSearch(term) {
  try {
    const usersRef = ref(db, "usersByName");
    const q = query(
      usersRef,
      orderByKey(),
      startAt(term),
      endAt(term + "\uf8ff"),
      limitToFirst(8)
    );
    const snap = await get(q);
    const results = [];
    snap.forEach((child) => {
      const uid = child.val();
      if (child.key !== me.username && uid && uid !== "pending") {
        results.push({ username: child.key, uid });
      }
    });
    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">Nincs ilyen felhasználó.</div>';
    } else {
      searchResults.innerHTML = "";
      results.forEach((r) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "search-item";
        item.innerHTML =
          '<div class="avatar small" style="background:' +
          colorFor(r.username) +
          '">' +
          initials(r.username) +
          "</div>" +
          "<span>@" +
          escapeHtml(r.username) +
          "</span>";
        item.addEventListener("click", () => {
          searchInput.value = "";
          searchResults.classList.add("hidden");
          searchResults.innerHTML = "";
          openChatWith(r.uid, r.username);
        });
        searchResults.appendChild(item);
      });
    }
    searchResults.classList.remove("hidden");
  } catch (e) {
    searchResults.innerHTML = '<div class="search-empty">Keresési hiba. Ellenőrizd a Firebase szabályokat.</div>';
    searchResults.classList.remove("hidden");
  }
}
document.addEventListener("click", (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.add("hidden");
  }
});
// ---------- BESZÉLGETÉS ----------
function chatIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}
async function openChatWith(otherUid, otherUsername) {
  if (otherUid === me.uid) return;
  const chatId = chatIdFor(me.uid, otherUid);
  const myEntryRef = ref(db, "userChats/" + me.uid + "/" + chatId);
  const snap = await get(myEntryRef);
  if (!snap.exists()) {
    const now = serverTimestamp();
    await update(ref(db), {
      ["userChats/" + me.uid + "/" + chatId]: {
        otherUid,
        otherUsername,
        lastMessage: "",
        lastTs: now
      },
      ["userChats/" + otherUid + "/" + chatId]: {
        otherUid: me.uid,
        otherUsername: me.username,
        lastMessage: "",
        lastTs: now
      }
    });
  }
  selectChat(chatId, otherUid, otherUsername);
}
function attachConvListener() {
  detachConvListener();
  const convRef = ref(db, "userChats/" + me.uid);
  convUnsub = onValue(convRef, (snap) => {
    const data = snap.val() || {};
    const items = Object.entries(data).map(([chatId, v]) => ({ chatId, ...v }));
    items.sort((a, b) => toMillis(b.lastTs) - toMillis(a.lastTs));
    convEmptyHint.style.display = items.length === 0 ? "block" : "none";
    convList.querySelectorAll(".conv-item").forEach((el) => el.remove());
    items.forEach((item) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className =
        "conv-item" + (activeChat && activeChat.chatId === item.chatId ? " active" : "");
      el.innerHTML =
        '<div class="avatar" style="background:' +
        colorFor(item.otherUsername) +
        '">' +
        initials(item.otherUsername) +
        "</div>" +
        '<div class="conv-text">' +
        '<div class="conv-name">' +
        escapeHtml(item.otherUsername) +
        "</div>" +
        '<div class="conv-last">' +
        escapeHtml(item.lastMessage || "Nincs még üzenet") +
        "</div>" +
        "</div>" +
        '<div class="conv-time">' +
        formatTime(item.lastTs) +
        "</div>";
      el.addEventListener("click", () =>
        selectChat(item.chatId, item.otherUid, item.otherUsername)
      );
      convList.appendChild(el);
    });
  });
}
function detachConvListener() {
  if (convUnsub) {
    convUnsub();
    convUnsub = null;
  }
}
function resetChatView() {
  activeChat = null;
  detachMessagesListener();
  emptyState.classList.remove("hidden");
  chatView.classList.add("hidden");
  logEl.innerHTML = "";
  loadedMessageKeys.clear();
}
function detachMessagesListener() {
  if (messagesUnsub) {
    messagesUnsub();
    messagesUnsub = null;
  }
}
async function selectChat(chatId, otherUid, otherUsername) {
  activeChat = { chatId, otherUid, otherUsername };
  document.querySelectorAll(".conv-item").forEach((el) => {
    el.classList.toggle("active", el.querySelector(".conv-name")?.textContent === otherUsername);
  });emptyState.classList.add("hidden");
  chatView.classList.remove("hidden");
  setAvatar(chatAvatar, otherUsername);
  chatUsername.textContent = otherUsername;
  logEl.innerHTML = "";
  loadedMessageKeys.clear();
  detachMessagesListener();
  const messagesRef = ref(db, "chats/" + chatId + "/messages");
  try {
    const snap = await get(messagesRef);
    const messages = [];
    snap.forEach((child) => {
      messages.push({ key: child.key, ...child.val() });
    });
    messages.sort((a, b) => toMillis(a.ts) - toMillis(b.ts));
    messages.forEach((m) => {
      loadedMessageKeys.add(m.key);
      appendMessage(m);
    });
  } catch (e) {
    logEl.innerHTML = '<div class="log-error">Nem sikerült betölteni az üzeneteket.</div>';
  }
  messagesUnsub = onChildAdded(messagesRef, (snap) => {
    if (loadedMessageKeys.has(snap.key)) return;
    loadedMessageKeys.add(snap.key);
    appendMessage({ key: snap.key, ...snap.val() });
  });
  msgInput.focus();
}
function appendMessage(m) {
  const div = document.createElement("div");
  div.className = "entry " + (m.senderUid === me.uid ? "mine" : "");
  div.innerHTML =
    '<div class="bubble">' +
    escapeHtml(m.text) +
    "</div>" +
    '<div class="ts">' +
    formatTime(m.ts) +
    "</div>";
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}
// ---------- ÜZENETKÜLDÉS ----------
sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !activeChat || sending) return;
  sending = true;
  sendBtn.disabled = true;
  msgInput.value = "";
  const { chatId, otherUid } = activeChat;
  try {
    await push(ref(db, "chats/" + chatId + "/messages"), {
      senderUid: me.uid,
      senderName: me.username,
      text,
      ts: serverTimestamp()
    });
    const now = serverTimestamp();
    await update(ref(db), {
      ["userChats/" + me.uid + "/" + chatId + "/lastMessage"]: text,
      ["userChats/" + me.uid + "/" + chatId + "/lastTs"]: now,
      ["userChats/" + otherUid + "/" + chatId + "/lastMessage"]: text,
      ["userChats/" + otherUid + "/" + chatId + "/lastTs"]: now
    });
  } catch (e) {
    msgInput.value = text;
  } finally {
    sending = false;
    sendBtn.disabled = false;
    msgInput.focus();
  }
}
