const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const { WORDS, DAILY_COUNT, FAMILIAR_COUNT } = require('./words');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, `rooms-${PORT}.json`);
const WORDS_PER_TEAM = 10;
const MAX_CLUES = 3;
const MAX_GUESSES = 3;
const MIN_TEAMS = 2;
const MAX_TEAMS = 5;
const MAX_PLAYERS = 50;
const MAX_PER_TEAM = 20;

const rooms = new Map();
// Kundalik, tanish va kam uchraydigan so‘zlar alohida qavaatlarda.
const DAILY_WORDS = WORDS.slice(0, DAILY_COUNT);
const FAMILIAR_WORDS = WORDS.slice(DAILY_COUNT, FAMILIAR_COUNT);
const RARE_WORDS = WORDS.slice(FAMILIAR_COUNT);
let wordBag = [];

const uid = () => (typeof randomUUID === 'function' ? randomUUID() : Math.random().toString(36).slice(2));
const norm = (value) => String(value || '').toLowerCase().replace(/[‘’']/g, '').trim();
const cleanName = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 20);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Har 30 so‘zlik taxtaga 20 kundalik, 8 tanish va 1-2 kam uchraydigan so‘z.
function buildWordDeck() {
  const daily = shuffle(DAILY_WORDS);
  const familiar = shuffle(FAMILIAR_WORDS);
  const rare = shuffle(RARE_WORDS);
  const deck = [];
  const take = (pool) => (pool.length ? pool.pop() : null);

  while (daily.length || familiar.length || rare.length) {
    const block = [];
    for (let index = 0; index < 20; index += 1) {
      const word = take(daily) || take(familiar);
      if (word) block.push(word);
    }
    for (let index = 0; index < 8 && block.length < 30; index += 1) {
      const word = take(familiar) || take(daily);
      if (word) block.push(word);
    }
    const extras = 1 + (Math.random() < 0.35 ? 1 : 0);
    for (let index = 0; index < extras && block.length < 30; index += 1) {
      const word = take(rare) || take(familiar);
      if (word) block.push(word);
    }
    if (!block.length) break;
    deck.push(...shuffle(block));
  }
  return deck;
}

function takeWords(count) {
  const picked = [];
  while (picked.length < count) {
    if (wordBag.length === 0) wordBag = buildWordDeck();
    picked.push(wordBag.shift());
  }
  return picked;
}

const freshStats = () => ({ correct: 0, wrong: 0, clues: 0 });
function statsOf(player) {
  if (!player.stats) player.stats = freshStats();
  return player.stats;
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    teams: room.teams.map((team) => ({ ...team, playerIds: [...team.playerIds] })),
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      teamId: player.teamId,
      isLeader: player.isLeader,
      isHost: player.isHost,
      stats: { ...statsOf(player) }
    })),
    board: room.board,
    clue: room.clue,
    turnTeamId: room.turnTeamId,
    winnerTeamId: room.winnerTeamId,
    draw: Boolean(room.draw),
    log: room.log,
    logSeq: room.logSeq,
    chat: room.chat,
    streak: room.streak,
    createdAt: room.createdAt
  };
}

function saveRooms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${ROOMS_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify([...rooms.values()].map(serializeRoom)));
    fs.renameSync(temp, ROOMS_FILE);
  } catch (error) {
    console.error('Xonalar saqlanmadi:', error.message);
  }
}

function loadRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    for (const data of saved) {
      const room = {
        code: data.code,
        hostId: data.hostId,
        phase: data.phase === 'selecting' ? 'lobby' : data.phase,
        teams: (data.teams || []).map((team) => ({ cluesUsed: 0, done: false, ...team })),
        players: new Map(data.players.map((player) => [player.id, { ...player, socketId: null, online: false }])),
        board: data.board || [],
        clue: data.clue || null,
        turnTeamId: data.turnTeamId || null,
        winnerTeamId: data.winnerTeamId || null,
        draw: Boolean(data.draw),
        log: data.log || [],
        logSeq: data.logSeq || 0,
        chat: data.chat || [],
        streak: data.streak || {},
        createdAt: data.createdAt || Date.now()
      };
      room.players.forEach((player) => statsOf(player));
      rooms.set(room.code, room);
    }
    console.log(`Saqlangan xonalar: ${rooms.size}`);
  } catch (error) {
    console.error('Xonalar o‘qilmadi:', error.message);
  }
}

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makeTeam(index) {
  return {
    id: uid(),
    name: `${index + 1}-guruh`,
    colorIndex: index,
    playerIds: [],
    leaderId: null,
    ready: false,
    cluesUsed: 0,
    done: false
  };
}

