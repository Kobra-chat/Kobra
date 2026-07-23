import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase, ref, get, update, runTransaction, onValue, off,
  query, orderByKey, orderByChild, startAt, endAt, limitToFirst,
  onChildAdded, push, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const EMAIL_SUFFIX = "@kobra-chat.local";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ---------- DOM ----------
const loadingScreen = document.getElementById('loadingScreen');
const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');

const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');

const myAvatar = document.getElementById('myAvatar');
const myUsernameEl = document.getElementById('myUsername');
const logoutBtn = document.getElementById('logoutBtn');

const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

const convList = document.getElementById('convList');
const convEmptyHint = document.getElementById('convEmptyHint');

const emptyState = document.getElementById('emptyState');
const chatView = document.getElementById('chatView');
const chatAvatar = document.getElementById('chatAvatar');
const chatUsername = document.getElementById('chatUsername');
const logEl = document.getElementById('log');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

// ---------- STATE ----------
let mode = 'login'; // vagy 'register'
let me = { uid: null, username: null };
let activeChat = null; // { chatId, otherUid, otherUsername }
let messagesRef = null;
let messagesUnsub = null;
let convListenerAttached = false;

// ---------- SEGÉD ----------
function showError(msg){
  authError.textContent = msg;
  authError.style.display = 'block';
}
function clearError(){
  authError.style.display = 'none';
}
function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function initials(name){
  return (name || '?').slice(0, 2).toUpperCase();
}
function colorFor(name){
  let hash = 0;
  for(let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
function formatTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if(sameDay) return d.toLocaleTimeString('hu-HU', {hour:'2-digit', minute:'2-digit'});
  return d.toLocaleDateString('hu-HU', {month:'short', day:'numeric'});
}

// ---------- AUTH TAB VÁLTÁS ----------
tabLogin.addEventListener('click', () => {
  mode = 'login';
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  authSubmit.textContent = 'Bejelentkezés';
  clearError();
});
tabRegister.addEventListener('click', () => {
  mode = 'register';
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  authSubmit.textContent = 'Regisztráció';
  clearError();
});

authSubmit.addEventListener('click', async () => {
  clearError();
  const username = authUsername.value.trim();
  const password = authPassword.value;

  if(!username || username.length < 3){ showError('A felhasználónév legalább 3 karakter legyen.'); return; }
  if(!/^[a-zA-Z0-9_.-]+$/.test(username)){ showError('Csak betű, szám, "_", "-", "." engedélyezett a névben.'); return; }
  if(!password || password.length < 6){ showError('A jelszó legalább 6 karakter legyen.'); return; }

  authSubmit.disabled = true;
  const email = username + EMAIL_SUFFIX;

  try{
    if(mode === 'register'){
      const usernameRef = ref(db, 'usersByName/' + username);
      const reserve = await runTransaction(usernameRef, current => {
        if(current !== null) return; // már foglalt -> megszakítjuk
        return 'pending';
      });
      if(!reserve.committed){
        showError('Ez a felhasználónév már foglalt.');
        authSubmit.disabled = false;
        return;
      }
      try{
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await update(ref(db), {
          ['usersByName/' + username]: cred.user.uid,
          ['users/' + cred.user.uid]: { username, createdAt: serverTimestamp() }
        });
      } catch(e){
        await runTransaction(usernameRef, () => null); // foglalás visszavonása
        throw e;
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch(e){
    showError(translateAuthError(e));
  } finally {
    authSubmit.disabled = false;
  }
});

function translateAuthError(e){
  const code = e.code || '';
  if(code.includes('wrong-password') || code.includes('invalid-credential')) return 'Hibás felhasználónév vagy jelszó.';
  if(code.includes('user-not-found')) return 'Nincs ilyen felhasználó.';
  if(code.includes('email-already-in-use')) return 'Ez a felhasználónév már foglalt.';
  if(code.includes('weak-password')) return 'A jelszó túl gyenge, legalább 6 karakter kell.';
  if(code.includes('network-request-failed')) return 'Nincs internetkapcsolat.';
  return 'Hiba történt: ' + (e.message || code);
}

logoutBtn.addEventListener('click', () => signOut(auth));

// ---------- AUTH ÁLLAPOT FIGYELÉSE (ez menti el a bejelentkezést) ----------
onAuthStateChanged(auth, async (user) => {
  loadingScreen.classList.add('hidden');
  if(user){
    const snap = await get(ref(db, 'users/' + user.uid));
    const data = snap.val() || {};
    me = { uid: user.uid, username: data.username || user.email.split('@')[0] };

    myUsernameEl.textContent = me.username;
    myAvatar.textContent = initials(me.username);
    myAvatar.style.background = colorFor(me.username);

    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');

    attachConvListener();
  } else {
    me = { uid: null, username: null };
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    resetChatView();
  }
});

// ---------- FELHASZNÁLÓ-KERESÉS ----------
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const term = searchInput.value.trim();
  if(!term){
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
    return;
  }
  searchTimer = setTimeout(() => runSearch(term), 200);
});

async function runSearch(term){
  const usersRef = ref(db, 'usersByName');
  const q = query(usersRef, orderByKey(), startAt(term), endAt(term + '\uf8ff'), limitToFirst(8));
  const snap = await get(q);
  const results = [];
  snap.forEach(child => {
    if(child.key !== me.username) results.push({ username: child.key, uid: child.val() });
  });

  if(results.length === 0){
    searchResults.innerHTML = '<div class="search-empty">Nincs ilyen felhasználó.</div>';
  } else {
    searchResults.innerHTML = '';
    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'search-item';
      item.innerHTML =
        '<div class="avatar small" style="background:' + colorFor(r.username) + '">' + initials(r.username) + '</div>' +
        '<span>' + escapeHtml(r.username) + '</span>';
      item.addEventListener('click', () => {
        searchInput.value = '';
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
        openChatWith(r.uid, r.username);
      });
      searchResults.appendChild(item);
    });
  }
  searchResults.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  if(!searchResults.contains(e.target) && e.target !== searchInput){
    searchResults.classList.add('hidden');
  }
});

