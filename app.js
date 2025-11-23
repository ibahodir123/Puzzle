const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const multEl = document.getElementById('multiplier');
const finalScoreEl = document.getElementById('finalScore');

const lobbyScreen = document.getElementById('lobbyScreen');
const matchScreen = document.getElementById('matchScreen');
const endScreen = document.getElementById('endScreen');

const playBtn = document.getElementById('playBtn');
const playAgainBtn = document.getElementById('playAgain');
const toLobbyBtn = document.getElementById('toLobby');
const restartBtn = document.getElementById('restart');
const backToLobbyBtn = document.getElementById('backToLobby');

const size = 7;
const tileTypes = ['A', 'B', 'C', 'D', 'E'];
const MATCH_FLASH_MS = 280;
const FALL_MS = 220;
let tg = null;
let isTelegram = false;
let mainButtonHandler = null;
const tileColors = {
  A: getComputedStyle(document.documentElement).getPropertyValue('--tile-a').trim(),
  B: getComputedStyle(document.documentElement).getPropertyValue('--tile-b').trim(),
  C: getComputedStyle(document.documentElement).getPropertyValue('--tile-c').trim(),
  D: getComputedStyle(document.documentElement).getPropertyValue('--tile-d').trim(),
  E: getComputedStyle(document.documentElement).getPropertyValue('--tile-e').trim(),
};

let board = [];
let selected = null;
let timerId = null;
let timeLeft = 60;
let score = 0;
let inMatch = false;
let resolving = false;
let spawnSet = new Set();

const setMainButton = (text, handler) => {
  if (!isTelegram) return;
  tg.MainButton.hide();
  if (mainButtonHandler) {
    tg.MainButton.offClick(mainButtonHandler);
  }
  mainButtonHandler = handler;
  tg.MainButton.setText(text);
  tg.MainButton.onClick(handler);
  tg.MainButton.show();
};

const setScreen = (screen) => {
  lobbyScreen.classList.toggle('active', screen === 'lobby');
  matchScreen.classList.toggle('active', screen === 'match');
  endScreen.classList.toggle('active', screen === 'end');

  if (isTelegram) {
    tg.MainButton.hide();
    tg.BackButton.hide();
    if (screen === 'lobby') {
      setMainButton('PLAY', startMatch);
    } else if (screen === 'match') {
      tg.BackButton.show();
    } else if (screen === 'end') {
      setMainButton('PLAY AGAIN', startMatch);
      tg.BackButton.show();
    }
  }
};

const randomTile = () => tileTypes[Math.floor(Math.random() * tileTypes.length)];

const createEmptyBoard = () => {
  board = Array.from({ length: size }, () => Array(size).fill(null));
};

const initTelegram = () => {
  if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;
    isTelegram = true;
    tg.ready();
    tg.expand();
    tg.MainButton.setText('PLAY');
    tg.BackButton.onClick(() => backToLobby());
  }
};

const hasInitialMatch = (grid, row, col, value) => {
  // Prevent triples when filling: check two left or two up.
  const left1 = col > 0 ? grid[row][col - 1] : null;
  const left2 = col > 1 ? grid[row][col - 2] : null;
  const up1 = row > 0 ? grid[row - 1][col] : null;
  const up2 = row > 1 ? grid[row - 2][col] : null;
  if (value === left1 && value === left2) return true;
  if (value === up1 && value === up2) return true;
  return false;
};

const generateBoard = () => {
  createEmptyBoard();
  spawnSet.clear();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let val = randomTile();
      while (hasInitialMatch(board, r, c, val)) {
        val = randomTile();
      }
      board[r][c] = val;
      spawnSet.add(`${r}-${c}`);
    }
  }
};

const renderBoard = (matchingSet = new Set()) => {
  const spawned = new Set(spawnSet);
  spawnSet.clear();
  boardEl.innerHTML = '';
  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      const div = document.createElement('button');
      div.className = 'tile';
      div.style.background = tileColors[cell];
      div.dataset.row = r;
      div.dataset.col = c;
      const key = `${r}-${c}`;
      div.dataset.pos = key;
      if (selected && selected.r === r && selected.c === c) {
        div.classList.add('selected');
      }
      if (matchingSet.has(key)) {
        div.classList.add('matching');
      }
      if (spawned.has(key)) {
        div.classList.add('spawn');
      }
      div.addEventListener('click', onTileClick);
      boardEl.appendChild(div);
    });
  });
};

