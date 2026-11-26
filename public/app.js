const socket = io();

const COLORS = [
  { hex: '#ef4444' }, { hex: '#3b82f6' }, { hex: '#16a34a' },
  { hex: '#ca8a04' }, { hex: '#9333ea' }
];

const $ = (id) => document.getElementById(id);
let state = null;
let previousRevealed = new Set();
const enteredKeys = new Set();
let lastRoomCode = null;
let lastPhase = null;
let lastPickCount = null;
let lastClueText = null;
let lastLogText = null;

// Elementlar faqat ekran/phase almashganda kirib keladi, har yangilanishda emas.
function enterClass(scope) {
  const phase = state?.phase === 'finished' ? 'play' : state?.phase;
  const key = `${phase}:${scope}`;
  const fresh = !enteredKeys.has(key);
  enteredKeys.add(key);
  return fresh ? ' enter' : '';
}

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const color = (index) => COLORS[index] || COLORS[0];
const teamById = (id) => state?.teams.find((team) => team.id === id) || null;

function call(event, data = {}) {
  return new Promise((resolve) => {
    socket.emit(event, data, (response) => resolve(response || { ok: false, error: 'Javob yo‘q.' }));
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = $('themeBtn');
  button.textContent = theme === 'dark' ? '☀️' : '🌙';
  button.classList.toggle('on', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14181e' : '#f5f4ef');
}
applyTheme(localStorage.getItem('sozlar.theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

function celebrate() {
  const shades = ['#4f46e5', '#0f766e', '#c08a18', '#9333ea', '#15803d'];
  for (let index = 0; index < 16; index += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.style.left = `${14 + Math.random() * 72}%`;
    piece.style.background = shades[index % shades.length];
    piece.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 170)}px`);
    piece.style.animationDelay = `${Math.random() * 0.16}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1500);
  }
}

function toast(text, kind = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = text;
  $('toastWrap').appendChild(item);
  setTimeout(() => item.remove(), 3200);
  if (kind === 'success' && /[✅🏆]/.test(text)) celebrate();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  $(`${name}Screen`).classList.add('active');
}

function setBusy(button, busy) { if (button) button.disabled = busy; }

async function createRoom() {
  const button = $('createBtn');
  setBusy(button, true);
  const result = await call('createRoom', { name: $('newName').value, teamCount: $('teamCount').value });
  setBusy(button, false);
  if (!result.ok) return toast(result.error, 'error');
  sessionStorage.setItem('sozlar.playerId', result.playerId);
  sessionStorage.setItem('sozlar.roomCode', result.code);
  sessionStorage.setItem('sozlar.name', $('newName').value.trim());
}

async function joinRoom() {
  const button = $('joinBtn');
  setBusy(button, true);
  const result = await call('joinRoom', { code: $('joinCode').value, name: $('joinName').value });
  setBusy(button, false);
  if (!result.ok) return toast(result.error, 'error');
  sessionStorage.setItem('sozlar.playerId', result.playerId);
  sessionStorage.setItem('sozlar.roomCode', result.code);
  sessionStorage.setItem('sozlar.name', $('joinName').value.trim());
}

function renderLobby() {
  const total = state.teams.reduce((sum, team) => sum + team.count, 0);
  $('playerCount').textContent = `${total} · ${state.teams.length} guruh`;
  const enter = enterClass('teamList');
  $('teamList').innerHTML = state.teams.map((team, index) => {
    const tone = color(team.colorIndex);
    const players = team.playerIds.map((playerId) => {
      const info = state.playerNames?.[playerId] || { name: '—', online: true };
      const isMe = playerId === state.playerId;
      return `<div class="player-row">
        <span class="player-name">${esc(info.name)}${isMe ? ' <span class="chip">siz</span>' : ''}</span>
        ${!info.online ? '<span class="chip">·</span>' : ''}
        ${state.isHost ? `<select data-action="set-team" data-player-id="${esc(playerId)}">
          ${state.teams.map((option) => `<option value="${esc(option.id)}" ${option.id === team.id ? 'selected' : ''}>${esc(option.name)}</option>`).join('')}
        </select>` : ''}
      </div>`;
    }).join('');
    return `<div class="team-card${enter}" style="--team:${tone.hex};--i:${index}">
      <h4>${esc(team.name)} <span class="count">${team.count}</span></h4>${players}
    </div>`;
  }).join('');

  $('hostControls').classList.toggle('hidden', !state.isHost);
  $('addTeamBtn').disabled = state.teams.length >= (state.maxTeams || 5);
  $('removeTeamBtn').disabled = state.teams.length <= 2;
  $('startBtn').disabled = !state.teams.every((team) => team.count >= 2 && team.leaderId);
}

function renderChat(source = state) {
  const lists = document.querySelectorAll('[data-chat-list]');
  if (!lists.length) return;
  const messages = Array.isArray(source?.chat) ? source.chat : [];
  const html = messages.map((message) => {
    const mine = message.playerId === state?.playerId;
    return `<div class="chat-item${mine ? ' mine' : ''}">
      <span class="chat-name">${esc(message.name)}</span>${esc(message.text)}
    </div>`;
  }).join('');
  lists.forEach((list) => {
    const atBottom = !list.children.length || list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    if (list.innerHTML !== html) list.innerHTML = html;
    if (atBottom) list.scrollTop = list.scrollHeight;
  });
}

function renderSelection() {
  const waiting = !state.isLeader;
  $('pickBoard').classList.toggle('hidden', waiting);
  $('pickWaiting').classList.toggle('hidden', !waiting);
  $('pickChat').classList.toggle('hidden', !waiting);
  document.querySelector('.selection-card')?.classList.toggle('with-chat', waiting);
  if (waiting) return;

  const { picked, target, ready } = state.selection;
  const enter = enterClass('pickBoard');
  if (enter) lastPickCount = null;
  const counter = $('pickCounter');
  counter.textContent = `${picked}/${target}`;
  if (lastPickCount !== null && picked !== lastPickCount) {
    counter.classList.remove('bump');
    void counter.offsetWidth;
    counter.classList.add('bump');
  }
  lastPickCount = picked;
  $('pickBoard').innerHTML = state.board.map((word, index) => {
    const mine = Boolean(word.mine);
    const taken = Boolean(word.taken);
    const disabled = ready || taken || (!mine && picked >= target);
    const classes = ['word', enter ? 'enter' : '', mine ? 'picked' : '', taken ? 'taken' : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" style="--i:${index}" data-action="${mine ? 'unpick-word' : 'pick-word'}"
      data-id="${word.id}" ${disabled ? 'disabled' : ''}><span class="word-text">${esc(word.text)}</span></button>`;
  }).join('');
}

function renderGame() {
  const turnTeam = teamById(state.turnTeamId);
  const tone = turnTeam ? color(turnTeam.colorIndex) : color(0);
  $('turnBadge').style.setProperty('--turn', tone.hex);
  $('turnBadge').innerHTML = `<span style="color:${tone.hex}">${esc(turnTeam?.name || '')}</span>`;

  if (state.clue) {
    const clueEnter = state.clue.text !== lastClueText ? ' enter' : '';
    lastClueText = state.clue.text;
    $('clueBox').innerHTML = `<span class="clue-word${clueEnter}" style="--i:0">${esc(state.clue.text)}</span>`;
    $('guessLeft').innerHTML = `<strong>${state.clue.guessesLeft}</strong>/${state.maxGuesses}`;
  } else if (state.canClue) {
    lastClueText = null;
    $('clueBox').innerHTML = `<div class="clue-form">
      <input id="clueInput" maxlength="24" placeholder="ishora" autocomplete="off" />
      <button class="btn primary small" data-action="send-clue">›</button>
    </div>`;
    $('guessLeft').innerHTML = `<strong>${state.cluesLeft ?? state.maxClues ?? 3}</strong>/${state.maxClues ?? 3}`;
  } else {
    lastClueText = null;
    if (state.isLeader && state.isTurn && state.cluesLeft === 0) {
      $('clueBox').textContent = 'Ishoralar tugadi';
      $('guessLeft').innerHTML = `<strong>0</strong>/${state.maxClues ?? 3}`;
    } else {
      $('clueBox').textContent = '…';
      $('guessLeft').textContent = '';
    }
  }

  const boardEnter = enterClass('gameBoard');
  const fresh = new Set();
  $('board').innerHTML = state.board.map((word, index) => {
    const owner = teamById(word.owner);
    const mine = Boolean(word.mine);
    const isFresh = word.revealed && !previousRevealed.has(word.id);
    if (word.revealed) fresh.add(word.id);
    const toneForWord = owner ? color(owner.colorIndex) : null;
    const classes = ['word', boardEnter ? 'enter' : '', mine ? 'mine' : '', word.revealed ? 'revealed' : '', isFresh ? 'just-revealed' : ''].filter(Boolean).join(' ');
    const styles = [`--i:${index}`];
    if (toneForWord) styles.push(`--team:${toneForWord.hex}`);
    return `<button class="${classes}" style="${styles.join(';')}" data-action="guess" data-id="${word.id}"
      ${word.revealed || !state.canGuess ? 'disabled' : ''}><span class="word-text">${esc(word.text)}</span></button>`;
  }).join('');
  previousRevealed = fresh;

  const scoreEnter = enterClass('scoreList');
  $('scoreList').innerHTML = state.teams.map((team, index) => {
    const teamTone = color(team.colorIndex);
    const done = team.total - team.remaining;
    const percent = Math.round((done / Math.max(team.total, 1)) * 100);
    const streak = team.streak >= 2 ? `<span class="streak">🔥${team.streak}</span>` : '';
    const players = team.playerIds.map((playerId) => {
      const info = state.playerNames?.[playerId] || { name: '—' };
      const mark = team.leaderId === playerId || info.isLeader
        ? '♛'
        : '<span class="person-mark" aria-hidden="true"></span>';
      return `<span class="score-player"><span class="member-mark">${mark}</span> ${esc(info.name)}</span>`;
    }).join('');
    return `<div class="score-row${scoreEnter}" style="--team:${teamTone.hex};--i:${index}">
      <div class="score-top"><strong>${esc(team.name)}</strong>${streak}<span>${done}/${team.total} · ishora ${team.cluesUsed ?? 0}/${state.maxClues ?? 3}</span></div>
      <div class="bar"><i style="width:${percent}%"></i></div>
      <div class="score-players">${players}</div>
    </div>`;
  }).join('');

  const latestLog = state.log[state.log.length - 1]?.text || '';
  const logEnter = latestLog !== lastLogText;
  lastLogText = latestLog;
  $('logList').innerHTML = state.log.length
    ? [...state.log].reverse().map((entry, index) => `<div class="log-item ${esc(entry.kind)}${index === 0 && logEnter ? ' enter' : ''}" style="--i:0">${esc(entry.text)}</div>`).join('')
    : '';
  $('endTurnBtn').classList.toggle('hidden', !(state.isLeader && state.isTurn && state.clue));
}

// O‘yin uslubiga qarab, ijtimoiy tarmoqlarga yaqin kulgili laqab.
function playerTag(playerId) {
  const info = state.playerNames?.[playerId] || {};
  const stats = info.stats || {};
  const correct = Number(stats.correct) || 0;
  const wrong = Number(stats.wrong) || 0;
  const clues = Number(stats.clues) || 0;
  const tries = correct + wrong;
  const team = state.teams.find((item) => item.playerIds.includes(playerId));
  const won = !state.draw && Boolean(team && team.id === state.winnerTeamId);
  const leader = Boolean(info.isLeader || team?.leaderId === playerId);

  if (won && leader && clues >= 2) return 'Rejissor 🎬';
  if (won && correct >= 5) return 'Ana xolas! 🔥';
  if (won && correct >= 3) return 'Snayper 🎯';
  if (won) return 'G‘olib qahramoni 🏆';
  if (!info.online) return 'Wi-Fi yo‘q 📶';
  if (clues >= 3) return 'Chiroqchi 💡';
  if (correct >= 5 && tries > 0 && correct / tries >= 0.8) return 'Ana xolas! 🔥';
  if (correct >= 4 && tries > 0 && correct / tries >= 0.7) return 'To‘g‘ra aka 🎯';
  if (correct >= 2) return 'Nishonchi 🎯';
  if (wrong >= 3 && tries > 0 && correct / tries < 0.4) return 'Navigatsiya 🧭';
  if (tries === 0 && clues === 0 && !leader) return 'Qalay? 🛋️';
  if (leader && clues === 0) return 'Jim boshliq 🤫';
  if (wrong >= 2) return 'Xato aka ❌';
  if (correct >= 1) return 'Topquchi ✅';
  if (info.isHost) return 'Mezbon 🏠';
  return 'Qatnashchi 🙂';
}

function renderWinner() {
  const modal = $('winnerModal');
  if (state.phase !== 'finished') { modal.classList.add('hidden'); return; }
  const winner = teamById(state.winnerTeamId);
  $('winnerTitle').textContent = state.draw ? '🤝 Durang' : `${winner?.name || ''} 🏆`;
  const isHost = Boolean(state.isHost);
  $('restartBtn').classList.toggle('hidden', !isHost);

  const statsBox = $('winnerStats');
  statsBox.classList.toggle('hidden', isHost);
  if (!isHost) {
    const ordered = [...state.teams].sort((a, b) =>
      Number(b.id === state.winnerTeamId) - Number(a.id === state.winnerTeamId));
    statsBox.innerHTML = ordered.flatMap((team) => team.playerIds).map((id) => {
      const name = state.playerNames?.[id]?.name || '—';
      return `<div class="winner-stat"><strong>${esc(name)}</strong><span>${esc(playerTag(id))}</span></div>`;
    }).join('');
  } else {
    statsBox.innerHTML = '';
  }

  $('newGameBtn').classList.remove('hidden');
  modal.classList.remove('hidden');
}

function render() {
  if (!state) return;
  if (state.code !== lastRoomCode) {
    enteredKeys.clear();
    lastRoomCode = state.code;
    lastPickCount = null;
    lastClueText = null;
    lastLogText = null;
  }
  if (state.phase === 'lobby' && lastPhase === 'finished') enteredKeys.clear();
  lastPhase = state.phase;
  renderChat();
  $('roomPill').classList.remove('hidden');
  $('codeText').textContent = state.code;
  $('winnerModal').classList.add('hidden');

  if (state.phase === 'selecting') { showScreen('selecting'); return; }
  if (state.phase === 'lobby') { showScreen('lobby'); renderLobby(); return; }
  if (state.phase === 'selection') { showScreen('selection'); renderSelection(); return; }
  showScreen('game');
  renderGame();
  renderWinner();
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  let result;

  if (action === 'pick-word') result = await call('pickWord', { wordId: target.dataset.id });
  else if (action === 'unpick-word') result = await call('unpickWord', { wordId: target.dataset.id });
  else if (action === 'send-clue') result = await call('sendClue', { text: $('clueInput')?.value || '' });
  else if (action === 'send-chat') {
    const input = target.closest('.chat-box')?.querySelector('[data-chat-input]');
    result = await call('sendChat', { text: input?.value || '' });
    if (result.ok && input) input.value = '';
  }
  else if (action === 'guess') result = await call('guess', { wordId: target.dataset.id });
  else if (action === 'end-turn') result = await call('endTurn');
  else if (action === 'add-team') result = await call('addTeam');
  else if (action === 'remove-team') result = await call('removeTeam');
  else if (action === 'start-game') result = await call('startGame');
  else if (action === 'restart') result = await call('restartGame');
  else if (action === 'leave' || action === 'new-game') {
    await call('leaveRoom');
    sessionStorage.clear();
    location.href = '/';
    return;
  } else return;

  if (!result.ok) toast(result.error, 'error');
});

document.addEventListener('change', async (event) => {
  const target = event.target.closest('[data-action="set-team"]');
  if (!target) return;
  const result = await call('setTeam', { playerId: target.dataset.playerId, teamId: target.value });
  if (!result.ok) toast(result.error, 'error');
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.target.id === 'clueInput') {
    event.preventDefault();
    document.querySelector('[data-action="send-clue"]')?.click();
  } else if (event.target.matches?.('[data-chat-input]')) {
    event.preventDefault();
    event.target.closest('.chat-box')?.querySelector('[data-action="send-chat"]')?.click();
  }
});

$('createBtn').addEventListener('click', createRoom);
$('joinBtn').addEventListener('click', joinRoom);

$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('sozlar.theme', next);
  applyTheme(next);
});
$('copyBtn').addEventListener('click', async () => {
  if (!state) return;
  const link = `${location.origin}/?room=${state.code}`;
  try { await navigator.clipboard.writeText(link); toast('✓', 'success'); }
  catch { toast(link, 'info'); }
});

socket.on('connect', () => {
  const code = sessionStorage.getItem('sozlar.roomCode');
  const playerId = sessionStorage.getItem('sozlar.playerId');
  if (code && playerId) {
    socket.emit('rejoin', { code, playerId }, (result) => {
      if (!result?.ok) {
        sessionStorage.removeItem('sozlar.roomCode');
        sessionStorage.removeItem('sozlar.playerId');
      }
    });
  }
  const room = new URLSearchParams(location.search).get('room');
  if (room) $('joinCode').value = room.toUpperCase();
  const name = sessionStorage.getItem('sozlar.name');
  if (name && !$('joinName').value) $('joinName').value = name;
});

socket.on('disconnect', () => toast('…', 'error'));
socket.on('connect_error', () => toast('…', 'error'));
socket.on('toast', ({ text, kind }) => toast(text, kind));
socket.on('state', (next) => { state = next; render(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
