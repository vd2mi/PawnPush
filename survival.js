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

function animateHeartLoss() {
  const livesEl = document.getElementById('lives-value');
  if (livesEl) {
    livesEl.style.animation = 'heartShake 0.5s ease-in-out';
    livesEl.style.filter = 'drop-shadow(0 0 8px rgba(255, 0, 0, 0.8))';
    
    setTimeout(() => {
      livesEl.style.animation = 'heartFlash 0.3s ease';
    }, 200);
    
    setTimeout(() => {
      livesEl.style.animation = '';
      livesEl.style.filter = '';
    }, 600);
  }
}

if (!document.getElementById('heart-animations')) {
  const style = document.createElement('style');
  style.id = 'heart-animations';
  style.textContent = `
    @keyframes heartShake {
      0%, 100% { transform: translateX(0) scale(1); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-3px) scale(1.15); }
      20%, 40%, 60%, 80% { transform: translateX(3px) scale(1.15); }
    }
    
    @keyframes heartFlash {
      0%, 100% { 
        filter: drop-shadow(0 0 8px rgba(255, 0, 0, 0.8)) brightness(1);
      }
      50% { 
        filter: drop-shadow(0 0 15px rgba(255, 0, 0, 1)) brightness(1.5);
      }
    }
    
    @keyframes heartBreak {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3) rotate(-5deg); opacity: 0.7; }
      100% { transform: scale(0.9) rotate(0deg); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

function updatePuzzleInfo(puzzle, fen, score, lives, targetElo, streak) {
  const fenParts = fen.split(' ');
  const turn = fenParts[1] === 'w' ? 'White' : 'Black';
  
  const turnIndicator = document.querySelector('#turn-indicator .info-value');
  if (turnIndicator) {
    turnIndicator.textContent = `${turn} to move`;
  }
  
  document.getElementById('score-value').textContent = score;
  
  const streakEl = document.getElementById('streak-value');
  if (streakEl) {
    streakEl.textContent = `${streak} 🔥`;
  }
  
  const livesEl = document.getElementById('lives-value');
  const redHearts = '❤️'.repeat(lives);
  const grayHearts = '🖤'.repeat(3 - lives);
  livesEl.textContent = redHearts + grayHearts;
  
  document.getElementById('rating-value').textContent = targetElo;
  
  const themes = puzzle.themes.split(' ').slice(0, 3);
  const themeText = themes.map(theme => 
    theme.charAt(0).toUpperCase() + theme.slice(1)
  ).join(' • ');
  
  const themeElement = document.getElementById('puzzle-theme');
  themeElement.innerHTML = `<div class="theme-icon">♾️</div><div class="theme-text">${themeText}</div>`;
  
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

document.addEventListener("DOMContentLoaded", async () => {
  let puzzleDatabase = null;
  let chess = new Chess();
  let board = null;
  let currentPuzzle = null;
  let solutionIndex = 0;
  let score = 0;
  let lives = 3;
  let gameOver = false;
  let currentElo = 800;
  const eloIncrement = () => Math.floor(Math.random() * 26) + 25; 
  

  let startTime = Date.now();
  let totalMoves = 0;
  let correctMoves = 0;
  let incorrectMoves = 0;
  let currentStreak = 0;
  let bestStreak = 0;

  async function loadPuzzleDatabase() {
    if (!puzzleDatabase) {
      const response = await fetch('puzzles.json');
      puzzleDatabase = await response.json();
    }
    return puzzleDatabase;
  }

  const boardEl = document.getElementById('board');
  boardEl.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  boardEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  async function getRandomPuzzleFromDatabase() {
    const db = await loadPuzzleDatabase();
    
    const eloRange = 100;
    const filtered = db.filter(puzzle => {
      const puzzleRating = parseInt(puzzle.Rating);
      return puzzleRating >= (currentElo - eloRange) && puzzleRating <= (currentElo + eloRange);
    });
    
    const puzzlesToChooseFrom = filtered.length > 0 ? filtered : db.filter(puzzle => {
      const puzzleRating = parseInt(puzzle.Rating);
      return puzzleRating >= (currentElo - 200) && puzzleRating <= (currentElo + 200);
    });
    
    const finalPool = puzzlesToChooseFrom.length > 0 ? puzzlesToChooseFrom : db;
    
    const randomPuzzle = finalPool[Math.floor(Math.random() * finalPool.length)];
    
    console.log(`Current ELO: ${currentElo}, Selected puzzle rating: ${randomPuzzle.Rating}, Pool size: ${finalPool.length}`);
    
    return {
      puzzle: {
        fen: randomPuzzle.FEN,
        solution: randomPuzzle.Moves.split(' '),
        rating: randomPuzzle.Rating,
        themes: randomPuzzle.Themes,
        evalScore: randomPuzzle.EvalScore
      }
    };
  }

  function initBoardIfNeeded(){
    if (board) return;
    
    board = Chessboard("board", {
      position: chess.fen(),
      draggable: true,
      pieceTheme: function(piece) {
        return 'https://assets-themes.chess.com/image/ejgfv/150/' + piece.toLowerCase() + '.png';
      },
      onDragStart: function(source, piece, position, orientation){
        if (gameOver) return false;
        if (chess.turn() !== piece.charAt(0)) return false;
        if (chess.moves({square:source}).length === 0) return false;
      },
      onDrop: function(source, target){
        if (gameOver) return 'snapback';
        
        const move = chess.move({ from:source, to:target, promotion:"q" });
        if (!move) return 'snapback';
        
        const correctMove = (currentPuzzle && currentPuzzle.puzzle && currentPuzzle.puzzle.solution)
          ? currentPuzzle.puzzle.solution[solutionIndex] : null;
        const userMove = move.from + move.to + (move.promotion || '');
        
        if (correctMove && userMove === correctMove){
          addMoveToHistory(userMove, true);
          totalMoves++;
          correctMoves++;
          solutionIndex++;
          board.position(chess.fen(), false);
          showToast('Correct move!', 'success');
          
          if (solutionIndex < currentPuzzle.puzzle.solution.length){
            setTimeout(() => {
              const opponentMove = currentPuzzle.puzzle.solution[solutionIndex];
              const from = opponentMove.substring(0, 2);
              const to = opponentMove.substring(2, 4);
              const promotion = opponentMove.length > 4 ? opponentMove.substring(4) : undefined;
              const autoMove = chess.move({ from, to, promotion: promotion || 'q' });
              
              if (autoMove) {
                addMoveToHistory(opponentMove, true);
                solutionIndex++;
                board.position(chess.fen(), true);
                
                if (solutionIndex >= currentPuzzle.puzzle.solution.length){
                  setTimeout(() => {
                    score++;
                    currentStreak++;
                    if (currentStreak > bestStreak) {
                      bestStreak = currentStreak;
                      if (currentStreak >= 3) {
                        showToast(`🔥 ${currentStreak} puzzle streak! 🔥`, 'success', 3500);
                      }
                    }
                    const increment = eloIncrement();
                    currentElo += increment;
                    if (currentStreak < 3) {
                      showToast(`Puzzle solved! +${increment} ELO → ${currentElo}`, 'success');
                    }
                    loadPuzzle();
                  }, 800);
                }
              }
            }, 350);
          } else {
            setTimeout(() => {
              score++;
              currentStreak++;
              if (currentStreak > bestStreak) {
                bestStreak = currentStreak;
                if (currentStreak >= 3) {
                  showToast(`🔥 ${currentStreak} puzzle streak! 🔥`, 'success', 3500);
                }
              }
              const increment = eloIncrement();
              currentElo += increment;
              if (currentStreak < 3) {
                showToast(`Puzzle solved! +${increment} ELO → ${currentElo}`, 'success');
              }
              loadPuzzle();
            }, 800);
          }
        } else {
          addMoveToHistory(userMove, false);
          totalMoves++;
          incorrectMoves++;
          currentStreak = 0;
          chess.undo();
          board.position(chess.fen(), false);
          lives--;
          
          animateHeartLoss();
          
          if (lives <= 0) {
            gameOver = true;
            showToast(`Game Over! Final Score: ${score}`, 'error', 3000);
            setTimeout(() => {
              showGameOverScreen();
            }, 500);
          } else {
            showToast(`Wrong move! Lives remaining: ${lives}`, 'error', 3000);
            updatePuzzleInfo(currentPuzzle.puzzle, chess.fen(), score, lives, currentElo, currentStreak);
          }
          
          return 'snapback';
        }
      }
    });
    
  }

  async function loadPuzzle(){
    if (gameOver) return;
    
    let data = await getRandomPuzzleFromDatabase();
    
    if (!data){ 
      showToast('Failed to load puzzle. Please try again.', 'error');
      return;
    }
    
    currentPuzzle = data;
    chess = new Chess();
    
    if (!data.puzzle.solution || data.puzzle.solution.length === 0) {
      console.error('No valid solution found for puzzle');
      showToast('Puzzle error. Trying another puzzle...', 'error');
      setTimeout(() => loadPuzzle(), 1000);
      return;
    }
    
    try { 
      chess.load(data.puzzle.fen);
    } catch(e){ 
      console.error('Failed to load FEN:', e);
      showToast('Failed to load puzzle. Please try again.', 'error');
      return;
    }
    
    solutionIndex = 0;
    initBoardIfNeeded();
    
    const evalScore = data.puzzle.evalScore;
    let winningSide = 'white';
    if (evalScore !== undefined && evalScore !== null) {
      winningSide = evalScore > 0 ? 'white' : 'black';
    }
    
    const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
    
    if (sideToMove !== winningSide) {
      const firstMove = data.puzzle.solution[0];
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
    updatePuzzleInfo(data.puzzle, chess.fen(), score, lives, currentElo, currentStreak);
  }
  
  function getHighScore() {
    const saved = localStorage.getItem('survivalHighScore');
    return saved ? JSON.parse(saved) : { score: 0, elo: 800, streak: 0 };
  }

  function saveHighScore(newScore, newElo, newStreak) {
    const current = getHighScore();
    if (newElo > current.elo || (newElo === current.elo && newScore > current.score)) {
      localStorage.setItem('survivalHighScore', JSON.stringify({
        score: newScore,
        elo: newElo,
        streak: Math.max(newStreak, current.streak),
        date: new Date().toLocaleDateString()
      }));
      return true;
    }
    return false;
  }

  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  function showGameOverScreen() {
    const endTime = Date.now();
    const timePlayed = endTime - startTime;
    const accuracy = totalMoves > 0 ? Math.round((correctMoves / totalMoves) * 100) : 0;
    const highScore = getHighScore();
    const isNewRecord = saveHighScore(score, currentElo, bestStreak);

    const template = document.getElementById('game-over-template');
    const clone = template.content.cloneNode(true);
    
    const title = clone.getElementById('go-title');
    title.textContent = isNewRecord ? '🎉 NEW RECORD! 🎉' : 'Game Over!';
    
    clone.getElementById('go-score').innerHTML = `<strong>${score}</strong>`;
    clone.getElementById('go-elo').innerHTML = `<strong>${currentElo}</strong>`;
    clone.getElementById('go-elo-gained').innerHTML = `<strong>+${currentElo - 800}</strong>`;
    clone.getElementById('go-time').textContent = formatTime(timePlayed);
    
    const accuracyEl = clone.getElementById('go-accuracy');
    const accuracyColor = accuracy >= 80 ? '#27ae60' : accuracy >= 60 ? '#f39c12' : '#e74c3c';
    accuracyEl.style.color = accuracyColor;
    accuracyEl.innerHTML = `<strong>${accuracy}%</strong>`;
    
    clone.getElementById('go-moves').textContent = `${totalMoves} (${correctMoves} ✓ / ${incorrectMoves} ✗)`;
    clone.getElementById('go-streak').innerHTML = `<strong>${bestStreak} 🔥</strong>`;
    
    const bestEloEl = clone.getElementById('go-best-elo');
    bestEloEl.innerHTML = `<strong>${highScore.elo}</strong> ${currentElo === highScore.elo ? '(matched!)' : ''}`;
    clone.getElementById('go-best-score').textContent = `${highScore.score} puzzles`;
    clone.getElementById('go-best-streak').textContent = `${highScore.streak} 🔥`;
    clone.getElementById('go-best-date').textContent = highScore.date || 'Today';
    
    const container = document.createElement('div');
    container.appendChild(clone);

    Swal.fire({
      title: '',
      html: container.innerHTML,
      width: '600px',
      confirmButtonText: '🎮 Play Again',
      confirmButtonColor: '#27ae60',
      showCancelButton: true,
      cancelButtonText: '🏠 Back to Menu',
      cancelButtonColor: '#95a5a6',
      allowOutsideClick: false,
      customClass: {
        popup: 'game-over-popup'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        resetGame();
      } else {
        window.location.href = 'index.html';
      }
    });
  }

  function resetGame() {
    score = 0;
    lives = 3;
    gameOver = false;
    currentElo = 800;
    startTime = Date.now();
    totalMoves = 0;
    correctMoves = 0;
    incorrectMoves = 0;
    currentStreak = 0;
    bestStreak = 0;
    loadPuzzle();
  }

  const restartBtn = document.getElementById('restartBtn');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      Swal.fire({
        title: 'Restart Game?',
        text: 'Your current progress will be lost.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, restart',
        cancelButtonText: 'Cancel'
      }).then((result) => {
        if (result.isConfirmed) {
          resetGame();
        }
      });
    });
  }

  const coachBtn = document.getElementById('coachBtn');
  const chatPopup = document.getElementById('chatPopup');
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');

  let isOpen = false;

  function toggleChat() {
    isOpen = !isOpen;
    if (isOpen) {
      chatPopup.classList.add('show');
    } else {
      chatPopup.classList.remove('show');
    }
  }

  coachBtn.addEventListener('click', toggleChat);

  chatSend.addEventListener('click', async () => {
    const question = chatInput.value.trim();
    if (!question) return;

    const userMsg = document.createElement('div');
    userMsg.classList.add('user');
    userMsg.innerHTML = `<strong>You:</strong> ${question}`;
    chatMessages.appendChild(userMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    chatInput.value = "";

    const aiMsg = document.createElement('div');
    aiMsg.classList.add('ai');
    aiMsg.innerHTML = `<strong>Coach:</strong> Coach is thinking...`;
    chatMessages.appendChild(aiMsg);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      const fen = chess.fen();
      const res = await fetch(`/api/getHint?fen=${fen}&userMove=&stockfishMove=&question=${encodeURIComponent(question)}&solutionMove=${currentPuzzle.puzzle.solution[solutionIndex]}&puzzleType=${currentPuzzle.puzzle.themes}`);
      const data = await res.json();
      aiMsg.innerHTML = `<strong>Coach:</strong> ${data.hint}`;
    } catch (e) {
      aiMsg.innerHTML = `<strong>Coach:</strong> Error getting hint`;
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') chatSend.click();
  });

  await loadPuzzle();
});