function findRoomBySocket(socket) {
  for (const room of rooms.values()) {
    if ([...room.players.values()].some((player) => player.socketId === socket.id)) return room;
  }
  return null;
}

function playerBySocket(room, socket) {
  return [...room.players.values()].find((player) => player.socketId === socket.id) || null;
}

function hostRoomBySocket(socket) {
  const room = findRoomBySocket(socket);
  const player = room && playerBySocket(room, socket);
  return player && player.isHost ? room : null;
}

function teamOf(room, playerId) {
  return room.teams.find((team) => team.playerIds.includes(playerId)) || null;
}

function pickedCount(room, teamId) {
  return room.board.filter((word) => word.owner === teamId).length;
}

function remaining(room, teamId) {
  return room.board.filter((word) => word.owner === teamId && !word.revealed).length;
}

function teamDone(room, teamId) {
  const team = room.teams.find((item) => item.id === teamId);
  if (!team) return true;
  return Boolean(team.done) || (team.cluesUsed || 0) >= MAX_CLUES || remaining(room, teamId) === 0;
}

function allTeamsDone(room) {
  return room.teams.every((team) => teamDone(room, team.id));
}

function finishGame(room) {
  if (room.phase !== 'playing') return;
  const scores = room.teams.map((team) => ({
    team,
    found: WORDS_PER_TEAM - remaining(room, team.id)
  }));
  const best = Math.max(...scores.map((item) => item.found), 0);
  const leaders = scores.filter((item) => item.found === best);

  room.phase = 'finished';
  room.clue = null;
  room.draw = leaders.length !== 1;
  room.winnerTeamId = room.draw ? null : leaders[0].team.id;

  if (room.draw) notify(room, `🤝 Durang · ${best} so‘z`, 'info');
  else notify(room, `🏆 ${leaders[0].team.name} · ${best} so‘z`, 'success');
}

function notify(room, text, kind = 'info', targetTeamId = null) {
  const entry = { id: room.logSeq += 1, text, kind, ts: Date.now() };
  room.log.push(entry);
  if (room.log.length > 30) room.log.shift();

  for (const player of room.players.values()) {
    if (!player.online || !player.socketId) continue;
    if (targetTeamId && player.teamId !== targetTeamId) continue;
    io.to(player.socketId).emit('toast', { id: entry.id, text, kind });
  }
}

function buildState(room, player) {
  const team = teamOf(room, player.id);
  const isTurn = room.turnTeamId === player.teamId;
  const cluesUsed = team?.cluesUsed || 0;

  const board = [];
  if (room.phase !== 'selection' || player.isLeader) {
    for (const word of room.board) {
      // O‘yin boshlangach boshliq faqat o‘zining 10 so‘zini ko‘radi.
      if (player.isLeader && room.phase !== 'selection' && word.owner !== player.teamId) continue;
      const item = { id: word.id, text: word.text, revealed: word.revealed };

      if (room.phase === 'selection') {
        // Boshliq faqat o‘zinikini ko‘radi; boshqalarniki oddiy "band" bo‘lib ko‘rinadi.
        if (word.owner === player.teamId) item.mine = true;
        else if (word.owner) item.taken = true;
      } else {
        if (player.isLeader && word.owner === player.teamId) item.mine = true;
        // Yuqoridan kelgan xabar sifatida faqat bosilgan so‘zlarning egasi ko‘rinadi.
        if (word.revealed) item.owner = word.owner;
      }
      board.push(item);
    }
  }

  return {
    code: room.code,
    phase: room.phase,
    playerId: player.id,
    playerName: player.name,
    playerTeamId: player.teamId,
    playerNames: Object.fromEntries(
      [...room.players.entries()].map(([id, item]) => [id, {
        name: item.name,
        online: item.online,
        teamId: item.teamId,
        isLeader: item.isLeader,
        isHost: item.isHost,
        stats: { ...statsOf(item) }
      }])
    ),
    isHost: player.isHost,
    isLeader: player.isLeader,
    isTurn,
    canGuess: room.phase === 'playing' && isTurn && !player.isLeader && Boolean(room.clue) && room.clue.guessesLeft > 0,
    canClue: room.phase === 'playing' && isTurn && player.isLeader && !teamDone(room, player.teamId),
    cluesUsed,
    cluesLeft: Math.max(0, MAX_CLUES - cluesUsed),
    maxClues: MAX_CLUES,
    selection: {
      picked: team ? pickedCount(room, team.id) : 0,
      target: WORDS_PER_TEAM,
      ready: Boolean(team?.ready)
    },
    teams: room.teams.map((item) => {
      const owned = room.board.filter((word) => word.owner === item.id);
      const found = owned.filter((word) => word.revealed).length;
      const used = item.cluesUsed || 0;
      return {
        id: item.id,
        name: item.name,
        colorIndex: item.colorIndex,
        leaderId: item.leaderId,
        playerIds: [...item.playerIds],
        count: item.playerIds.length,
        ready: item.ready,
        remaining: room.phase === 'selection' ? WORDS_PER_TEAM - owned.length : owned.length - found,
        total: WORDS_PER_TEAM,
        found: room.phase === 'selection' ? 0 : found,
        streak: room.streak?.[item.id] || 0,
        cluesUsed: used,
        cluesLeft: Math.max(0, MAX_CLUES - used),
        done: Boolean(item.done) || teamDone(room, item.id)
      };
    }),
    board,
    clue: room.clue ? { text: room.clue.text, byName: room.clue.byName, guessesLeft: room.clue.guessesLeft } : null,
    turnTeamId: room.turnTeamId,
    winnerTeamId: room.winnerTeamId,
    draw: Boolean(room.draw),
    log: room.log.slice(-8),
    chat: room.chat
      .filter((message) => message.teamId === player.teamId)
      .map(({ teamId, ...message }) => message),
    maxTeams: MAX_TEAMS,
    maxGuesses: MAX_GUESSES
  };
}

