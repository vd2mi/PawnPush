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
  

  const themes = puzzle.themes.split(' ').slice(0, 3); // First 3 themes
  const themeText = themes.map(theme => 
    theme.charAt(0).toUpperCase() + theme.slice(1)
  ).join(' • ');
  document.getElementById('puzzle-theme').textContent = themeText;
  

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
document.addEventListener("DOMContentLoaded", async ()=>{
  let puzzleDatabase = null;

async function loadPuzzleDatabase() {
  if (!puzzleDatabase) {
    const response = await fetch('puzzles.json');
    puzzleDatabase = await response.json();
  }
  return puzzleDatabase;
}

async function getRandomPuzzleFromDatabase() {
  const db = await loadPuzzleDatabase();
  
  

  const urlParams = new URLSearchParams(window.location.search);
  const difficulty = urlParams.get('difficulty') || 'beginner';
  const position = urlParams.get('position') || 'middlegame';
  
  
  const filtered = db.filter(puzzle => 
    puzzle.Difficulty === difficulty && puzzle.Position === position
  );
  console.log('Looking for:', difficulty, position);
  console.log('Found puzzles:', filtered.length);
  console.log('First few puzzles:', filtered.slice(0, 3));
  
  if (filtered.length === 0) {
    
    const randomPuzzle = db[Math.floor(Math.random() * db.length)];
    return { puzzle: randomPuzzle };
  }
  
  
  const randomPuzzle = filtered[Math.floor(Math.random() * filtered.length)];
  
  return {
    puzzle: {
      fen: randomPuzzle.FEN,
      solution: randomPuzzle.Moves.split(' '),
      rating: randomPuzzle.Rating,
      themes: randomPuzzle.Themes
    }
  };
}
  let chess = new Chess();
  let board = null;
  let currentPuzzle = null;
  let solutionIndex = 0;

  function initBoardIfNeeded(){
    if (board) return
    board = Chessboard("board", {
      position: chess.fen(),
      draggable:true ,
      pieceTheme:'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
      onDragStart: function(source, piece, position, orientation)
      {
        if (chess.turn()!== piece.charAt(0)) return false
        if (chess.moves({square:source}).length===0) return false
      },
      onDrop: function(source,target){
        const move = chess.move({ from:source, to:target, promotion:"q" })
        if (!move) return 'snapback'

        const correctMove = (currentPuzzle && currentPuzzle.puzzle && currentPuzzle.puzzle.solution)
          ? currentPuzzle.puzzle.solution[solutionIndex] : null
        const userMove = move.from + move.to + (move.promotion || '')

        if (correctMove && userMove===correctMove){
          clearHints();
          addMoveToHistory(userMove, true);
          solutionIndex++
          board.position(chess.fen())
          showToast('Correct move!', 'success')
          if (solutionIndex >= currentPuzzle.puzzle.solution.length){
            setTimeout(() => {
              showToast('Puzzle solved! Loading next...', 'success')
              loadPuzzle()
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
      onSnapEnd:function(){ board.position(chess.fen()) }
    })
    board.greySquare = function(square) {
      const squareEl = document.querySelector(`.square-${square}`);
      if (squareEl) {
        squareEl.style.backgroundColor = 'rgba(48, 74, 160, 0.6)';
      }};
    board.removeGreySquares = function() {
      document.querySelectorAll('[class*="square-"]').forEach(el => {
        el.style.backgroundColor = '';
      });
    }; 
  }

  async function loadPuzzle(){
    clearHints();
    let data = await getRandomPuzzleFromDatabase()
    if (!data) {
      data = await fetchPuzzle()
    }
  
    if (!data){ 
      showToast('Failed to load puzzle. Please try again.', 'error')
      return
    }
  
    currentPuzzle = data
    chess = new Chess()
  
    
    if (!data.puzzle.solution || data.puzzle.solution.length === 0) {
      console.error('No valid solution found for puzzle');
      showToast('Puzzle error. Trying another puzzle...', 'error');
      setTimeout(() => loadPuzzle(), 1000);
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
  
    console.log('Full puzzle object:', data.puzzle)
    console.log('Puzzle rating:',  data.puzzle.rating )
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

const nextBtn = document.getElementById('nextPuzzleBtn');
if (nextBtn) { 
  nextBtn.addEventListener('click', () => { loadPuzzle() });
}

const toggleButtonElement2 = document.getElementById('coachBtn'); 
const popupElement = document.getElementById('chatPopup');
toggleButtonElement2.addEventListener('click', () => { 
  popupElement.classList.toggle('hidden');
});

await loadPuzzle();
})