const findMatches = () => {
  const matches = new Set();
  // Horizontal
  for (let r = 0; r < size; r++) {
    let runVal = board[r][0];
    let runStart = 0;
    for (let c = 1; c <= size; c++) {
      const val = c < size ? board[r][c] : null;
      if (val === runVal) continue;
      const runLen = c - runStart;
      if (runVal && runLen >= 3) {
        for (let k = runStart; k < c; k++) matches.add(`${r}-${k}`);
      }
      runVal = val;
      runStart = c;
    }
  }
  // Vertical
  for (let c = 0; c < size; c++) {
    let runVal = board[0][c];
    let runStart = 0;
    for (let r = 1; r <= size; r++) {
      const val = r < size ? board[r][c] : null;
      if (val === runVal) continue;
      const runLen = r - runStart;
      if (runVal && runLen >= 3) {
        for (let k = runStart; k < r; k++) matches.add(`${k}-${c}`);
      }
      runVal = val;
      runStart = r;
    }
  }
  return matches;
};

const collapseBoard = () => {
  spawnSet.clear();
  for (let c = 0; c < size; c++) {
    let writeRow = size - 1;
    for (let r = size - 1; r >= 0; r--) {
      if (board[r][c] !== null) {
        board[writeRow][c] = board[r][c];
        if (writeRow !== r) board[r][c] = null;
        writeRow--;
      }
    }
    for (let r = writeRow; r >= 0; r--) {
      board[r][c] = randomTile();
      spawnSet.add(`${r}-${c}`);
    }
  }
};

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const resolveMatches = async () => {
  let chain = 0;
  while (true) {
    const matches = findMatches();
    if (matches.size === 0) break;
    chain += 1;
    const multiplier = 1 + 0.5 * (chain - 1);
    multEl.textContent = `x${multiplier.toFixed(1)}`;

    renderBoard(matches);
    await wait(MATCH_FLASH_MS);

    matches.forEach((key) => {
      const [r, c] = key.split('-').map(Number);
      board[r][c] = null;
    });
    score += matches.size * 10 * multiplier;
    scoreEl.textContent = Math.round(score);

    collapseBoard();
    renderBoard();
    await wait(FALL_MS);
  }
  if (chain === 0) multEl.textContent = 'x1.0';
};

const areAdjacent = (a, b) => {
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
};

const swapCells = (a, b) => {
  const temp = board[a.r][a.c];
  board[a.r][a.c] = board[b.r][b.c];
  board[b.r][b.c] = temp;
};

const highlightInvalid = (keys) => {
  keys.forEach((k) => {
    const el = document.querySelector(`[data-pos="${k}"]`);
    if (el) {
      el.classList.add('invalid');
      setTimeout(() => el.classList.remove('invalid'), 200);
    }
  });
};

const onTileClick = async (e) => {
  if (!inMatch || resolving) return;
  const r = Number(e.currentTarget.dataset.row);
  const c = Number(e.currentTarget.dataset.col);
  if (!selected) {
    selected = { r, c };
    renderBoard();
    return;
  }
  if (selected.r === r && selected.c === c) {
    selected = null;
    renderBoard();
    return;
  }
  const target = { r, c };
  if (!areAdjacent(selected, target)) {
    selected = target;
    renderBoard();
    return;
  }

  swapCells(selected, target);
  const matches = findMatches();
  if (matches.size === 0) {
    // Invalid move, swap back.
    const keyA = `${selected.r}-${selected.c}`;
    const keyB = `${target.r}-${target.c}`;
    swapCells(selected, target);
    selected = null;
    renderBoard();
    highlightInvalid([keyA, keyB]);
    return;
  }

  selected = null;
  resolving = true;
  await resolveMatches();
  resolving = false;
  renderBoard();
};

const startTimer = () => {
  clearInterval(timerId);
  timerId = setInterval(() => {
    timeLeft -= 1;
    timerEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      endMatch();
    }
  }, 1000);
};

const startMatch = () => {
  inMatch = true;
  score = 0;
  timeLeft = 60;
  scoreEl.textContent = '0';
  timerEl.textContent = timeLeft;
  multEl.textContent = 'x1.0';
  selected = null;
  generateBoard();
  renderBoard();
  setScreen('match');
  startTimer();
};

const endMatch = () => {
  if (!inMatch) return;
  inMatch = false;
  clearInterval(timerId);
  finalScoreEl.textContent = Math.round(score);
  setScreen('end');
};

const backToLobby = () => {
  inMatch = false;
  clearInterval(timerId);
  setScreen('lobby');
  endScreen.classList.remove('active');
};

playBtn.addEventListener('click', () => {
  endScreen.classList.remove('active');
  startMatch();
});

playAgainBtn.addEventListener('click', () => {
  startMatch();
  endScreen.classList.remove('active');
});

toLobbyBtn.addEventListener('click', backToLobby);
restartBtn.addEventListener('click', startMatch);
backToLobbyBtn.addEventListener('click', backToLobby);

const boot = () => {
  initTelegram();
  setScreen('lobby');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
