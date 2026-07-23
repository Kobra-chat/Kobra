const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let state = { room: '', name: '', roomRef: null };

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

  const participantsRef = db.ref('rooms/' + room + '/participants');

  try{
    const result = await participantsRef.transaction(current => {
      const participants = current || {};
      if(participants[name]) return participants;
      const names = Object.keys(participants);
      if(names.length >= 2) return; // abort transaction -> room full
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

    participantsRef.on('value', snap => {
      const participants = snap.val() || {};
      participantsLabel.textContent = Object.keys(participants).join(' • ') || 'kapcsolódva';
    });

    const messagesRef = db.ref('rooms/' + room + '/messages');
    messagesRef.limitToLast(200).on('child_added', snap => {
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
  state.messagesRef.push({
    name: state.name,
    text: text,
    ts: firebase.database.ServerValue.TIMESTAMP
  });
}
