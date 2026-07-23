import { initializeApp } from "https://gstatic.com";
import { getDatabase, ref, runTransaction, onValue, query, limitToLast, onChildAdded, push, serverTimestamp } from "https://gstatic.com";
import { firebaseConfig } from "./firebase-config.js";

// Firebase inicializálása v10 szerint
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let state = { room: '', name: '', messagesRef: null };

const setupScreen = document.getElementById('setupScreen');
const chatScreen = document.getElementById('chatScreen');
const setupError = document.getElementById('setupError');
const freqLabel = document.getElementById('freqLabel');
const logEl = document.getElementById('log');
const participantsLabel = document.getElementById('participantsLabel');
const joinBtn = document.getElementById('joinBtn');

function showError(msg){
  setupError.textContent = msg;
  setupError.style.display = 'block';
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function appendMessage(m){
  const div = document.createElement('div');
  div.className = 'entry ' + (m.name === state.name ? 'mine' : '');
  const time = m.ts ? new Date(m.ts).toLocaleTimeString('hu-HU', {hour:'2-digit', minute:'2-digit'}) : '';
  div.innerHTML =
    '<div class="who">' + escapeHtml(m.name) + '</div>' +
    '<div class="bubble">' + escapeHtml(m.text) + '</div>' +
    '<div class="ts">' + time + '</div>';
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

joinBtn.addEventListener('click', async () => {
  setupError.style.display = 'none';
  const room = document.getElementById('room').value.trim();
  const name = document.getElementById('name').value.trim();

  if(!room){ showError('Add meg a szoba nevét.'); return; }
  if(!name){ showError('Add meg a neved.'); return; }

  joinBtn.disabled = true;
  joinBtn.textContent = 'Kapcsolódás...';

  // Referencia létrehozása v10 szerint
  const participantsRef = ref(db, 'rooms/' + room + '/participants');

  try{
    // Tranzakció futtatása v10 szerint a biztonságos szobafoglaláshoz
    const result = await runTransaction(participantsRef, (current) => {
      const participants = current || {};
      if(participants[name]) return participants;
      const names = Object.keys(participants);
      if(names.length >= 2) return; // abort -> megtelt
      participants[name] = true;
      return participants;
    });

    if(!result.committed){
      showError('Ez a szoba már tele van (2 ember beszélget itt).');
      joinBtn.disabled = false;
      joinBtn.textContent = 'Csatlakozás a vonalhoz';
      return;
    }

    state.room = room;
    state.name = name;

    setupScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    freqLabel.textContent = 'szoba: ' + room;

    // Értékfigyelés v10 szerint
    onValue(participantsRef, snap => {
      const participants = snap.val() || {};
      participantsLabel.textContent = Object.keys(participants).join(' • ') || 'kapcsolódva';
    });

    // Üzenetek lekérése v10 lekérdezéssel (query)
    const messagesRef = ref(db, 'rooms/' + room + '/messages');
    const messagesQuery = query(messagesRef, limitToLast(200));
    
    onChildAdded(messagesQuery, snap => {
      appendMessage(snap.val());
    });

    state.messagesRef = messagesRef;

  } catch(e){
    showError('Nem sikerült csatlakozni: ' + e.message);
    joinBtn.disabled = false;
    joinBtn.textContent = 'Csatlakozás a vonalhoz';
  }
});

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') sendMessage();
});

function sendMessage(){
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if(!text || !state.messagesRef) return;
  input.value = '';
  
  // Üzenet beküldése v10 szerint szerver oldali időbélyeggel
  push(state.messagesRef, {
    name: state.name,
    text: text,
    ts: serverTimestamp()
  });
}
