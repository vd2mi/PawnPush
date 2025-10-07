import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBz6YA8veeDSY-naBqYdafJbcnfsnDi3EY",
  authDomain: "pawnpush-leaderboard.firebaseapp.com",
  projectId: "pawnpush-leaderboard",
  storageBucket: "pawnpush-leaderboard.appspot.com",
  messagingSenderId: "948510714839",
  appId: "1:948510714839:web:4e31534f1b4f305fa57992",
  measurementId: "G-F0QKLGBD7P"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function playSound(soundName) {
  if (window.audioManager) {
    window.audioManager.playSound(soundName);
  }
}

function showToast(message, type = 'info', duration = 2000) {
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

let currentRoom = null;
let playerRole = null;
let playerName = null;
let roomListener = null;
let chess = new Chess();
let board = null;
let currentPuzzle = null;
let currentPuzzleIndex = 0;
let solutionIndex = 0;
let myScore = 0;
let opponentScore = 0;
let gameTimer = null;
let timeRemaining = 120; 
let puzzleDatabase = null;

const roomSetupScreen = document.getElementById('room-setup-screen');
const waitingRoomScreen = document.getElementById('waiting-room-screen');
const gameScreen = document.getElementById('game-screen');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const cancelRoomBtn = document.getElementById('cancel-room-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const hostNameInput = document.getElementById('host-name-input');
const guestNameInput = document.getElementById('guest-name-input');
const roomCodeInput = document.getElementById('room-code-input');

async function loadPuzzleDatabase() {
  if (!puzzleDatabase) {
    const response = await fetch('puzzles.json');
    puzzleDatabase = await response.json();
  }
  return puzzleDatabase;
}

async function getRandomPuzzles(count = 20) {
  const db = await loadPuzzleDatabase();
  
  const filtered = db.filter(puzzle => {
    const rating = parseInt(puzzle.Rating);
    return rating >= 1000 && rating <= 1500;
  });
  
  const shuffled = filtered.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);
  
  return selected.map(puzzle => {
    return {
      id: db.indexOf(puzzle),
      fen: puzzle.FEN,
      solution: puzzle.Moves.split(' '),
      rating: puzzle.Rating,
      themes: puzzle.Themes,
      evalScore: puzzle.EvalScore
    };
  });
}

createRoomBtn.addEventListener('click', async () => {
  const name = hostNameInput.value.trim();
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }
  
  if (name.length > 15) {
    showToast('Name must be 15 characters or less', 'error');
    return;
  }
  
  try {
    const roomCode = generateRoomCode();
    const puzzles = await getRandomPuzzles(20);
    
    const roomData = {
      roomCode: roomCode,
      puzzles: puzzles,
      startTime: null,
      duration: 120,
      status: 'waiting',
      players: {
        host: {
          name: name,
          score: 0,
          currentIndex: 0
        },
        guest: null
      },
      createdAt: new Date().toISOString()
    };
    
    await setDoc(doc(db, 'rooms', roomCode), roomData);
    
    currentRoom = roomCode;
    playerRole = 'host';
    playerName = name;
    
    showToast('Room created successfully!', 'success');
    showWaitingRoom(roomCode, name);
    listenToRoom(roomCode);
    
  } catch (error) {
    console.error('Error creating room:', error);
    showToast('Failed to create room. Please try again.', 'error');
  }
});

joinRoomBtn.addEventListener('click', async () => {
  const name = guestNameInput.value.trim();
  const code = roomCodeInput.value.trim();
  
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }
  
  if (name.length > 15) {
    showToast('Name must be 15 characters or less', 'error');
    return;
  }
  
  if (!code || code.length !== 6) {
    showToast('Please enter a valid 6-digit room code', 'error');
    return;
  }
  
  try {
    const roomRef = doc(db, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists()) {
      showToast('Room not found. Please check the code.', 'error');
      return;
    }
    
    const roomData = roomSnap.data();
    
    if (roomData.status !== 'waiting') {
      showToast('Room is not available', 'error');
      return;
    }
    
    if (roomData.players.guest) {
      showToast('Room is full', 'error');
      return;
    }
    
    await updateDoc(roomRef, {
      'players.guest': {
        name: name,
        score: 0,
        currentIndex: 0
      }
    });
    
    currentRoom = code;
    playerRole = 'guest';
    playerName = name;
    
    showToast('Joined room successfully!', 'success');
    listenToRoom(code);
    
  } catch (error) {
    console.error('Error joining room:', error);
    showToast('Failed to join room. Please try again.', 'error');
  }
});

