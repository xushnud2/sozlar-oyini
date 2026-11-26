const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3999;
const URL = `http://127.0.0.1:${PORT}`;
const latest = new WeakMap();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LETTERS = 'abcdefghij';

async function waitHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${URL}/health`);
      if (response.ok) return response.json();
    } catch { /* kutamiz */ }
    await sleep(100);
  }
  throw new Error('Server ishga tushmadi.');
}

function connect(clients) {
  const socket = io(URL, { transports: ['websocket'], reconnection: false });
  socket.on('state', (state) => latest.set(socket, state));
  clients.push(socket);
  return socket;
}

const stateOf = (socket) => latest.get(socket);
const ack = (socket, event, data = {}) => new Promise((resolve) => socket.emit(event, data, resolve));

async function waitState(socket, predicate, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = stateOf(socket);
    if (state && predicate(state)) return state;
    await sleep(40);
  }
  throw new Error(`Kutilmadi: ${label}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Xato: ${message}`);
  console.log(`✓ ${message}`);
}

async function main() {
  const clients = [];
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore'
  });

  async function playGame({ team1Score, team2Score, checkChat = false }) {
    const host = connect(clients);
    const p2 = connect(clients);
    const p3 = connect(clients);
    const p4 = connect(clients);
    const roomClients = [host, p2, p3, p4];
    await Promise.all(roomClients.map((socket) => (
      socket.connected ? Promise.resolve() : new Promise((resolve) => socket.on('connect', resolve))
    )));

    const created = await ack(host, 'createRoom', { name: 'Host', teamCount: 2 });
    assert(created.ok, 'xona yaratildi');
    const code = created.code;
    const lobby = await waitState(host, (state) => state.code === code, 'lobby');
    const [team1, team2] = lobby.teams.map((team) => team.id);

    const joined2 = await ack(p2, 'joinRoom', { code, name: 'L2', teamId: team2 });
    const joined3 = await ack(p3, 'joinRoom', { code, name: 'G1', teamId: team1 });
    const joined4 = await ack(p4, 'joinRoom', { code, name: 'G2', teamId: team2 });
    assert(joined2.ok && joined3.ok && joined4.ok, 'guruhlarga 2 o‘yinchidan qo‘shildi');
    await waitState(host, (state) => state.teams.every((team) => team.count === 2), 'lobby tayyor');

    assert((await ack(host, 'startGame')).ok, 'boshlash');
    await waitState(host, (state) => state.phase === 'selecting', 'o‘yinchilar tanlanmoqda');
    const selecting = await waitState(host, (state) => state.phase === 'selection', 'tanlash bosqichi');
    assert(selecting.board.length === 30, '2 guruh uchun 30 so‘z');

    const t1Players = [
      { socket: host, id: created.playerId, name: 'Host' },
      { socket: p3, id: joined3.playerId, name: 'G1' }
    ];
    const t2Players = [
      { socket: p2, id: joined2.playerId, name: 'L2' },
      { socket: p4, id: joined4.playerId, name: 'G2' }
    ];
    const leader1Id = selecting.teams.find((team) => team.id === team1).leaderId;
    const leader2Id = selecting.teams.find((team) => team.id === team2).leaderId;
    const leader1 = t1Players.find((player) => player.id === leader1Id);
    const guesser1 = t1Players.find((player) => player.id !== leader1Id);
    const leader2 = t2Players.find((player) => player.id === leader2Id);
    const guesser2 = t2Players.find((player) => player.id !== leader2Id);
    assert(leader1 && guesser1 && leader2 && guesser2, 'boshliqlar random tanlandi');

    const l1State = await waitState(leader1.socket, (state) => state.phase === 'selection', '1-boshliq tanlayapti');
    const firstTen = l1State.board.filter((word) => !word.mine && !word.taken).slice(0, 10).map((word) => word.id);
    for (const id of firstTen) await ack(leader1.socket, 'pickWord', { wordId: id });
    const pickedOne = await waitState(leader1.socket, (state) => state.selection.ready, '1-boshliq 10 so‘z tanladi');
    assert(pickedOne.board.filter((word) => word.mine).length === 10, '1-guruhning 10 so‘zi yashirin');

    const l2State = await waitState(leader2.socket, (state) => state.phase === 'selection', '2-boshliq tanlayapti');
    const nextTen = l2State.board.filter((word) => !word.mine && !word.taken).slice(0, 10).map((word) => word.id);
    for (const id of nextTen) await ack(leader2.socket, 'pickWord', { wordId: id });
    const playing = await waitState(leader1.socket, (state) => state.phase === 'playing', 'o‘yin boshlandi');

    const ownIds = playing.board.filter((word) => word.mine).map((word) => word.id);
    assert(ownIds.length === 10 && playing.board.length === 10, 'boshliq faqat o‘z 10 so‘zini ko‘radi');
    assert(!playing.board.some((word) => word.owner), 'boshliq boshqa guruh so‘zlarini ko‘rmaydi');
    const guesserState = await waitState(guesser1.socket, (state) => state.phase === 'playing', 'aʼzo o‘yinda');
    assert(!guesserState.board.some((word) => word.owner || word.mine), 'aʼzo hech qanday kalitni ko‘rmaydi');

    if (checkChat) {
      assert((await ack(guesser1.socket, 'sendChat', { text: 'salom guruh' })).ok, 'guruh chat xabari');
      const ownChat = await waitState(guesser1.socket, (state) => state.chat?.length === 1, 'chat o‘z guruhida');
      assert(ownChat.chat[0].text === 'salom guruh' && ownChat.chat[0].name === guesser1.name, 'chat xabari to‘g‘ri');
      assert(!('teamId' in ownChat.chat[0]), 'guruh kodi clientga chiqmaydi');
      assert((stateOf(leader1.socket)?.chat || []).length === 1, '1-guruh o‘z chatini ko‘radi');
      assert((stateOf(leader2.socket)?.chat || []).length === 0, '2-guruh boshlig‘i boshqa chatni ko‘rmaydi');
      assert((stateOf(guesser2.socket)?.chat || []).length === 0, '2-guruh aʼzosi boshqa chatni ko‘rmaydi');
    }

    let guessed1 = 0;
    let guessed2 = 0;
    for (let round = 0; round < 3; round += 1) {
      await waitState(leader1.socket, (state) => state.phase === 'playing' && state.turnTeamId === team1, `1-guruh navbati ${round + 1}`);
      assert((await ack(leader1.socket, 'sendClue', { text: `ishora${LETTERS[round]}` })).ok, `1-guruh ishorasi ${round + 1}`);
      const batch1 = ownIds.slice(guessed1, guessed1 + Math.min(3, team1Score - guessed1));
      guessed1 += batch1.length;
      for (const id of batch1) assert((await ack(guesser1.socket, 'guess', { wordId: id })).ok, `1-guruh topdi ${id}`);
      await waitState(leader1.socket, (state) => state.phase !== 'playing' || !state.clue || state.clue.guessesLeft === 3 - batch1.length, '1-guruh ishorasi holati');
      if (stateOf(leader1.socket).phase === 'playing' && stateOf(leader1.socket).turnTeamId === team1 && stateOf(leader1.socket).clue) {
        assert((await ack(leader1.socket, 'endTurn')).ok, `1-guruh navbatni tugatdi ${round + 1}`);
      }

      await waitState(leader2.socket, (state) => state.phase === 'playing' && state.turnTeamId === team2, `2-guruh navbati ${round + 1}`);
      assert((await ack(leader2.socket, 'sendClue', { text: `klishi${LETTERS[round]}` })).ok, `2-guruh ishorasi ${round + 1}`);
      const batch2 = nextTen.slice(guessed2, guessed2 + Math.min(3, team2Score - guessed2));
      guessed2 += batch2.length;
      for (const id of batch2) assert((await ack(guesser2.socket, 'guess', { wordId: id })).ok, `2-guruh topdi ${id}`);
      await waitState(leader2.socket, (state) => state.phase !== 'playing' || !state.clue || state.clue.guessesLeft === 3 - batch2.length, '2-guruh ishorasi holati');
      if (stateOf(leader2.socket).phase === 'playing' && stateOf(leader2.socket).turnTeamId === team2 && stateOf(leader2.socket).clue) {
        assert((await ack(leader2.socket, 'endTurn')).ok, `2-guruh navbatni tugatdi ${round + 1}`);
      }
    }

    const finished = await waitState(leader1.socket, (state) => state.phase === 'finished', 'o‘yin tugadi');
    const t1 = finished.teams.find((team) => team.id === team1);
    const t2 = finished.teams.find((team) => team.id === team2);
    assert(t1.cluesUsed === 3 && t2.cluesUsed === 3, 'har guruh 3 ishorani ishlatdi');
    assert(t1.found === team1Score && t2.found === team2Score, `hisob ${team1Score}:${team2Score}`);
    return { finished, team1, team2 };
  }

  try {
    const health = await waitHealth();
    assert(health.words > 10000, `so‘z bazasi ${health.words} ta`);

    const win = await playGame({ team1Score: 7, team2Score: 4, checkChat: true });
    assert(win.finished.winnerTeamId === win.team1, 'ko‘p so‘z topgan guruh yutadi');
    assert(win.finished.draw === false, 'durang emas');

    const draw = await playGame({ team1Score: 6, team2Score: 6 });
    assert(draw.finished.draw === true, 'tenglik durang deb topildi');
    assert(draw.finished.winnerTeamId === null, 'durangda guruh yo‘q');

    console.log('\nBarcha sinovlar o‘tdi.');
  } finally {
    server.kill();
    clients.forEach((socket) => socket.close());
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
