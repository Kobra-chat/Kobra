import { initializeApp } from "https://gstatic.com";
import { getDatabase, ref, set, get, child, push, onChildAdded, onValue, serverTimestamp } from "https://gstatic.com";
import { initializeAuth, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://gstatic.com";

// A te pontos, ellenőrzött konfigurációd
const firebaseConfig = {
  apiKey: "AIzaSyAYtpBEZNb4cEsbpsuWz2zpszkxCTDCN2g",
  authDomain: "://firebaseapp.com",
  databaseURL: "https://firebasedatabase.app",
  projectId: "kobra-d3464",
  storageBucket: "kobra-d3464.firebasestorage.app",
  messagingSenderId: "127800460763",
  appId: "1:127800460763:web:5e690d2638a4b7aaf093fe"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Kezelőfelület elemei
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
const myUsernameLabel = document.getElementById('myUsername');
const logoutBtn = document.getElementById('logoutBtn');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const convList = document.getElementById('convList');
const convEmptyHint = document.getElementById('convEmptyHint');
const emptyState = document.getElementById('emptyState');
const chatView = document.getElementById('chatView');
const chatAvatar = document.getElementById('chatAvatar');
const chatUsernameLabel = document.getElementById('chatUsername');
const logEl = document.getElementById('log');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

let isLoginMode = true;
let currentMyName = "";
let currentActiveChatId = null;
let currentChatUnsubscribe = null;

// Tab váltás logika
tabLogin.addEventListener('click', () => {
  isLoginMode = true; tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  authSubmit.textContent = "Bejelentkezés"; authError.style.display = 'none';
});
tabRegister.addEventListener('click', () => {
  isLoginMode = false; tabLogin.classList.remove('active'); tabRegister.classList.add('active');
  authSubmit.textContent = "Regisztráció"; authError.style.display = 'none';
});

// Felhasználó állapot figyelése
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userSnap = await get(ref(db, `users/${user.uid}`));
    if (userSnap.exists()) {
      currentMyName = userSnap.val().username;
      myUsernameLabel.textContent = currentMyName;
      myAvatar.textContent = currentMyName.charAt(0).toUpperCase();
      
      loadingScreen.classList.add('hidden');
      authScreen.classList.add('hidden');
      appScreen.classList.remove('hidden');
      
      loadConversations(user.uid);
    }
  } else {
    loadingScreen.classList.add('hidden');
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
  }
});

// Küldés gomb / Regisztráció és Belépés indítása
authSubmit.addEventListener('click', async () => {
  authError.style.display = 'none';
  const username = authUsername.value.trim();
  const password = authPassword.value.trim();

  if (!username || !password) { authError.textContent = "Töltsd ki az összes mezőt!"; authError.style.display = 'block'; return; }
  if (password.length < 6) { authError.textContent = "A jelszónak legalább 6 karakternek kell lennie!"; authError.style.display = 'block'; return; }

  const fakeEmail = username.toLowerCase() + "@kobra-chat.local";

  if (!isLoginMode) {
    // REGISZTRÁCIÓ (Claude javított sorrendje szerint)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, fakeEmail, password);
      const uid = userCredential.user.uid;
      
      // Most már be vagyunk jelentkezve (auth != null), így a szabály engedi az írást
      await set(ref(db, `users/${uid}`), { username: username, email: fakeEmail });
      await set(ref(db, `usersByName/${username.toLowerCase()}`), { uid: uid });
    } catch (error) {
      authError.textContent = "Regisztrációs hiba: " + error.message;
      authError.style.display = 'block';
    }
  } else {
    // BEJELENTKEZÉS
    try {
      await signInWithEmailAndPassword(auth, fakeEmail, password);
    } catch (error) {
      authError.textContent = "Hibás felhasználónév vagy jelszó!";
      authError.style.display = 'block';
    }
  }
});

// Keresés logika
searchInput.addEventListener('input', async () => {
  const queryText = searchInput.value.trim().toLowerCase();
  if (!queryText) { searchResults.classList.add('hidden'); return; }
  
  const snap = await get(ref(db, 'usersByName'));
  searchResults.innerHTML = '';
  let found = false;

  if (snap.exists()) {
    const allUsers = snap.val();
    Object.keys(allUsers).forEach(name => {
      if (name.includes(queryText) && name !== currentMyName.toLowerCase()) {
        found = true;
        const div = document.createElement('div');
        div.className = 'search-item';
        div.textContent = name.toUpperCase();
        div.addEventListener('click', () => startChat(allUsers[name].uid, name));
        searchResults.appendChild(div);
      }
    });
  }
  
  if (found) searchResults.classList.remove('hidden');
  else searchResults.classList.add('hidden');
});

// Új beszélgetés indítása
async function startChat(targetUid, targetName) {
  searchResults.classList.add('hidden');
  searchInput.value = '';
  const myUid = auth.currentUser.uid;
  const chatId = myUid < targetUid ? `${myUid}_${targetUid}` : `${targetUid}_${myUid}`;

  await set(ref(db, `userChats/${myUid}/${chatId}`), { otherUid: targetUid, otherName: targetName.toUpperCase() });
  await set(ref(db, `userChats/${targetUid}/${chatId}`), { otherUid: myUid, otherName: currentMyName.toUpperCase() });

  openChat(chatId, targetName.toUpperCase());
}

// Beszélgetések listájának betöltése
function loadConversations(uid) {
  onValue(ref(db, `userChats/${uid}`), (snap) => {
    convList.innerHTML = '';
    const chats = snap.val();
    if (!chats) { convEmptyHint.classList.remove('hidden'); return; }
    
    convEmptyHint.classList.add('hidden');
    Object.keys(chats).forEach(chatId => {
      const item = document.createElement('div');
      item.className = 'conv-item';
      if (chatId === currentActiveChatId) item.classList.add('active');
      item.innerHTML = `<div class="avatar">${chats[chatId].otherName.charAt(0)}</div><span>${chats[chatId].otherName}</span>`;
      item.addEventListener('click', () => openChat(chatId, chats[chatId].otherName));
      convList.appendChild(item);
    });
  });
}

// Egy adott chat megnyitása
function openChat(chatId, otherName) {
  currentActiveChatId = chatId;
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  chatUsernameLabel.textContent = otherName;
  chatAvatar.textContent = otherName.charAt(0);
  logEl.innerHTML = '';

  if (currentChatUnsubscribe) currentChatUnsubscribe();

  const messagesRef = query(ref(db, `chats/${chatId}`));
  currentChatUnsubscribe = onChildAdded(messagesRef, (snap) => {
    const m = snap.val();
    const div = document.createElement('div');
    div.className = 'entry ' + (m.uid === auth.currentUser.uid ? 'mine' : '');
    const time = m.ts ? new Date(m.ts).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '';
    
    div.innerHTML = `<div class="who">${m.name}</div><div class="bubble">${m.text}</div><div class="ts">${time}</div>`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  });

  // Frissítjük a listában az aktív osztályt
  Array.from(convList.children).forEach(child => {
    child.classList.remove('active');
  });
}

// Üzenetküldés
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !currentActiveChatId) return;
  msgInput.value = '';

  push(ref(db, `chats/${currentActiveChatId}`), {
    uid: auth.currentUser.uid,
    name: currentMyName,
    text: text,
    ts: serverTimestamp()
  });
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
logoutBtn.addEventListener('click', () => { signOut(auth); });