cancelRoomBtn.addEventListener('click', async () => {
  if (currentRoom) {
    try {
      if (playerRole === 'host') {
        await deleteDoc(doc(db, 'rooms', currentRoom));
        showToast('Room closed', 'info');
      } else {
        await updateDoc(doc(db, 'rooms', currentRoom), {
          'players.guest': null
        });
        showToast('Left room', 'info');
      }
      
      if (roomListener) {
        roomListener();
        roomListener = null;
      }
      
      resetToSetup();
    } catch (error) {
      console.error('Error canceling room:', error);
      showToast('Error leaving room', 'error');
    }
  }
});

copyCodeBtn.addEventListener('click', () => {
  if (currentRoom) {
    navigator.clipboard.writeText(currentRoom);
    showToast('Room code copied!', 'success');
    playSound('move');
  }
});

function listenToRoom(roomCode) {
  const roomRef = doc(db, 'rooms', roomCode);
  
  roomListener = onSnapshot(roomRef, (doc) => {
    if (!doc.exists()) {
      showToast('Room has been closed', 'error');
      resetToSetup();
      return;
    }
    
    const data = doc.data();
    
    if (data.status === 'waiting') {
      updateWaitingRoom(data);
      
      if (data.players.host && data.players.guest && !data.startTime) {
        startCountdown(roomCode);
      }
    }
    
    if (data.status === 'inProgress' && gameScreen.classList.contains('hidden')) {
      startGame(data);
    }
    
    if (data.status === 'inProgress') {
      updateScores(data);
    }
    
    if (data.status === 'finished') {
      showResults(data);
    }
  });
}

function showWaitingRoom(roomCode, hostName) {
  roomSetupScreen.classList.add('hidden');
  waitingRoomScreen.classList.remove('hidden');
  
  document.getElementById('display-room-code').textContent = roomCode;
  document.getElementById('host-player-name').textContent = hostName;
}

function updateWaitingRoom(data) {
  const guewaitingstNameEl = document.getElementById('guest-player-name');
  const guestStatusEl = document.getElementById('guest-status');
  
  if (data.players.guest) {
    guestNameEl.textContent = data.players.guest.name;
    guestStatusEl.textContent = '✓ Ready';
    guestStatusEl.classList.remove('waiting');
    guestStatusEl.classList.add('ready');
  } else {
    guestNameEl.textContent = 'Waiting...';
    guestStatusEl.textContent = '⏳ Waiting';
    guestStatusEl.classList.remove('ready');
    guestStatusEl.classList.add('waiting');
  }
}

async function startCountdown(roomCode) {
  playSound('move');
  
  for (let i = 3; i > 0; i--) {
    await Swal.fire({
      title: i.toString(),
      text: 'Get ready!',
      icon: 'info',
      timer: 1000,
      showConfirmButton: false,
      allowOutsideClick: false
    });
  }
  
  await Swal.fire({
    title: 'GO!',
    text: 'Battle starts now!',
    icon: 'success',
    timer: 1000,
    showConfirmButton: false,
    allowOutsideClick: false
  });
  
  playSound('solved');
  
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'inProgress',
      startTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error starting game:', error);
  }
}

function startGame(roomData) {
  waitingRoomScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  
  const opponentName = playerRole === 'host' ? roomData.players.guest.name : roomData.players.host.name;
  document.getElementById('your-name-label').textContent = playerName;
  document.getElementById('opponent-name-label').textContent = opponentName;
  
  myScore = roomData.players[playerRole].score;
  opponentScore = playerRole === 'host' ? roomData.players.guest.score : roomData.players.host.score;
  document.getElementById('your-score').textContent = myScore;
  document.getElementById('opponent-score').textContent = opponentScore;
  
  timeRemaining = roomData.duration;
  startGameTimer(roomData.startTime, roomData.duration);
  
  currentPuzzleIndex = 0;
  loadPuzzle(roomData.puzzles[currentPuzzleIndex]);
}

