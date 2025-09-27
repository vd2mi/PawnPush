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

  async function getDailyPuzzle() {
    try {
      const dailyPuzzleJson = sessionStorage.getItem('dailyPuzzle');
      if (!dailyPuzzleJson) {
        throw new Error('No daily puzzle data found');
      }
      
      const dailyData = JSON.parse(dailyPuzzleJson);
      
      // Extract the position from the PGN using initialPly
      const pgn = dailyData.game.pgn;
      const initialPly = dailyData.puzzle.initialPly;
      
      // Create a temporary chess instance to get the position
      const tempChess = new Chess();
      const moves = pgn.split(' ').filter(move => move && !move.includes('.') && !move.includes('[') && !move.includes(']'));
      
      // Play moves up to initialPly (the puzzle starts after this many moves)
      for (let i = 0; i < initialPly; i++) {
        if (moves[i]) {
          tempChess.move(moves[i]);
        }
      }
      
      // The puzzle position is one move after initialPly
      // We need to play one more move to get to the actual puzzle position
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


  function initBoardIfNeeded(){
    if (board) return
    board = Chessboard("board", {
      position: chess.fen(),
      draggable: true,
      pieceTheme:'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
      onDragStart: function(source, piece, position, orientation) {
        if (chess.turn() !== piece.charAt(0)) return false
        if (chess.moves({square:source}).length === 0) return false
      },
      onDrop: function(source, target){
        const move = chess.move({ from:source, to:target, promotion:"q" })
        if (!move) return 'snapback'

        const correctMove = (currentPuzzle && currentPuzzle.puzzle && currentPuzzle.puzzle.solution)
          ? currentPuzzle.puzzle.solution[solutionIndex] : null
        const userMove = move.from + move.to + (move.promotion || '')

        if (correctMove && userMove === correctMove){
          clearHints();
          addMoveToHistory(userMove, true);
          solutionIndex++
          board.position(chess.fen())
          showToast('Correct move!', 'success')
          if (solutionIndex >= currentPuzzle.puzzle.solution.length){
            setTimeout(() => {
              showToast('Daily puzzle solved! 🎉', 'success')
            }, 800)
          }
        } else {
          addMoveToHistory(userMove, false);
          chess.undo()
          board.position(chess.fen())
          showToast('Try again', 'error')
          return 'snapback'
        }
      },
      onSnapEnd: function(){ board.position(chess.fen()) }
    })
    board.greySquare = function(square) {
      const squareEl = document.querySelector(`.square-${square}`);
      if (squareEl) {
        squareEl.style.backgroundColor = 'rgba(48, 74, 160, 0.6)';
      }
    };
    board.removeGreySquares = function() {
      document.querySelectorAll('[class*="square-"]').forEach(el => {
        el.style.backgroundColor = '';
      });
    }; 
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
  
    initBoardIfNeeded()
    board.position(chess.fen())
    updatePuzzleInfo(data.puzzle, chess.fen());
  
    console.log('Daily puzzle loaded:', data.puzzle)
    console.log('Puzzle rating:', data.puzzle.rating)
    console.log('Solution moves:', data.puzzle.solution)
    console.log('Starting position (FEN):', chess.fen())
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