function broadcastState(room) {
  for (const player of room.players.values()) {
    if (player.online && player.socketId) {
      io.to(player.socketId).emit('state', buildState(room, player));
    }
  }
  saveRooms();
}

function ensureLeaders(room) {
  for (const team of room.teams) {
    const leaderExists = team.leaderId && team.playerIds.includes(team.leaderId) && room.players.has(team.leaderId);
    if (!leaderExists) team.leaderId = team.playerIds[0] || null;
    for (const playerId of team.playerIds) {
      const player = room.players.get(playerId);
      if (player) player.isLeader = playerId === team.leaderId;
    }
  }
}

// Boshliqlarni o‘yin o‘zi random saylaydi.
function pickLeadersRandomly(room) {
  room.teams.forEach((team) => {
    if (!team.playerIds.length) return;
    const leaderId = team.playerIds[Math.floor(Math.random() * team.playerIds.length)];
    team.leaderId = leaderId;
    team.playerIds.forEach((id) => {
      const player = room.players.get(id);
      if (player) player.isLeader = id === leaderId;
    });
  });
}

function resetBoard(room) {
  const boardSize = Math.max(30, room.teams.length * WORDS_PER_TEAM);
  const texts = takeWords(boardSize);

  room.board = texts.map((text, index) => ({
    id: index,
    text,
    owner: null,
    revealed: false
  }));
  room.teams.forEach((team) => {
    team.ready = false;
    team.cluesUsed = 0;
    team.done = false;
  });
  room.clue = null;
  room.winnerTeamId = null;
  room.draw = false;
  room.log = [];
  room.logSeq = 0;
  room.chat = [];
  room.streak = Object.fromEntries(room.teams.map((team) => [team.id, 0]));
  room.turnTeamId = room.teams[0].id;
  room.players.forEach((player) => { player.stats = freshStats(); });
}

function finishSelectionIfReady(room) {
  if (room.phase !== 'selection') return;
  if (!room.teams.every((team) => team.ready)) return;
  room.phase = 'playing';
  room.turnTeamId = room.teams[0].id;
  room.clue = null;
  notify(room, 'Boshlandi', 'success');
}

function advanceTurn(room) {
  room.clue = null;
  if (allTeamsDone(room)) {
    finishGame(room);
    return;
  }
  const start = room.teams.findIndex((team) => team.id === room.turnTeamId);
  for (let step = 1; step <= room.teams.length; step += 1) {
    const index = (Math.max(start, 0) + step) % room.teams.length;
    const team = room.teams[index];
    if (!teamDone(room, team.id)) {
      room.turnTeamId = team.id;
      notify(room, `Navbat: ${team.name}`, 'info');
      return;
    }
  }
  finishGame(room);
}

