function playSound(soundName) {
  if (window.audioManager) {
    window.audioManager.playSound(soundName);
  }
}

function showToast(message, type = 'info') {
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
  }, 2000);
}

function updatePuzzleInfo(puzzle, fen) {
  const fenParts = fen.split(' ');
  const turn = fenParts[1] === 'w' ? 'White' : 'Black';
  
  document.getElementById('turn-indicator').textContent = `${turn} to move`;
  document.getElementById('turn-indicator').className = turn.toLowerCase() + '-turn';
  
  document.getElementById('puzzle-rating').textContent = `Rating: ${puzzle.rating}`;
  
  const themes = puzzle.themes.split(' ').slice(0, 3);
  const themeText = themes.map(theme => 
    theme.charAt(0).toUpperCase() + theme.slice(1)
  ).join(' • ');
  
  document.getElementById('puzzle-theme').innerHTML = `<span class="daily-indicator">📅 Daily Puzzle</span> • ${themeText}`;
  
  document.getElementById('move-history').innerHTML = '<em>No moves yet</em>';
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
  let chess = new Chess();
  let board = null;
  let currentPuzzle = null;
  let solutionIndex = 0;
  let hintLevel = 0;
  let puzzleSolved = false;
  let suppressRightDrag = false;
  let selectedSquare = null;

  async function fetchDailyPuzzle() {
    try {
      const response = await fetch('https://lichess.org/api/puzzle/daily');
      if (!response.ok) {
        throw new Error('Failed to fetch daily puzzle');
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching daily puzzle:', error);
      return null;
    }
  }

  async function getDailyPuzzle() {
    try {
      let dailyData = null;
      
      const dailyPuzzleJson = sessionStorage.getItem('dailyPuzzle');
      if (dailyPuzzleJson) {
        dailyData = JSON.parse(dailyPuzzleJson);
      } else {
        dailyData = await fetchDailyPuzzle();
        if (!dailyData) {
          throw new Error('Failed to fetch daily puzzle from API');
        }
      }
      

      const pgn = dailyData.game.pgn;
      const initialPly = dailyData.puzzle.initialPly;
      

      const tempChess = new Chess();
      const moves = pgn.split(' ').filter(move => move && !move.includes('.') && !move.includes('[') && !move.includes(']'));
      

      for (let i = 0; i < initialPly; i++) {
        if (moves[i]) {
          tempChess.move(moves[i]);
        }
      }

      if (moves[initialPly]) {
        tempChess.move(moves[initialPly]);
      }
      
      return {
        puzzle: {
          fen: tempChess.fen(),
          solution: dailyData.puzzle.solution,
          rating: dailyData.puzzle.rating,
          themes: dailyData.puzzle.themes.join(' '),
          isDaily: true
        }
      };
    } catch (error) {
      console.error('Error loading daily puzzle:', error);
      return null;
    }
  }

  const boardEl = document.getElementById('board');
  boardEl.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  boardEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  boardEl.addEventListener('pointerdown', (e) => { suppressRightDrag = (e.button === 2); });
  boardEl.addEventListener('pointerup', () => { suppressRightDrag = false; });


  function initBoardIfNeeded(){
    if (board) return
    board = Chessboard("board", {
      position: chess.fen(),
      draggable: true,
      pieceTheme: function(piece) {
        return 'https://assets-themes.chess.com/image/ejgfv/150/' + piece.toLowerCase() + '.png';
      },
      onDragStart: function(source, piece, position, orientation, event) {
        if (suppressRightDrag) return false; 
        if (puzzleSolved) return false
        if (chess.turn() !== piece.charAt(0)) return false
      },
      onDrop: function(source, target){
        if (puzzleSolved) return 'snapback'
        const move = chess.move({ from:source, to:target, promotion:"q" })
        if (!move) return 'snapback'

        const correctMove = (currentPuzzle && currentPuzzle.puzzle && currentPuzzle.puzzle.solution)
          ? currentPuzzle.puzzle.solution[solutionIndex] : null
        const userMove = move.from + move.to + (move.promotion || '')

        if (correctMove && userMove === correctMove){
          if (chess.in_check()) {
            playSound('check');
          } else if (move.flags.includes('k') || move.flags.includes('q')) {
            playSound('castle');
          } else if (move.captured) {
            playSound('capture');
          } else {
            playSound('move');
          }
          clearHints();
          addMoveToHistory(userMove, true);
          solutionIndex++
          board.position(chess.fen(), false)
          showToast('Correct move!', 'success')
          if (solutionIndex >= currentPuzzle.puzzle.solution.length){
            puzzleSolved = true
            setTimeout(() => {
              playSound('solved');
              showToast('Daily puzzle solved! 🎉', 'success')
            }, 800)
          }
        } else {
          playSound('wrong');
          addMoveToHistory(userMove, false);
          chess.undo()
          board.position(chess.fen(), false)
          showToast('Try again', 'error')
          return 'snapback'
        }
      }
    })
    board.greySquare = function(square) {
      const squareEl = document.querySelector(`.square-${square}`);
      if (squareEl) {
        squareEl.style.backgroundColor = 'rgba(255, 251, 41, 0.85)';
      }
    };
    board.removeGreySquares = function() {
      document.querySelectorAll('[class*="square-"]').forEach(el => {
        el.style.backgroundColor = '';
      });
    };

    const boardElement = document.getElementById('board');
    boardElement.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      const target = e.target.closest('[class*="square-"]');
      if (target) {
        target.classList.toggle('square-red-mark');
      }
    });

    boardElement.addEventListener('click', function(e) {
      if (puzzleSolved) return;
      
      let target = e.target;
      if (target.tagName === 'IMG') {
        target = target.parentElement;
      }
      target = target.closest('[class*="square-"]');
      
      if (!target) return;
      const cls = Array.from(target.classList).find(c => c.startsWith('square-'));
      if (!cls) return;
      const square = cls.split('-')[1];
      
      document.querySelectorAll('.square-selected').forEach(el => {
        el.classList.remove('square-selected');
      });
      
      if (!selectedSquare) {
        const piece = chess.get(square);
        if (!piece || piece.color !== chess.turn()) return;
        selectedSquare = square;
        target.classList.add('square-selected');
      } else {
        if (square === selectedSquare) {
          selectedSquare = null;
          return;
        }
        const move = chess.move({ from:selectedSquare, to:square, promotion:'q' });
        if (!move) {
          return;
        }
        const correctMove = (currentPuzzle && currentPuzzle.puzzle && currentPuzzle.puzzle.solution)
          ? currentPuzzle.puzzle.solution[solutionIndex] : null
        const userMove = move.from + move.to + (move.promotion || '')
        if (correctMove && userMove === correctMove){
          if (chess.in_check()) {
            playSound('check');
          } else if (move.flags.includes('k') || move.flags.includes('q')) {
            playSound('castle');
          } else if (move.captured) {
            playSound('capture');
          } else {
            playSound('move');
          }
          clearHints();
          addMoveToHistory(userMove, true);
          solutionIndex++
          board.position(chess.fen(), false)
          showToast('Correct move!', 'success')
          if (solutionIndex >= currentPuzzle.puzzle.solution.length){
            puzzleSolved = true
            setTimeout(() => {
              playSound('solved');
              showToast('Daily puzzle solved! 🎉', 'success')
            }, 800)
          }
        } else {
          playSound('wrong');
          addMoveToHistory(userMove, false);
          chess.undo()
          board.position(chess.fen(), false)
          showToast('Try again', 'error')
        }
        selectedSquare = null;
      }
    });
  }

  async function loadPuzzle(){
    clearHints();
    let data = await getDailyPuzzle()
  
    if (!data){ 
      showToast('Failed to load daily puzzle. Please try again.', 'error')
      return
    }
  
    currentPuzzle = data
    chess = new Chess()
  
    if (!data.puzzle.solution || data.puzzle.solution.length === 0) {
      console.error('No valid solution found for puzzle');
      showToast('Puzzle error. Please try again.', 'error');
      return;
    }
    
    try { 
      chess.load(data.puzzle.fen)
    } catch(e){ 
      console.error('Failed to load FEN:', e)
      showToast('Failed to load puzzle. Please try again.', 'error')
      return
    }
  
    solutionIndex = 0
    puzzleSolved = false
  
    initBoardIfNeeded()
    board.position(chess.fen(), false)
    updatePuzzleInfo(data.puzzle, chess.fen());
  
  }
  
  function showHint() {
    if (!currentPuzzle || !currentPuzzle.puzzle.solution) return;
    
    const nextMove = currentPuzzle.puzzle.solution[solutionIndex];
    if (!nextMove) return;
    
    const fromSquare = nextMove.substring(0, 2);
    const toSquare = nextMove.substring(2, 4);
    
    if (hintLevel === 0) {
      board.removeGreySquares();
      board.greySquare(fromSquare);
      showToast(`Look at this square`, 'info');
      hintLevel = 1;
    } else if (hintLevel === 1) {
      board.greySquare(toSquare);
      showToast(`Move here`, 'info');  
      hintLevel = 2;
    } else {
      showToast(`Solution: ${fromSquare} to ${toSquare}`, 'info');
      board.removeGreySquares();
      hintLevel = 0;
    }
  }
  
  function clearHints() {
    if (board) { 
      board.removeGreySquares();
    }
    hintLevel = 0;
  }


  const hintBtn = document.getElementById('hintBtn');
  if (hintBtn) {
    hintBtn.addEventListener('click', showHint);
  }

  const backToMenuBtn = document.getElementById('backToMenuBtn');
  if (backToMenuBtn) { 
    backToMenuBtn.addEventListener('click', () => { 
      window.location.href = 'index.html';
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
      
      const res = await fetch('/api/getHint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           fen,
           userQuestion: question,
           solutionMoves: [currentPuzzle.puzzle.solution[solutionIndex]],
           puzzleType: currentPuzzle.puzzle.themes,
           clientAnalysis: analysis
        })
      });

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