function startGameTimer(startTime, duration) {
  const startTimestamp = new Date(startTime).getTime();
  const endTimestamp = startTimestamp + (duration * 1000);
  
  gameTimer = setInterval(() => {
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((endTimestamp - now) / 1000));
    
    timeRemaining = remaining;
    
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    document.getElementById('timer-display').textContent = 
      `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    if (remaining <= 0) {
      clearInterval(gameTimer);
      endGame();
    }
  }, 100);
}

async function endGame() {
  if (gameTimer) {
    clearInterval(gameTimer);
  }
  
  try {
    await updateDoc(doc(db, 'rooms', currentRoom), {
      status: 'finished'
    });
  } catch (error) {
    console.error('Error ending game:', error);
  }
}

function updateScores(data) {
  myScore = data.players[playerRole].score;
  opponentScore = playerRole === 'host' ? data.players.guest.score : data.players.host.score;
  
  document.getElementById('your-score').textContent = myScore;
  document.getElementById('opponent-score').textContent = opponentScore;
}

function initBoard() {
  if (board) return;
  
  const boardEl = document.getElementById('board');
  boardEl.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  boardEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  
  board = Chessboard("board", {
    position: chess.fen(),
    draggable: true,
    pieceTheme: function(piece) {
      return 'https://assets-themes.chess.com/image/ejgfv/150/' + piece.toLowerCase() + '.png';
    },
    onDragStart: function(source, piece, position, orientation){
      if (chess.turn() !== piece.charAt(0)) return false;
      if (chess.moves({square:source}).length === 0) return false;
    },
    onDrop: function(source, target){
      const move = chess.move({ from:source, to:target, promotion:"q" });
      if (!move) return 'snapback';
      
      const correctMove = currentPuzzle.solution[solutionIndex];
      const userMove = move.from + move.to + (move.promotion || '');
      
      if (correctMove && userMove === correctMove){
        handleCorrectMove(move, userMove);
      } else {
        handleWrongMove(move, userMove);
        return 'snapback';
      }
    }
  });
}

function handleCorrectMove(move, userMove) {
  if (chess.in_check()) {
    playSound('check');
  } else if (move.flags.includes('k') || move.flags.includes('q')) {
    playSound('castle');
  } else if (move.captured) {
    playSound('capture');
  } else {
    playSound('move');
  }
  
  addMoveToHistory(userMove, true);
  solutionIndex++;
  board.position(chess.fen(), false);
  
  if (solutionIndex < currentPuzzle.solution.length){
    setTimeout(() => {
      const opponentMove = currentPuzzle.solution[solutionIndex];
      const from = opponentMove.substring(0, 2);
      const to = opponentMove.substring(2, 4);
      const promotion = opponentMove.length > 4 ? opponentMove.substring(4) : undefined;
      const autoMove = chess.move({ from, to, promotion: promotion || 'q' });
      
      if (autoMove) {
        if (chess.in_check()) {
          playSound('check');
        } else if (autoMove.flags.includes('k') || autoMove.flags.includes('q')) {
          playSound('castle');
        } else if (autoMove.captured) {
          playSound('capture');
        } else {
          playSound('move');
        }
        addMoveToHistory(opponentMove, true);
        solutionIndex++;
        board.position(chess.fen(), true);
        
        if (solutionIndex >= currentPuzzle.solution.length){
          setTimeout(() => {
            puzzleSolved();
          }, 800);
        }
      }
    }, 350);
  } else {
    setTimeout(() => {
      puzzleSolved();
    }, 800);
  }
}

function handleWrongMove(move, userMove) {
  playSound('wrong');
  addMoveToHistory(userMove, false);
  chess.undo();
  board.position(chess.fen(), false);
  showToast('Wrong move! Try again.', 'error', 2000);
}

async function puzzleSolved() {
  playSound('solved');
  showToast('Puzzle solved! 🎉', 'success');
  
  myScore++;
  document.getElementById('your-score').textContent = myScore;
  
  try {
    await updateDoc(doc(db, 'rooms', currentRoom), {
      [`players.${playerRole}.score`]: myScore,
      [`players.${playerRole}.currentIndex`]: currentPuzzleIndex + 1
    });
  } catch (error) {
    console.error('Error updating score:', error);
  }
  
  setTimeout(async () => {
    const roomRef = doc(db, 'rooms', currentRoom);
    const roomSnap = await getDoc(roomRef);
    const roomData = roomSnap.data();
    
    currentPuzzleIndex++;
    if (currentPuzzleIndex < roomData.puzzles.length) {
      loadPuzzle(roomData.puzzles[currentPuzzleIndex]);
    } else {
      showToast('All puzzles completed!', 'info');
    }
  }, 1500);
}

function loadPuzzle(puzzleData) {
  currentPuzzle = puzzleData;
  chess = new Chess();
  
  try { 
    chess.load(puzzleData.fen);
  } catch(e){ 
    console.error('Failed to load FEN:', e);
    showToast('Failed to load puzzle', 'error');
    return;
  }
  
  solutionIndex = 0;
  initBoard();
  
  const evalScore = puzzleData.evalScore;
  let winningSide = 'white';
  if (evalScore !== undefined && evalScore !== null) {
    winningSide = evalScore > 0 ? 'white' : 'black';
  }
  
  const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
  
  if (sideToMove !== winningSide) {
    const firstMove = puzzleData.solution[0];
    const from = firstMove.substring(0, 2);
    const to = firstMove.substring(2, 4);
    const promotion = firstMove.length > 4 ? firstMove.substring(4) : undefined;
    const move = chess.move({ from, to, promotion: promotion || 'q' });
    
    if (move) {
      solutionIndex++;
    }
  }
  
  board.orientation(winningSide);
  board.position(chess.fen(), true);
  updatePuzzleInfo(puzzleData);
}

function updatePuzzleInfo(puzzle) {
  const fenParts = chess.fen().split(' ');
  const turn = fenParts[1] === 'w' ? 'White' : 'Black';
  
  document.getElementById('turn-value').textContent = `${turn} to move`;
  document.getElementById('rating-value').textContent = puzzle.rating;
  document.getElementById('move-history').innerHTML = '<em class="no-moves">No moves yet</em>';
}

function addMoveToHistory(move, isCorrect) {
  const moveHistory = document.getElementById('move-history');
  
  if (moveHistory.innerHTML.includes('No moves yet')) {
    moveHistory.innerHTML = '';
  }
  
  const moveDiv = document.createElement('div');
  moveDiv.className = `move-item ${isCorrect ? 'correct' : 'incorrect'}`;
  moveDiv.textContent = `${move} ${isCorrect ? '✓' : '✗'}`;
  moveHistory.appendChild(moveDiv);
}

async function showResults(data) {
  if (gameTimer) {
    clearInterval(gameTimer);
  }
  
  const myFinalScore = data.players[playerRole].score;
  const opponentFinalScore = playerRole === 'host' ? data.players.guest.score : data.players.host.score;
  const opponentName = playerRole === 'host' ? data.players.guest.name : data.players.host.name;
  
  let resultTitle = '';
  let resultIcon = '';
  
  if (myFinalScore > opponentFinalScore) {
    resultTitle = '🏆 Victory!';
    resultIcon = 'success';
    playSound('solved');
  } else if (myFinalScore < opponentFinalScore) {
    resultTitle = '😔 Defeat';
    resultIcon = 'error';
  } else {
    resultTitle = '🤝 Draw!';
    resultIcon = 'info';
  }
  
  const result = await Swal.fire({
    title: resultTitle,
    html: `
      <div style="text-align: left; padding: 20px;">
        <div style="background: rgba(0,0,0,0.1); padding: 15px; border-radius: 10px; margin-bottom: 15px;">
          <h3 style="margin: 0 0 15px 0; text-align: center;">Final Score</h3>
          <div style="display: flex; justify-content: space-around; align-items: center; font-size: 1.5em;">
            <div style="text-align: center;">
              <div style="font-weight: bold; color: #3498db;">${playerName}</div>
              <div style="font-size: 2em; margin: 10px 0;">${myFinalScore}</div>
            </div>
            <div style="font-size: 1.2em; color: #95a5a6;">VS</div>
            <div style="text-align: center;">
              <div style="font-weight: bold; color: #e74c3c;">${opponentName}</div>
              <div style="font-size: 2em; margin: 10px 0;">${opponentFinalScore}</div>
            </div>
          </div>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #7f8c8d;">
          ${myFinalScore > opponentFinalScore ? 'Well played! You solved more puzzles!' : 
            myFinalScore < opponentFinalScore ? 'Good effort! Keep practicing!' : 
            'Great match! You both solved the same number of puzzles!'}
        </div>
      </div>
    `,
    icon: resultIcon,
    confirmButtonText: '🏠 Back to Menu',
    confirmButtonColor: '#3498db',
    allowOutsideClick: false
  });
  
  if (result.isConfirmed) {
    if (playerRole === 'host') {
      try {
        await deleteDoc(doc(db, 'rooms', currentRoom));
      } catch (error) {
        console.error('Error deleting room:', error);
      }
    }
    
    window.location.href = 'index.html';
  }
}

function resetToSetup() {
  currentRoom = null;
  playerRole = null;
  playerName = null;
  myScore = 0;
  opponentScore = 0;
  currentPuzzleIndex = 0;
  
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }
  
  roomSetupScreen.classList.remove('hidden');
  waitingRoomScreen.classList.add('hidden');
  gameScreen.classList.add('hidden');
  
  hostNameInput.value = '';
  guestNameInput.value = '';
  roomCodeInput.value = '';
}

window.addEventListener('beforeunload', async () => {
  if (currentRoom && playerRole === 'guest') {
    try {
      await updateDoc(doc(db, 'rooms', currentRoom), {
        'players.guest': null
      });
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  }
});