function applyGuess(room, player, word) {
  const teamId = player.teamId;
  word.revealed = true;
  room.clue.guessesLeft -= 1;

  if (word.owner === teamId) {
    statsOf(player).correct += 1;
    room.streak[teamId] = (room.streak[teamId] || 0) + 1;
    const streak = room.streak[teamId] >= 2 ? ` 🔥${room.streak[teamId]}` : '';
    notify(room, `✅ ${word.text}${streak}`, 'success');
  } else {
    statsOf(player).wrong += 1;
    room.streak[teamId] = 0;
    notify(room, `❌ ${word.text}`, 'error');
  }

  if (remaining(room, teamId) === 0) {
    const team = room.teams.find((item) => item.id === teamId);
    if (team) team.done = true;
    if (allTeamsDone(room)) finishGame(room);
    else advanceTurn(room);
  } else if (room.clue.guessesLeft === 0) {
    advanceTurn(room);
  }
}

function ack(callback, payload) {
  if (typeof callback === 'function') callback(payload);
}

function handle(socket, event, handler) {
  socket.on(event, async (data = {}, callback) => {
    try {
      const result = await handler(data || {});
      ack(callback, result && typeof result === 'object' ? result : { ok: true });
    } catch (error) {
      console.error(`[${event}]`, error);
      ack(callback, { ok: false, error: 'Qayta urining.' });
    }
  });
}

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, words: WORDS.length }));
app.use(express.static(path.join(__dirname, 'public')));

loadRooms();