// ---------- BESZÉLGETÉS MEGNYITÁSA / LÉTREHOZÁSA ----------
function chatIdFor(uidA, uidB){
  return [uidA, uidB].sort().join('_');
}

async function openChatWith(otherUid, otherUsername){
  const chatId = chatIdFor(me.uid, otherUid);
  const myEntryRef = ref(db, 'userChats/' + me.uid + '/' + chatId);
  const snap = await get(myEntryRef);

  if(!snap.exists()){
    const now = serverTimestamp();
    await update(ref(db), {
      ['userChats/' + me.uid + '/' + chatId]: { otherUid, otherUsername, lastMessage: '', lastTs: now },
      ['userChats/' + otherUid + '/' + chatId]: { otherUid: me.uid, otherUsername: me.username, lastMessage: '', lastTs: now }
    });
  }
  selectChat(chatId, otherUid, otherUsername);
}

// ---------- BESZÉLGETÉS-LISTA (KEZDŐOLDAL) ----------
function attachConvListener(){
  if(convListenerAttached) return;
  convListenerAttached = true;
  const convRef = ref(db, 'userChats/' + me.uid);
  onValue(convRef, snap => {
    const data = snap.val() || {};
    const items = Object.entries(data).map(([chatId, v]) => ({ chatId, ...v }));
    items.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

    convEmptyHint.style.display = items.length === 0 ? 'block' : 'none';
    convList.querySelectorAll('.conv-item').forEach(el => el.remove());

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'conv-item' + (activeChat && activeChat.chatId === item.chatId ? ' active' : '');
      el.innerHTML =
        '<div class="avatar" style="background:' + colorFor(item.otherUsername) + '">' + initials(item.otherUsername) + '</div>' +
        '<div class="conv-text">' +
          '<div class="conv-name">' + escapeHtml(item.otherUsername) + '</div>' +
          '<div class="conv-last">' + escapeHtml(item.lastMessage || 'Nincs még üzenet') + '</div>' +
        '</div>' +
        '<div class="conv-time">' + formatTime(item.lastTs) + '</div>';
      el.addEventListener('click', () => selectChat(item.chatId, item.otherUid, item.otherUsername));
      convList.appendChild(el);
    });
  });
}

// ---------- AKTÍV BESZÉLGETÉS MEGJELENÍTÉSE ----------
function resetChatView(){
  activeChat = null;
  if(messagesUnsub){ messagesUnsub(); messagesUnsub = null; }
  emptyState.classList.remove('hidden');
  chatView.classList.add('hidden');
  logEl.innerHTML = '';
}

function selectChat(chatId, otherUid, otherUsername){
  activeChat = { chatId, otherUid, otherUsername };

  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));

  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  chatAvatar.textContent = initials(otherUsername);
  chatAvatar.style.background = colorFor(otherUsername);
  chatUsername.textContent = otherUsername;
  logEl.innerHTML = '';

  if(messagesUnsub){ messagesUnsub(); messagesUnsub = null; }

  messagesRef = ref(db, 'chats/' + chatId + '/messages');
  messagesUnsub = onChildAdded(messagesRef, snap => appendMessage(snap.val()));

  msgInput.focus();
}

function appendMessage(m){
  const div = document.createElement('div');
  div.className = 'entry ' + (m.senderUid === me.uid ? 'mine' : '');
  div.innerHTML =
    '<div class="bubble">' + escapeHtml(m.text) + '</div>' +
    '<div class="ts">' + formatTime(m.ts) + '</div>';
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------- ÜZENETKÜLDÉS ----------
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if(e.key === 'Enter') sendMessage(); });

async function sendMessage(){
  const text = msgInput.value.trim();
  if(!text || !activeChat) return;
  msgInput.value = '';

  const { chatId, otherUid } = activeChat;
  await push(ref(db, 'chats/' + chatId + '/messages'), {
    senderUid: me.uid,
    senderName: me.username,
    text,
    ts: serverTimestamp()
  });

  const now = serverTimestamp();
  await update(ref(db), {
    ['userChats/' + me.uid + '/' + chatId + '/lastMessage']: text,
    ['userChats/' + me.uid + '/' + chatId + '/lastTs']: now,
    ['userChats/' + otherUid + '/' + chatId + '/lastMessage']: text,
    ['userChats/' + otherUid + '/' + chatId + '/lastTs']: now
  });
}
