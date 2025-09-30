function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2000);
}

function addMoveToHistory(move, isCorrect) {
  const moveHistory = document.getElementById('move-history');
  if (moveHistory.innerHTML.includes('No moves yet')) moveHistory.innerHTML = '';
  const moveDiv = document.createElement('div');
  moveDiv.className = `move-item ${isCorrect ? 'correct' : 'incorrect'}`;
  moveDiv.textContent = `${move} ${isCorrect ? '✓' : '✗'}`;
  moveHistory.appendChild(moveDiv);
}

function updatePuzzleInfo(puzzle, fen) {
  const turn = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  document.querySelector('#turn-indicator .info-value').textContent = `${turn} to move`;
  document.getElementById('rating-value').textContent = puzzle.rating ?? '--';
  document.getElementById('move-history').innerHTML = '<em class="no-moves">No moves yet</em>';
}

document.addEventListener('DOMContentLoaded', async () => {
  let chess = new Chess();
  let board = null;
  let puzzleDatabase = null;
  let currentPuzzle = null;
  let solutionIndex = 0;
  let hintLevel = 0;
  let lives = 3;
  let score = 0;
  let currentTargetRating = 700; // starting band
  let isLoading = false;
  let loadingAttempts = 0;
  const MAX_LOADING_ATTEMPTS = 5; // Reduced - skip problematic puzzles faster
  let loadingDotInterval = null;

  const livesEl = document.getElementById('lives-value');
  const scoreEl = document.getElementById('score-value');

  function renderLives() {
    livesEl.textContent = '❤️'.repeat(lives) + '🖤'.repeat(Math.max(0, 3 - lives));
  }
  function renderScore() {
    scoreEl.textContent = String(score);
  }
  function showLoading(message = 'Loading puzzle...'){
    isLoading = true;
    const existing = document.getElementById('loading-overlay');
    if (!existing){
      const overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.background = 'rgba(0,0,0,0.35)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '9999';
      overlay.style.backdropFilter = 'blur(1px)';
      overlay.innerHTML = `<div id="loading-text" style="background:#111;color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-weight:600;">${message}</div>`;
      document.body.appendChild(overlay);
    } else {
      existing.querySelector('#loading-text').textContent = message;
    }
    
    // Animate loading dots
    if (loadingDotInterval) clearInterval(loadingDotInterval);
    let dotCount = 0;
    loadingDotInterval = setInterval(() => {
      const loadingText = document.getElementById('loading-text');
      const themeEl = document.querySelector('#puzzle-theme .theme-text');
      const baseMessage = message.replace(/\.+$/, ''); // Remove existing dots
      const dots = '.'.repeat((dotCount % 3) + 1);
      
      if (loadingText) {
        loadingText.textContent = baseMessage + dots;
      }
      if (themeEl) {
        themeEl.textContent = 'Loading puzzle' + dots;
      }
      dotCount++;
    }, 400);
    
    const themeEl = document.querySelector('#puzzle-theme .theme-text');
    if (themeEl) themeEl.textContent = 'Loading puzzle';
  }
  function hideLoading(){
    isLoading = false;
    if (loadingDotInterval) {
      clearInterval(loadingDotInterval);
      loadingDotInterval = null;
    }
    const existing = document.getElementById('loading-overlay');
    if (existing) existing.remove();
  }
  function simpleMaterialEval(chessInstance){
    // Returns centipawns: positive favors White, negative favors Black
    const values = { p:100, n:320, b:330, r:500, q:900, k:0 };
    let score = 0;
    const grid = chessInstance.board();
    for (let r = 0; r < 8; r++){
      for (let c = 0; c < 8; c++){
        const piece = grid[r][c];
        if (!piece) continue;
        const val = values[piece.type] || 0;
        score += piece.color === 'w' ? val : -val;
      }
    }
    return score;
  }
  
  function cleanFenForAnalysis(fen) {
    // Remove en passant square to avoid Chess API validation errors
    // Chess-API.com has strict FEN validation and rejects en passant squares
    const parts = fen.split(' ');
    if (parts.length >= 4 && parts[3] !== '-') {
      console.log(`Survival: Cleaning FEN, removing en passant square "${parts[3]}" for API compatibility`);
      parts[3] = '-'; // Set en passant to none
    }
    return parts.join(' ');
  }
  function resetRun() {
    lives = 3; score = 0; currentTargetRating = 700; renderLives(); renderScore(); loadNextPuzzle();
  }

  async function loadPuzzleDatabase() {
    if (!puzzleDatabase) {
      const response = await fetch('puzzles.json');
      puzzleDatabase = await response.json();
    }
    return puzzleDatabase;
  }

  function pickNextRatingTarget() {
    // Increase target by 50-100 each solved puzzle
    const inc = 50 + Math.floor(Math.random() * 51); // 50..100
    currentTargetRating = Math.min(3500, currentTargetRating + inc);
  }

  async function getPuzzleByRatingBand() {
    const db = await loadPuzzleDatabase();
    const low = Math.max(300, currentTargetRating - 75);
    const high = Math.min(3500, currentTargetRating + 75);
    let pool = db.filter(p => typeof p.Rating === 'number' && p.Rating >= low && p.Rating <= high);
    if (pool.length === 0) {
      // widen if sparse
      pool = db.filter(p => typeof p.Rating === 'number' && p.Rating >= low - 150 && p.Rating <= high + 150);
    }
    // prefer short tactical motifs first then ramp complexity naturally via rating
    const chosen = pool[Math.floor(Math.random() * pool.length)] || db[Math.floor(Math.random() * db.length)];
    return {
      puzzle: {
        fen: chosen.FEN,
        solution: chosen.Moves.split(' '),
        rating: chosen.Rating,
        themes: chosen.Themes
      }
    };
  }

  function initBoardIfNeeded(){
    if (board) return;
    board = Chessboard('board', {
      position: chess.fen(),
      draggable: true,
      pieceTheme: function(piece){ return 'https://assets-themes.chess.com/image/ejgfv/150/' + piece.toLowerCase() + '.png'; },
      onDragStart: function(source, piece){
        if (isLoading) return false;
        if (chess.turn() !== piece.charAt(0)) return false;
        if (chess.moves({ square: source }).length === 0) return false;
      },
      onDrop: function(source, target){
        if (isLoading) return 'snapback';
        const move = chess.move({ from: source, to: target, promotion: 'q' });
        if (!move) return 'snapback';
        const correctMove = currentPuzzle?.puzzle?.solution?.[solutionIndex];
        const userMove = move.from + move.to + (move.promotion || '');
        if (correctMove && userMove === correctMove) {
          clearHints();
          addMoveToHistory(userMove, true);
          solutionIndex++;
          board.position(chess.fen(), false);
          showToast('Correct!', 'success');
          if (solutionIndex >= currentPuzzle.puzzle.solution.length) {
            score += 1;
            renderScore();
            pickNextRatingTarget();
            setTimeout(() => { showToast('Next puzzle →', 'success'); loadNextPuzzle(); }, 600);
          } else {
            // Auto-play opponent reply if present in solution
            setTimeout(() => autoplayOpponentReply(), 350);
          }
        } else {
          addMoveToHistory(userMove, false);
          chess.undo();
          board.position(chess.fen(), false);
          lives -= 1; renderLives();
          if (lives <= 0) {
            gameOver();
            return 'snapback';
          }
          showToast('Incorrect. Try again.', 'error');
          return 'snapback';
        }
      }
    });
    board.greySquare = function(square){ const el = document.querySelector(`.square-${square}`); if (el) el.style.backgroundColor = 'rgba(48, 74, 160, 0.6)'; };
    board.removeGreySquares = function(){ document.querySelectorAll('[class*="square-"]').forEach(el => { el.style.backgroundColor = ''; }); };
  }

  function autoplayOpponentReply(){
    if (!currentPuzzle || !currentPuzzle.puzzle || !currentPuzzle.puzzle.solution) return;
    if (solutionIndex >= currentPuzzle.puzzle.solution.length) return;
    const reply = currentPuzzle.puzzle.solution[solutionIndex];
    if (!reply) return;
    const from = reply.substring(0,2);
    const to = reply.substring(2,4);
    const promo = reply.substring(4) || undefined;
    const mv = chess.move({ from, to, promotion: promo || 'q' });
    if (!mv) return; // if invalid, skip to avoid soft lock
    solutionIndex++;
    addMoveToHistory(from + to + (promo || ''), true);
    board.position(chess.fen(), true);
    // Update turn indicator after opponent's reply
    updatePuzzleInfo(currentPuzzle.puzzle, chess.fen());
    // If that completed the line, advance; else it's user's turn for next move
    if (solutionIndex >= currentPuzzle.puzzle.solution.length) {
      score += 1; renderScore(); pickNextRatingTarget();
      setTimeout(() => { showToast('Next puzzle →', 'success'); loadNextPuzzle(); }, 600);
    }
  }
  function autoplayFirstSolutionMove(){
    if (!currentPuzzle || !currentPuzzle.puzzle || !currentPuzzle.puzzle.solution) return;
    if (solutionIndex >= currentPuzzle.puzzle.solution.length) return;
    const mvUci = currentPuzzle.puzzle.solution[solutionIndex];
    if (!mvUci) return;
    const from = mvUci.substring(0,2);
    const to = mvUci.substring(2,4);
    const promo = mvUci.substring(4) || undefined;
    const mv = chess.move({ from, to, promotion: promo || 'q' });
    if (!mv) return;
    solutionIndex++;
    addMoveToHistory(from + to + (promo || ''), true);
    board.position(chess.fen(), true);
    // Show what was auto-played and update "TURN"
    showToast(`Auto move: ${mv.san || (from + to)}`, 'info');
    updatePuzzleInfo(currentPuzzle.puzzle, chess.fen());
  }

  async function loadNextPuzzle(){
    hintLevel = 0;
    if (!isLoading) showLoading('Loading puzzle'); // Dots added automatically
    loadingAttempts = 0;
    const data = await getPuzzleByRatingBand();
    if (!data || !data.puzzle.solution || data.puzzle.solution.length === 0) { return loadNextPuzzle(); }
    currentPuzzle = data;
    chess = new Chess();
    try { chess.load(data.puzzle.fen); } catch (e) { return loadNextPuzzle(); }
    solutionIndex = 0;
    initBoardIfNeeded();
    // Simulate to final position along solution, evaluate that, and choose player's side
    const startFen = chess.fen();
    const attemptEval = async () => {
      try {
        const { finalFen, evalScore } = await evaluateFinalPosition(startFen, data.puzzle.solution);
        const playerOrientation = evalScore > 0 ? 'white' : evalScore < 0 ? 'black' : (chess.turn() === 'w' ? 'white' : 'black');
        console.log('Survival orientation decision', {
          startFen,
          finalFen,
          evalScore,
          chosenPlayer: playerOrientation,
          sideToMoveAtStart: chess.turn(),
          firstSolutionMove: data.puzzle.solution[0]
        });
        board.orientation(playerOrientation);
        board.position(chess.fen(), true);
        updatePuzzleInfo(data.puzzle, chess.fen());
        document.querySelector('#puzzle-theme .theme-text').textContent = `Survival • Target ~${currentTargetRating}`;
        const sideToMoveColor = chess.turn() === 'w' ? 'white' : 'black';
        if (playerOrientation !== sideToMoveColor) {
          console.log('Turn mismatch. Auto-playing first solution move so chosen side moves next.');
          autoplayFirstSolutionMove();
        }
        hideLoading();
      } catch (error) {
        loadingAttempts += 1;
        console.warn('Evaluate failed, attempt', loadingAttempts, error);
        if (loadingAttempts < MAX_LOADING_ATTEMPTS) {
          showLoading(`Loading puzzle`); // Animated dots will be added automatically
          setTimeout(attemptEval, 500);
        } else {
          // After max attempts, skip to next puzzle
          console.warn('Max loading attempts reached, skipping puzzle...');
          hideLoading();
          setTimeout(() => {
            loadNextPuzzle();
          }, 100);
        }
      }
    };
    await attemptEval();
  }

  async function evaluatePosition(chessInstance){
    const fen = chessInstance.fen();
    // Clean FEN to remove en passant for API compatibility
    const cleanedFen = cleanFenForAnalysis(fen);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // Reduced from 5000ms for faster response 
    
    try {
      const response = await fetch('https://chess-api.com/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fen: cleanedFen,
          depth: 12,
          variants: 3,
          maxThinkingTime: 3000,
          move: ''
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
    
      if (!response.ok) {
        throw new Error(`Stockfish API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Only use fallback for daily limit (HIGH_USAGE), throw for other errors
      if (data && data.type === 'error') {
        if (data.error === 'HIGH_USAGE') {
          console.warn('Stockfish API daily limit reached; using material fallback');
          return simpleMaterialEval(chessInstance);
        }
        // For all other API errors, throw to trigger retry or skip
        throw new Error(`Stockfish API error: ${data.error || data.text || 'Unknown error'}`);
      }
      
      if (data.eval === undefined) {
        throw new Error('Stockfish API returned invalid response - missing eval field');
      }
      
      return Math.round(data.eval);
    } catch (error) {
      clearTimeout(timeoutId);
      // Re-throw all errors (including timeouts) to trigger retry or skip logic
      throw error;
    }
  }

  async function evaluateFinalPosition(startFen, solutionMoves){
    const sim = new Chess();
    sim.load(startFen);
    
    for (const uci of solutionMoves) {
      const from = uci.substring(0,2);
      const to = uci.substring(2,4);
      const promo = uci.substring(4) || 'q';
      const mv = sim.move({ from, to, promotion: promo });
      if (!mv) {
        throw new Error(`Invalid move in solution: ${uci}`);
      }
    }
    
    const finalFen = sim.fen();
    const evalScore = await evaluatePosition(sim);
    return { finalFen, evalScore };
  }

  function showHint(){
    if (!currentPuzzle || !currentPuzzle.puzzle || !currentPuzzle.puzzle.solution) return;
    const nextMove = currentPuzzle.puzzle.solution[solutionIndex];
    if (!nextMove) return;
    const fromSquare = nextMove.substring(0,2);
    const toSquare = nextMove.substring(2,4);
    if (hintLevel === 0) {
      board.removeGreySquares();
      board.greySquare(fromSquare);
      showToast('Consider this square', 'info');
      hintLevel = 1;
    } else if (hintLevel === 1) {
      board.greySquare(toSquare);
      showToast('Try moving here', 'info');
      hintLevel = 2;
    } else {
      showToast(`Solution: ${fromSquare} → ${toSquare}`, 'info');
      board.removeGreySquares();
      hintLevel = 0;
    }
  }
  function clearHints(){ if (board) board.removeGreySquares(); hintLevel = 0; }

  function gameOver(){
    Swal.fire({
      title: 'Game Over',
      html: `Score: <strong>${score}</strong><br/>Reached target ~${currentTargetRating}`,
      icon: 'info',
      confirmButtonText: 'Restart',
      showCancelButton: true,
      cancelButtonText: 'Back to Menu'
    }).then(res => {
      if (res.isConfirmed) { resetRun(); }
      else { window.location.href = 'index.html'; }
    });
  }

  const hintBtn = document.getElementById('hintBtn');
  if (hintBtn) hintBtn.addEventListener('click', showHint);
  const restartBtn = document.getElementById('restartBtn');
  if (restartBtn) restartBtn.addEventListener('click', resetRun);

  // Coach chat wiring (reuse minimal from other pages)
  const coachBtn = document.getElementById('coachBtn');
  const chatPopup = document.getElementById('chatPopup');
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSend = document.getElementById('chatSend');
  let isOpen = false;
  function toggleChat(){ isOpen = !isOpen; if (isOpen) chatPopup.classList.add('show'); else chatPopup.classList.remove('show'); }
  if (coachBtn) coachBtn.addEventListener('click', toggleChat);
  if (chatSend) chatSend.addEventListener('click', async () => {
    const question = chatInput.value.trim(); if (!question) return;
    const userMsg = document.createElement('div'); userMsg.classList.add('user'); userMsg.innerHTML = `<strong>You:</strong> ${question}`; chatMessages.appendChild(userMsg); chatMessages.scrollTop = chatMessages.scrollHeight; chatInput.value = '';
    const aiMsg = document.createElement('div'); aiMsg.classList.add('ai'); aiMsg.innerHTML = `<strong>Coach:</strong> Coach is thinking...`; chatMessages.appendChild(aiMsg); chatMessages.scrollTop = chatMessages.scrollHeight;
    try {
      const fen = chess.fen();
      const res = await fetch(`/api/getHint?fen=${fen}&userMove=&stockfishMove=&question=${encodeURIComponent(question)}&solutionMove=${currentPuzzle.puzzle.solution[solutionIndex]}&puzzleType=${currentPuzzle.puzzle.themes}`);
      const data = await res.json(); aiMsg.innerHTML = `<strong>Coach:</strong> ${data.hint}`;
    } catch(e){ aiMsg.innerHTML = `<strong>Coach:</strong> Error getting hint`; }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });
  if (chatInput) chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') chatSend.click(); });

  // Kick off
  renderLives(); renderScore(); await loadNextPuzzle();
});