io.on('connection', (socket) => {
  handle(socket, 'createRoom', ({ name, teamCount }) => {
    const clean = cleanName(name);
    if (clean.length < 2) return { ok: false, error: 'Ism kiriting.' };

    const count = clamp(Number(teamCount) || 2, MIN_TEAMS, MAX_TEAMS);
    const code = generateCode();
    const room = {
      code,
      hostId: null,
      phase: 'lobby',
      teams: Array.from({ length: count }, (_, index) => makeTeam(index)),
      players: new Map(),
      board: [],
      clue: null,
      turnTeamId: null,
      winnerTeamId: null,
      draw: false,
      log: [],
      logSeq: 0,
      chat: [],
      streak: {},
      createdAt: Date.now()
    };

    const player = {
      id: uid(),
      socketId: socket.id,
      name: clean,
      teamId: room.teams[0].id,
      isLeader: true,
      isHost: true,
      online: true,
      stats: freshStats()
    };
    room.players.set(player.id, player);
    room.teams[0].playerIds.push(player.id);
    room.teams[0].leaderId = player.id;
    room.hostId = player.id;
    rooms.set(code, room);
    socket.join(code);
    broadcastState(room);

    return { ok: true, code, playerId: player.id };
  });

  handle(socket, 'joinRoom', ({ code, name, teamId }) => {
    const clean = cleanName(name);
    if (clean.length < 2) return { ok: false, error: 'Ism kiriting.' };

    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'O‘yin boshlangan.' };
    if (room.players.size >= MAX_PLAYERS) return { ok: false, error: 'Xona to‘lgan.' };

    let team = room.teams.find((item) => item.id === teamId);
    if (!team || team.playerIds.length >= MAX_PER_TEAM) {
      team = [...room.teams].sort((a, b) => a.playerIds.length - b.playerIds.length)[0];
    }

    const player = {
      id: uid(),
      socketId: socket.id,
      name: clean,
      teamId: team.id,
      isLeader: false,
      isHost: false,
      online: true,
      stats: freshStats()
    };
    const wasEmpty = team.playerIds.length === 0;
    room.players.set(player.id, player);
    team.playerIds.push(player.id);
    if (wasEmpty) team.leaderId = player.id;
    ensureLeaders(room);
    socket.join(room.code);
    broadcastState(room);

    return { ok: true, code: room.code, playerId: player.id };
  });

  handle(socket, 'rejoin', ({ code, playerId }) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = room.players.get(String(playerId || ''));
    if (!player) return { ok: false, error: 'O‘yinchi yo‘q.' };

    player.socketId = socket.id;
    player.online = true;
    socket.join(room.code);
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'addTeam', () => {
    const room = hostRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Faqat xona egasi.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'O‘yin boshlangan.' };
    if (room.teams.length >= MAX_TEAMS) return { ok: false, error: 'Maksimum 5 guruh.' };

    room.teams.push(makeTeam(room.teams.length));
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'removeTeam', () => {
    const room = hostRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Faqat xona egasi.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'O‘yin boshlangan.' };
    if (room.teams.length <= MIN_TEAMS) return { ok: false, error: 'Kamida 2 guruh.' };

    const team = room.teams[room.teams.length - 1];
    if (team.playerIds.length > 0) return { ok: false, error: 'Oxirgi guruh bo‘sh emas.' };
    room.teams.pop();
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'setTeam', ({ playerId, teamId }) => {
    const room = hostRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Faqat xona egasi.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'O‘yin boshlangan.' };

    const target = room.players.get(String(playerId || ''));
    const nextTeam = room.teams.find((team) => team.id === teamId);
    if (!target || !nextTeam) return { ok: false, error: 'Topilmadi.' };

    const oldTeam = teamOf(room, target.id);
    if (oldTeam && oldTeam.id !== nextTeam.id) {
      oldTeam.playerIds = oldTeam.playerIds.filter((id) => id !== target.id);
      nextTeam.playerIds.push(target.id);
      target.teamId = nextTeam.id;
      ensureLeaders(room);
      broadcastState(room);
    }
    return { ok: true };
  });

  handle(socket, 'setLeader', ({ playerId }) => {
    const room = hostRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Faqat xona egasi.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'O‘yin boshlangan.' };

    const target = room.players.get(String(playerId || ''));
    if (!target) return { ok: false, error: 'Topilmadi.' };
    const team = teamOf(room, target.id);
    if (!team) return { ok: false, error: 'Topilmadi.' };

    team.leaderId = target.id;
    ensureLeaders(room);
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'startGame', () => {
    const room = hostRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Faqat xona egasi.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'Allaqachon boshlangan.' };

    ensureLeaders(room);
    const weak = room.teams.find((team) => team.playerIds.length < 2 || !team.leaderId);
    if (weak) return { ok: false, error: 'Har guruhda 2 o‘yinchi va boshliq kerak.' };

    room.phase = 'selecting';
    broadcastState(room);
    setTimeout(() => {
      if (!rooms.has(room.code) || room.phase !== 'selecting') return;
      pickLeadersRandomly(room);
      resetBoard(room);
      room.phase = 'selection';
      broadcastState(room);
    }, 2000);
    return { ok: true };
  });

  handle(socket, 'pickWord', ({ wordId }) => {
    const room = findRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = playerBySocket(room, socket);
    if (room.phase !== 'selection') return { ok: false, error: 'Tanlash tugagan.' };
    if (!player.isLeader) return { ok: false, error: 'Faqat boshliq.' };

    const team = teamOf(room, player.id);
    if (!team || team.ready) return { ok: false, error: 'Tanlash tugagan.' };
    if (pickedCount(room, team.id) >= WORDS_PER_TEAM) return { ok: false, error: '10 ta tanlandi.' };

    const word = room.board.find((item) => item.id === Number(wordId));
    if (!word) return { ok: false, error: 'So‘z yo‘q.' };
    if (word.owner) return { ok: false, error: 'Bu so‘z band.' };

    word.owner = team.id;
    if (pickedCount(room, team.id) === WORDS_PER_TEAM) team.ready = true;
    finishSelectionIfReady(room);
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'unpickWord', ({ wordId }) => {
    const room = findRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = playerBySocket(room, socket);
    if (room.phase !== 'selection') return { ok: false, error: 'Tanlash tugagan.' };
    if (!player.isLeader) return { ok: false, error: 'Faqat boshliq.' };

    const team = teamOf(room, player.id);
    if (!team || team.ready) return { ok: false, error: 'Tanlash tugagan.' };

    const word = room.board.find((item) => item.id === Number(wordId));
    if (!word || word.owner !== team.id) return { ok: false, error: 'Bu siznikiga kirmaydi.' };

    word.owner = null;
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'sendClue', ({ text }) => {
    const room = findRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = playerBySocket(room, socket);
    if (room.phase !== 'playing') return { ok: false, error: 'Hali o‘yin kutilmoqda.' };
    if (!player.isLeader || player.teamId !== room.turnTeamId) return { ok: false, error: 'Navbatdagi boshliq yozadi.' };
    if (room.clue) return { ok: false, error: 'Avvalgi ishora tugasin.' };
    if (teamDone(room, player.teamId)) return { ok: false, error: 'Ishoralar tugadi.' };

    const value = String(text || '').trim();
    const key = norm(value);
    if (key.length < 2 || key.length > 24 || !/^[\p{L}\p{M}‘’'-]+$/u.test(value) || !/[\p{L}]/u.test(key)) {
      return { ok: false, error: 'Bitta so‘z yozing.' };
    }
    if (room.board.some((word) => norm(word.text) === key)) {
      return { ok: false, error: 'Bu so‘z taxtada bor.' };
    }

    statsOf(player).clues += 1;
    const team = room.teams.find((item) => item.id === player.teamId);
    if (team) {
      team.cluesUsed = (team.cluesUsed || 0) + 1;
      if (team.cluesUsed >= MAX_CLUES) team.done = true;
    }
    room.clue = { text: value, byName: player.name, guessesLeft: MAX_GUESSES };
    notify(room, `${value}`, 'info', player.teamId);
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'sendChat', ({ text }) => {
    const room = findRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = playerBySocket(room, socket);
    if (!player) return { ok: false, error: 'O‘yinchi yo‘q.' };

    const value = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!value) return { ok: false, error: 'Xabar yozing.' };

    room.chat.push({
      id: uid(),
      teamId: player.teamId,
      playerId: player.id,
      name: player.name,
      text: value,
      ts: Date.now()
    });
    if (room.chat.length > 40) room.chat.shift();
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'guess', ({ wordId }) => {
    const room = findRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = playerBySocket(room, socket);
    if (room.phase !== 'playing') return { ok: false, error: 'Hali o‘yin kutilmoqda.' };
    if (player.isLeader) return { ok: false, error: 'Boshliq faqat ishora yozadi.' };
    if (player.teamId !== room.turnTeamId) return { ok: false, error: 'Boshqa guruh navbati.' };
    if (!room.clue) return { ok: false, error: 'Ishora kutilmoqda.' };
    if (room.clue.guessesLeft <= 0) return { ok: false, error: 'Urinish tugadi.' };

    const word = room.board.find((item) => item.id === Number(wordId));
    if (!word) return { ok: false, error: 'So‘z yo‘q.' };
    if (word.revealed) return { ok: false, error: 'Bosilgan.' };

    applyGuess(room, player, word);

    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'endTurn', () => {
    const room = findRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Xona yo‘q.' };
    const player = playerBySocket(room, socket);
    if (room.phase !== 'playing') return { ok: false, error: 'O‘yin kutilmoqda.' };
    if (!player.isLeader || player.teamId !== room.turnTeamId) return { ok: false, error: 'Faqat navbatdagi boshliq.' };
    if (!room.clue) return { ok: false, error: 'Ishora yo‘q.' };

    advanceTurn(room);
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'restartGame', () => {
    const room = hostRoomBySocket(socket);
    if (!room) return { ok: false, error: 'Faqat xona egasi.' };
    if (room.phase !== 'finished') return { ok: false, error: 'O‘yin tugamadi.' };

    resetBoard(room);
    room.phase = 'selection';
    broadcastState(room);
    return { ok: true };
  });

  handle(socket, 'leaveRoom', () => {
    for (const [code, room] of rooms.entries()) {
      const player = playerBySocket(room, socket);
      if (!player) continue;

      room.players.delete(player.id);
      for (const team of room.teams) team.playerIds = team.playerIds.filter((id) => id !== player.id);
      socket.leave(code);

      if (room.hostId === player.id) {
        room.hostId = room.players.size ? [...room.players.keys()][0] : null;
        const newHost = room.players.get(room.hostId);
        if (newHost) newHost.isHost = true;
      }
      ensureLeaders(room);

      if (room.players.size === 0) rooms.delete(code);
      else broadcastState(room);
      return { ok: true };
    }
    return { ok: true };
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = playerBySocket(room, socket);
      if (!player) continue;
      player.socketId = null;
      player.online = false;
      broadcastState(room);
      return;
    }
  });
});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [code, room] of rooms.entries()) {
    const hasOnline = [...room.players.values()].some((player) => player.online);
    if (!hasOnline && now - room.createdAt > 24 * 60 * 60 * 1000) {
      rooms.delete(code);
      changed = true;
    }
  }
  if (changed) saveRooms();
}, 10 * 60 * 1000).unref?.();

server.listen(PORT, () => {
  console.log(`So‘zlar poygasi: http://localhost:${PORT}`);
  console.log(`So‘z bazasi: ${WORDS.length}`);
});
