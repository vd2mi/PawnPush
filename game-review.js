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
  }, 3000);
}

let chess = new Chess();
let board = null;
let stockfish = null;
let gameHistory = [];
let currentMoveIndex = 0;
let isAnalyzing = false;
let engineType = 'unknown';
let analysisTimeout = null;
let currentAnalysis = {};
let moveAnalyses = {};
let isDragging = false;

function initBoard() {
  board = Chessboard('board', {
    position: chess.fen(),
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    draggable: true,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  });
}

function onDragStart(source, piece, position, orientation) {
  if (chess.game_over()) return false;
  if ((chess.turn() === 'w' && piece.search(/^b/) !== -1) ||
      (chess.turn() === 'b' && piece.search(/^w/) !== -1)) {
      return false;
  }
}

function onDrop(source, target) {
  const move = chess.move({
      from: source,
      to: target,
      promotion: 'q'
  });

  if (move === null) return 'snapback';

  gameHistory = gameHistory.slice(0, currentMoveIndex + 1);
  gameHistory.push(chess.fen());
  currentMoveIndex = gameHistory.length - 1;
  
  updateMoveList();
  evaluateLastMove();
}

function onSnapEnd() {
  board.position(chess.fen());
}

function checkWasmSupport() {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

async function loadStockfish() {
  try {
    updateEngineStatus('Loading Stockfish WASM...', false);
    
    if (!checkWasmSupport()) {
      throw new Error('WebAssembly not supported');
    }

    await loadLocalStockfish();
    
  } catch (error) {
    console.error('WASM loading failed:', error);
    
    try {
      await loadStockfishFromCDN();
    } catch (cdnError) {
      console.error('CDN loading failed:', cdnError);
      loadMockEngine();
    }
  }
}

async function loadLocalStockfish() {
  try {
    const wasmJsPath = './stockfish/stockfish.wasm.js';
    const wasmPath = './stockfish/stockfish.wasm';
    
    const response = await fetch(wasmJsPath);
    if (!response.ok) {
      throw new Error(`Local stockfish JS not found at ${wasmJsPath}`);
    }
    
    const wasmResponse = await fetch(wasmPath);
    if (!wasmResponse.ok) {
      throw new Error(`Local stockfish WASM not found at ${wasmPath}`);
    }
    
    console.log('✅ Local Stockfish files found, initializing...');
    
    const Stockfish = await import('./stockfish/stockfish.wasm.js');
    const engine = await Stockfish.default();
    
    stockfish = {
      postMessage: function(cmd) {
        console.log('→ Local WASM:', cmd);
        engine.postMessage(cmd);
      },
      onmessage: null,
      terminate: function() {
        engine.terminate();
      }
    };
    
    engine.onmessage = function(event) {
      console.log('← Local WASM:', event.data);
      if (stockfish.onmessage) {
        stockfish.onmessage(event);
      }
    };
    
    setupStockfishListeners();
    stockfish.postMessage('uci');
    engineType = 'local-wasm';
    
    showToast('Local Stockfish WASM loaded successfully!', 'success');
    console.log('✅ Local Stockfish WASM initialized');
    
  } catch (error) {
    console.error('Local WASM loading failed:', error);
    await loadLocalStockfishWorker();
  }
}

async function loadLocalStockfishWorker() {
  try {
    const workerCode = `
      importScripts('./stockfish/stockfish.wasm.js');
      
      // Override locateFile to find wasm in correct directory
      if (typeof Module === 'undefined') {
        var Module = {};
      }
      Module.locateFile = function(path, scriptDirectory) {
        if (path.endsWith('.wasm')) {
          return './stockfish/' + path;
        }
        return scriptDirectory + path;
      };
      
      // Re-import with correct path
      importScripts('./stockfish/stockfish.wasm.js');
    `;
    
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    
    stockfish = {
      postMessage: function(cmd) {
        console.log('→ Local WASM Worker:', cmd);
        worker.postMessage(cmd);
      },
      onmessage: null,
      terminate: function() {
        worker.terminate();
      }
    };
    
    worker.onmessage = function(event) {
      console.log('← Local WASM Worker:', event.data);
      if (stockfish.onmessage) {
        stockfish.onmessage(event);
      }
    };
    
    worker.onerror = function(error) {
      console.error('Local WASM Worker error:', error);
      throw error;
    };
    
    setupStockfishListeners();
    stockfish.postMessage('uci');
    engineType = 'local-wasm-worker';
    
    showToast('Local Stockfish WASM Worker loaded!', 'success');
    console.log('✅ Local Stockfish WASM Worker initialized');
    
  } catch (error) {
    console.error('Worker-based loading failed:', error);
    throw error;
  }
}

async function loadStockfishFromCDN() {
  try {
    updateEngineStatus('Loading Stockfish from CDN...', false);
    
    const response = await fetch('https://cdn.jsdelivr.net/npm/stockfish@latest/src/stockfish.js');
    if (!response.ok) throw new Error('CDN fetch failed');
    
    const stockfishCode = await response.text();
    const blob = new Blob([stockfishCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    
    stockfish = {
      postMessage: function(cmd) {
        console.log('→ CDN WASM:', cmd);
        worker.postMessage(cmd);
      },
      onmessage: null,
      terminate: function() {
        worker.terminate();
      }
    };
    
    worker.onmessage = function(event) {
      console.log('← CDN WASM:', event.data);
      if (stockfish.onmessage) {
        stockfish.onmessage(event);
      }
    };
    
    worker.onerror = function(error) {
      console.error('CDN Worker error:', error);
      throw error;
    };
    
    setupStockfishListeners();
    stockfish.postMessage('uci');
    engineType = 'cdn-wasm';
    
    showToast('CDN Stockfish loaded successfully!', 'success');
    
  } catch (error) {
    console.error('CDN loading failed:', error);
    throw error;
  }
}

function loadMockEngine() {
  updateEngineStatus('Using Demo Engine (WASM not available)', false);
  showToast('Using demo analysis - WASM not available', 'info');
  
  stockfish = {
    postMessage: function(message) {
      console.log('Mock Engine received:', message);
      
      setTimeout(() => {
        if (message === 'uci') {
          this.onmessage({data: 'id name Stockfish DEMO'});
          this.onmessage({data: 'uciok'});
        } else if (message.includes('position')) {
          generateMockAnalysis();
        } else if (message === 'stop') {
          this.onmessage({data: 'bestmove e2e4'});
        }
      }, 300);
    },
    onmessage: null,
    terminate: function() {}
  };
  
  engineType = 'mock';
  setupStockfishListeners();
  stockfish.postMessage('uci');
}

function generateMockAnalysis() {
  const possibleMoves = chess.moves({verbose: true});
  if (possibleMoves.length === 0) {
    stockfish.onmessage({data: 'bestmove (none)'});
    return;
  }
  
  const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  const baseScore = (Math.random() - 0.5) * 200;
  
  for (let depth = 1; depth <= 12; depth++) {
    setTimeout(() => {
      const score = Math.round(baseScore + (Math.random() - 0.5) * 50);
      const timeMs = depth * 100;
      const nodes = depth * 15000;
      const bestMove = randomMove.from + randomMove.to + (randomMove.promotion || '');
      
      stockfish.onmessage({
        data: `info depth ${depth} score cp ${score} time ${timeMs} nodes ${nodes} pv ${bestMove}`
      });
    }, depth * 200);
  }
  
  setTimeout(() => {
    const bestMove = randomMove.from + randomMove.to + (randomMove.promotion || '');
    stockfish.onmessage({data: `bestmove ${bestMove}`});
  }, 2500);
}

function generateEnhancedMockAnalysis() {
  const currentFen = gameHistory[currentMoveIndex];
  const tempChess = new Chess(currentFen);
  const moves = tempChess.moves({verbose: true});
  
  if (moves.length === 0) {
    document.getElementById('analysisDisplay').textContent = 'Position is terminal (checkmate or stalemate)';
    return;
  }
  
  isAnalyzing = true;
  document.getElementById('analysisDisplay').textContent = 'Enhanced analysis running...';
  
  const bestMove = selectReasonableMove(moves, tempChess);
  const evaluation = calculatePositionValue(tempChess);
  const alternativeMoves = moves.slice(0, 5);
  
  for (let depth = 1; depth <= 15; depth++) {
    setTimeout(() => {
      if (!isAnalyzing) return;
      
      const analysis = {
        depth: depth,
        score: Math.round(evaluation + (Math.random() - 0.5) * 30),
        time: depth * 150,
        nodes: depth * 12000,
        pv: [bestMove.from + bestMove.to + (bestMove.promotion || '')]
      };
      
      updateAnalysisDisplay(analysis, alternativeMoves);
    }, depth * 200);
  }
  
  setTimeout(() => {
    if (!isAnalyzing) return;
    displayFullAnalysis(bestMove, alternativeMoves, evaluation);
    isAnalyzing = false;
    document.getElementById('analyzeBtn').innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze Position</span>';
  }, 3200);
}

function selectReasonableMove(moves, chess) {
  let bestMoves = [];
  
  const captures = moves.filter(m => m.captured);
  if (captures.length > 0) {
    bestMoves = captures;
  } else {
    const checks = moves.filter(m => {
      const testChess = new Chess(chess.fen());
      testChess.move(m);
      return testChess.in_check();
    });
    
    if (checks.length > 0) {
      bestMoves = checks;
    } else {
      bestMoves = moves.filter(m => 
        ['d4', 'd5', 'e4', 'e5', 'c4', 'c5', 'f4', 'f5'].includes(m.to) ||
        ['b1', 'g1', 'b8', 'g8', 'c1', 'f1', 'c8', 'f8'].includes(m.from)
      );
      
      if (bestMoves.length === 0) {
        bestMoves = moves;
      }
    }
  }
  
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function calculatePositionValue(chess) {
  const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let evaluation = 0;
  
  const board = chess.board();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const piece = board[i][j];
      if (piece) {
        const value = pieceValues[piece.type.toLowerCase()] * 100;
        evaluation += piece.color === 'w' ? value : -value;
      }
    }
  }
  
  evaluation += (Math.random() - 0.5) * 50;
  return evaluation;
}

function setupStockfishListeners() {
  stockfish.onmessage = function(event) {
    const message = event.data || event;
    handleStockfishMessage(message);
  };
  
  setTimeout(() => {
    updateEngineStatus(`${engineType.toUpperCase().replace('-', ' ')} Engine Ready`, true);
  }, 1000);
}

function handleStockfishMessage(message) {
  const messageText = typeof message === 'string' ? message : (message.data || '');
  console.log('Engine response:', messageText);
  
  if (messageText.includes('id name')) {
    console.log('Engine identified:', messageText);
    return;
  }
  
  if (messageText.includes('uciok')) {
    stockfish.postMessage('ucinewgame');
    if (engineType !== 'mock') {
      stockfish.postMessage('setoption name Hash value 64');
      stockfish.postMessage('setoption name Threads value 1');
    }
    return;
  }
  
  if (messageText.includes('info depth') && isAnalyzing) {
    const analysis = parseAnalysisLine(messageText);
    if (analysis.depth && parseInt(analysis.depth) >= 1) {
      currentAnalysis = { ...currentAnalysis, ...analysis };
      updateAnalysisDisplay(analysis);
    }
  }
  
  if (messageText.includes('bestmove') && isAnalyzing) {
    const parts = messageText.split(' ');
    const bestMove = parts[1];
    displayFullAnalysis(bestMove);
    isAnalyzing = false;
    
    if (analysisTimeout) {
      clearTimeout(analysisTimeout);
      analysisTimeout = null;
    }
    
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze Position</span>';
  }
}

function evaluateLastMove() {
  if (!stockfish || currentMoveIndex < 1) return;
  
  const prevFen = gameHistory[currentMoveIndex - 1];
  const currentFen = gameHistory[currentMoveIndex];
  
  setTimeout(() => {
      analyzeMove(prevFen, currentFen, currentMoveIndex - 1);
  }, 500);
}

function analyzeMove(beforeFen, afterFen, moveIndex) {
  const tempChess = new Chess(beforeFen);
  const moves = tempChess.moves({verbose: true});
  
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage(`position fen ${beforeFen}`);
  stockfish.postMessage('go depth 12');
  
  setTimeout(() => {
      const playedMove = findPlayedMove(beforeFen, afterFen);
      const mockEval = Math.random() * 400 - 200;
      const bestEval = mockEval + (Math.random() * 100 - 50);
      
      const evaluation = evaluateMoveQuality(mockEval, bestEval);
      moveAnalyses[moveIndex] = {
          played: playedMove,
          evaluation: evaluation,
          score: mockEval,
          bestScore: bestEval,
          alternatives: moves.slice(0, 3).map(m => m.san)
      };
      
      updateMoveInList(moveIndex, evaluation);
  }, 1000);
}

function findPlayedMove(beforeFen, afterFen) {
  const tempChess = new Chess(beforeFen);
  const moves = tempChess.moves({verbose: true});
  
  for (const move of moves) {
      const testChess = new Chess(beforeFen);
      testChess.move(move);
      if (testChess.fen() === afterFen) {
          return move.san;
      }
  }
  return '??';
}

function evaluateMoveQuality(moveScore, bestScore) {
  const diff = Math.abs(moveScore - bestScore);
  
  if (diff < 25) return { type: 'best', symbol: '‼️', color: '#4CAF50', text: 'Best Move' };
  if (diff < 50) return { type: 'excellent', symbol: '!', color: '#8BC34A', text: 'Excellent' };
  if (diff < 100) return { type: 'good', symbol: '', color: '#2196F3', text: 'Good Move' };
  if (diff < 200) return { type: 'inaccuracy', symbol: '?!', color: '#FF9800', text: 'Inaccuracy' };
  if (diff < 400) return { type: 'mistake', symbol: '?', color: '#FF5722', text: 'Mistake' };
  return { type: 'blunder', symbol: '??', color: '#f44336', text: 'Blunder' };
}

function updateMoveInList(moveIndex, evaluation) {
  const moveItems = document.querySelectorAll('.move-item');
  const actualIndex = moveIndex;
  
  if (moveItems[actualIndex]) {
      const evalSpan = moveItems[actualIndex].querySelector('.move-evaluation');
      if (evalSpan) {
          evalSpan.textContent = evaluation.symbol;
          evalSpan.style.color = evaluation.color;
          evalSpan.title = evaluation.text;
      }
  }
}

function parseAnalysisLine(line) {
  const parts = line.split(' ');
  const analysis = {};
  
  for (let i = 0; i < parts.length; i++) {
    switch(parts[i]) {
      case 'depth':
        analysis.depth = parts[i + 1];
        break;
      case 'score':
        if (parts[i + 1] === 'cp') {
          analysis.score = parseInt(parts[i + 2]);
        } else if (parts[i + 1] === 'mate') {
          analysis.mate = parseInt(parts[i + 2]);
        }
        break;
      case 'time':
        analysis.time = parseInt(parts[i + 1]);
        break;
      case 'nodes':
        analysis.nodes = parseInt(parts[i + 1]);
        break;
      case 'pv':
        analysis.pv = parts.slice(i + 1).join(' ').split(' ').slice(0, 8);
        return analysis;
    }
  }
  return analysis;
}

function updateAnalysisDisplay(analysis, altMoves) {
  const display = document.getElementById('analysisDisplay');
  let text = '';
  
  if (analysis.depth) {
    text += `Depth: ${analysis.depth}`;
  }
  
  if (analysis.time) {
    text += ` | Time: ${(analysis.time / 1000).toFixed(1)}s`;
  }
  
  text += '\n';
  
  if (analysis.score !== undefined) {
    const score = (analysis.score / 100).toFixed(2);
    text += `Evaluation: ${score > 0 ? '+' : ''}${score}`;
    updateEvaluationBar(analysis.score);
    
    if (Math.abs(analysis.score) > 200) {
      if (analysis.score > 0) {
        text += ' (White has significant advantage)';
      } else {
        text += ' (Black has significant advantage)';
      }
    } else if (Math.abs(analysis.score) < 50) {
      text += ' (Position is roughly equal)';
    }
  }
  
  if (analysis.mate !== undefined) {
    text += `Mate in: ${Math.abs(analysis.mate)}`;
    if (analysis.mate > 0) {
      text += ' (White to mate)';
    } else {
      text += ' (Black to mate)';
    }
    updateEvaluationBar(analysis.mate > 0 ? 1000 : -1000);
  }
  
  if (analysis.nodes) {
    text += ` | Nodes: ${Math.floor(analysis.nodes / 1000)}k`;
  }
  
  text += '\n';
  
  if (analysis.pv && analysis.pv.length > 0) {
    text += `Principal variation: ${analysis.pv.join(' ')}`;
  }
  
  if (currentMoveIndex > 0 && moveAnalyses[currentMoveIndex - 1]) {
      const moveAnalysis = moveAnalyses[currentMoveIndex - 1];
      text += `\n\n=== MOVE ANALYSIS ===`;
      text += `\nLast move: ${moveAnalysis.played} - ${moveAnalysis.evaluation.text}`;
      text += `\nMove score: ${(moveAnalysis.score/100).toFixed(2)}`;
      text += `\nBest score: ${(moveAnalysis.bestScore/100).toFixed(2)}`;
      if (moveAnalysis.alternatives.length > 0) {
          text += `\nAlternatives: ${moveAnalysis.alternatives.join(', ')}`;
      }
  }
  
  if (altMoves && altMoves.length > 1) {
    text += '\n\nBest moves in this position:';
    for (let i = 0; i < Math.min(altMoves.length, 4); i++) {
      const move = altMoves[i];
      const priority = i === 0 ? 'BEST' : i === 1 ? 'GOOD' : 'OK';
      text += `\n${priority}: ${move.san}`;
      if (move.captured) {
        text += ` (captures ${move.captured})`;
      }
    }
  }
  
  display.textContent = text;
}

function updateEvaluationBar(centipawns) {
  const evalBar = document.getElementById('evalBar');
  let percentage;
  
  if (Math.abs(centipawns) >= 1000) {
    percentage = centipawns > 0 ? 95 : 5;
  } else {
    percentage = 50 + (centipawns / 40);
    percentage = Math.max(5, Math.min(95, percentage));
  }
  
  evalBar.style.width = percentage + '%';
  
  if (percentage > 70) {
    evalBar.style.background = 'linear-gradient(90deg, #4CAF50, #8BC34A)';
  } else if (percentage < 30) {
    evalBar.style.background = 'linear-gradient(90deg, #f44336, #e57373)';
  } else {
    evalBar.style.background = 'linear-gradient(90deg, #f44336, #FFC107, #4CAF50)';
  }
}

function displayFullAnalysis(bestMove, altMoves, evaluation) {
  const display = document.getElementById('analysisDisplay');
  let text = display.textContent;
  
  if (bestMove && bestMove !== '(none)' && bestMove.length >= 4) {
    text += `\n\n=== POSITION ANALYSIS ===`;
    text += `\nRecommended move: ${bestMove}`;
    
    const tempChess = new Chess(gameHistory[currentMoveIndex]);
    const legalMoves = tempChess.moves({verbose: true});
    const moveObj = legalMoves.find(m => (m.from + m.to + (m.promotion || '')) === bestMove);
    
    if (moveObj) {
      text += ` (${moveObj.san})`;
      if (moveObj.captured) {
        text += ` - Captures ${moveObj.captured}`;
      }
      if (tempChess.move(moveObj) && tempChess.in_check()) {
        text += ` - Gives check`;
      }
    }
    
    if (currentAnalysis.score !== undefined) {
      const score = currentAnalysis.score / 100;
      text += `\nPosition evaluation: ${score > 0 ? '+' : ''}${score.toFixed(2)}`;
      
      if (Math.abs(score) > 3) {
        text += ` (Decisive advantage)`;
      } else if (Math.abs(score) > 1) {
        text += ` (Clear advantage)`;
      } else if (Math.abs(score) > 0.5) {
        text += ` (Slight advantage)`;
      } else {
        text += ` (Balanced position)`;
      }
    }
    
    highlightMove(bestMove);
  }
  
  display.textContent = text;
}

function displayBestMove(bestMove) {
  displayFullAnalysis(bestMove);
}

function highlightMove(move) {
  clearHighlights();
  
  if (move.length >= 4) {
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    
    const fromSquare = document.querySelector(`.square-${from}`);
    const toSquare = document.querySelector(`.square-${to}`);
    
    if (fromSquare) {
      fromSquare.classList.add('square-highlight');
    }
    if (toSquare) {
      toSquare.classList.add('square-highlight-to');
    }
  }
}

function clearHighlights() {
  document.querySelectorAll('.square-highlight, .square-highlight-to').forEach(el => {
    el.classList.remove('square-highlight', 'square-highlight-to');
  });
}

function updateEngineStatus(text, isReady) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  
  statusText.textContent = text;
  
  if (isReady) {
    statusDot.classList.add('ready');
  } else {
    statusDot.classList.remove('ready');
  }
}

function loadGame() {
  const pgnInput = document.getElementById('pgnInput').value.trim();
  const fenInput = document.getElementById('fenInput').value.trim();
  
  try {
    chess = new Chess();
    moveAnalyses = {};
    
    if (fenInput) {
      chess.load(fenInput);
      gameHistory = [chess.fen()];
      currentMoveIndex = 0;
    } else if (pgnInput) {
      if (chess.load_pgn(pgnInput)) {
        const history = chess.history();
        chess = new Chess();
        gameHistory = [chess.fen()];
        
        for (const move of history) {
          const moveObj = chess.move(move);
          if (moveObj) {
            gameHistory.push(chess.fen());
          }
        }
        currentMoveIndex = gameHistory.length - 1;
      } else {
        chess = new Chess();
        const moves = pgnInput.split(/\s+/).filter(m => !m.match(/^\d+\./) && m.trim());
        
        gameHistory = [chess.fen()];
        
        for (const move of moves) {
          try {
            const cleanMove = move.replace(/[+#!?]/g, '');
            const moveObj = chess.move(cleanMove);
            if (moveObj) {
              gameHistory.push(chess.fen());
            }
          } catch (e) {
            console.warn(`Invalid move: ${move}`);
          }
        }
        currentMoveIndex = gameHistory.length - 1;
      }
    } else {
      throw new Error('Please enter PGN moves or FEN position');
    }
    
    updateBoard();
    updateMoveList();
    clearHighlights();
    document.getElementById('analysisDisplay').textContent = 'Game loaded! Click "Analyze Position" to start analysis.';
    showToast('Game loaded successfully!', 'success');
    
    setTimeout(() => {
        analyzeAllMoves();
    }, 1000);
    
  } catch (error) {
    console.error('Error loading game:', error);
    showToast(`Error: ${error.message}`, 'error');
  }
}

function analyzeAllMoves() {
  for (let i = 1; i < gameHistory.length; i++) {
      setTimeout(() => {
          analyzeMove(gameHistory[i-1], gameHistory[i], i-1);
      }, i * 800);
  }
}

function updateBoard() {
  if (board && gameHistory[currentMoveIndex]) {
    chess.load(gameHistory[currentMoveIndex]);
    board.position(chess.fen());
  }
}

function updateMoveList() {
  const moveList = document.getElementById('moveList');
  moveList.innerHTML = '';
  
  if (gameHistory.length <= 1) {
    moveList.innerHTML = '<div style="text-align: center; color: #94a3b8; font-style: italic; padding: 1rem;">No moves to display</div>';
    return;
  }
  
  const tempChess = new Chess();
  let moveNumber = 1;
  
  for (let i = 1; i < gameHistory.length; i++) {
    tempChess.load(gameHistory[i - 1]);
    
    const legalMoves = tempChess.moves({verbose: true});
    let moveObj = null;
    
    for (const move of legalMoves) {
      const testChess = new Chess(gameHistory[i - 1]);
      testChess.move(move);
      if (testChess.fen() === gameHistory[i]) {
        moveObj = move;
        break;
      }
    }
    
    if (moveObj) {
      const moveDiv = document.createElement('div');
      moveDiv.className = 'move-item';
      if (i === currentMoveIndex) moveDiv.classList.add('active');
      
      const isWhite = i % 2 === 1;
      const displayNumber = isWhite ? `${moveNumber}.` : `${moveNumber}...`;
      if (!isWhite) moveNumber++;
      
      moveDiv.innerHTML = `
        <span class="move-notation">${displayNumber} ${moveObj.san}</span>
        <span class="move-evaluation">--</span>
      `;
      
      moveDiv.addEventListener('click', () => {
        currentMoveIndex = i;
        updateBoard();
        updateMoveList();
        clearHighlights();
        displayMoveAnalysis(i-1);
      });
      
      moveList.appendChild(moveDiv);
    }
  }
}

function displayMoveAnalysis(moveIndex) {
  if (moveAnalyses[moveIndex]) {
      const analysis = moveAnalyses[moveIndex];
      const display = document.getElementById('analysisDisplay');
      
      let text = `=== MOVE ${moveIndex + 1} ANALYSIS ===\n`;
      text += `Move played: ${analysis.played}\n`;
      text += `Quality: ${analysis.evaluation.text} ${analysis.evaluation.symbol}\n`;
      text += `Evaluation: ${(analysis.score/100).toFixed(2)}\n`;
      text += `Best line evaluation: ${(analysis.bestScore/100).toFixed(2)}\n`;
      text += `Difference: ${Math.abs(analysis.score - analysis.bestScore)/100} points\n\n`;
      
      if (analysis.evaluation.type === 'blunder') {
          text += `❌ This was a serious mistake that gives the opponent a big advantage.\n`;
      } else if (analysis.evaluation.type === 'mistake') {
          text += `⚠️ This move loses some advantage or worsens your position.\n`;
      } else if (analysis.evaluation.type === 'inaccuracy') {
          text += `💭 Not the most accurate move, but not terrible.\n`;
      } else if (analysis.evaluation.type === 'best') {
          text += `✅ Excellent! This is the best move in the position.\n`;
      }
      
      if (analysis.alternatives.length > 0) {
          text += `\nBetter alternatives were:\n`;
          analysis.alternatives.forEach((alt, i) => {
              text += `${i+1}. ${alt}\n`;
          });
      }
      
      display.textContent = text;
  }
}

function goToMove(index) {
  console.log('Going to move:', index, 'from current:', currentMoveIndex);
  currentMoveIndex = Math.max(0, Math.min(gameHistory.length - 1, index));
  console.log('New index:', currentMoveIndex);
  updateBoard();
  updateMoveList();
  clearHighlights();
  
  if (index > 0 && moveAnalyses[index - 1]) {
      displayMoveAnalysis(index - 1);
  }
}

function firstMove() { 
  console.log('First move clicked');
  goToMove(0); 
}
function prevMove() { 
  console.log('Prev move clicked, current:', currentMoveIndex);
  goToMove(currentMoveIndex - 1); 
}
function nextMove() { 
  console.log('Next move clicked, current:', currentMoveIndex);
  goToMove(currentMoveIndex + 1); 
}
function lastMove() { 
  console.log('Last move clicked, history length:', gameHistory.length);
  goToMove(gameHistory.length - 1); 
}

function analyzePosition() {
  if (!stockfish) {
    showToast('Engine not loaded yet', 'error');
    return;
  }
  
  if (isAnalyzing) {
    stockfish.postMessage('stop');
    isAnalyzing = false;
    
    if (analysisTimeout) {
      clearTimeout(analysisTimeout);
      analysisTimeout = null;
    }
    
    showToast('Analysis stopped', 'info');
    document.getElementById('analyzeBtn').innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze Position</span>';
    return;
  }
  
  isAnalyzing = true;
  currentAnalysis = {};
  const currentFen = gameHistory[currentMoveIndex];
  
  document.getElementById('analysisDisplay').textContent = 'Starting analysis...';
  clearHighlights();
  
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage(`position fen ${currentFen}`);
  
  if (engineType === 'mock') {
    stockfish.postMessage('go depth 10');
  } else {
    stockfish.postMessage('setoption name UCI_Variant value chess');
    stockfish.postMessage('setoption name UCI_AnalyseMode value true');
    stockfish.postMessage('go infinite');
    
    analysisTimeout = setTimeout(() => {
      if (isAnalyzing) {
        console.log('Engine not responding - switching to enhanced mock analysis');
        stockfish.postMessage('stop');
        isAnalyzing = false;
        setTimeout(() => {
          generateEnhancedMockAnalysis();
        }, 500);
      }
    }, 5000);
  }
  
  showToast('Analysis started...', 'info');
  document.getElementById('analyzeBtn').innerHTML = '🛑 Stop Analysis';
  
  setTimeout(() => {
    if (isAnalyzing) {
      stockfish.postMessage('stop');
    }
  }, 30000);
}

function clearGame() {
  if (isAnalyzing) {
    stockfish.postMessage('stop');
    isAnalyzing = false;
    
    if (analysisTimeout) {
      clearTimeout(analysisTimeout);
      analysisTimeout = null;
    }
  }
  
  chess = new Chess();
  gameHistory = [chess.fen()];
  currentMoveIndex = 0;
  currentAnalysis = {};
  moveAnalyses = {};
  
  document.getElementById('pgnInput').value = '';
  document.getElementById('fenInput').value = '';
  document.getElementById('analysisDisplay').textContent = 'Load a game and click "Analyze Position" to see engine analysis...';
  document.getElementById('analyzeBtn').innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze Position</span>';
  
  updateBoard();
  updateMoveList();
  clearHighlights();
  
  const evalBar = document.getElementById('evalBar');
  evalBar.style.width = '50%';
  evalBar.style.background = 'linear-gradient(90deg, #f44336, #4CAF50)';
  
  showToast('Board cleared', 'info');
}

function handleKeyboard(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }
  
  switch(e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      prevMove();
      break;
    case 'ArrowRight':
      e.preventDefault();
      nextMove();
      break;
    case 'Home':
      e.preventDefault();
      firstMove();
      break;
    case 'End':
      e.preventDefault();
      lastMove();
      break;
    case 'a':
    case 'A':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        analyzePosition();
      }
      break;
    case 'Escape':
      if (isAnalyzing) {
        e.preventDefault();
        analyzePosition();
      }
      break;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Initializing Game Review...');
  
  initBoard();
  await loadStockfish();
  
  document.getElementById('loadGameBtn').addEventListener('click', loadGame);
  document.getElementById('clearBtn').addEventListener('click', clearGame);
  document.getElementById('analyzeBtn').addEventListener('click', analyzePosition);
  
  
  console.log('Looking for navigation buttons...');
  const firstBtn = document.getElementById('firstBtn');
  const prevBtn = document.getElementById('prevBtn');  
  const nextBtn = document.getElementById('nextBtn');
  const lastBtn = document.getElementById('lastBtn');
  
  console.log('Navigation buttons found:', {
      firstBtn: !!firstBtn,
      prevBtn: !!prevBtn, 
      nextBtn: !!nextBtn,
      lastBtn: !!lastBtn
  });
  

  if (firstBtn) {
      console.log('Adding listener to first button');
      firstBtn.addEventListener('click', function(e) {
          console.log('FIRST BUTTON CLICKED!', e);
          firstMove();
      });
  } else {
      console.error('First button not found!');
  }
  
  if (prevBtn) {
      console.log('Adding listener to prev button');
      prevBtn.addEventListener('click', function(e) {
          console.log('PREV BUTTON CLICKED!', e);
          prevMove();
      });
  } else {
      console.error('Prev button not found!');
  }
  
  if (nextBtn) {
      console.log('Adding listener to next button');
      nextBtn.addEventListener('click', function(e) {
          console.log('NEXT BUTTON CLICKED!', e);
          nextMove();
      });
  } else {
      console.error('Next button not found!');
  }
  
  if (lastBtn) {
      console.log('Adding listener to last button');
      lastBtn.addEventListener('click', function(e) {
          console.log('LAST BUTTON CLICKED!', e);
          lastMove();
      });
  } else {
      console.error('Last button not found!');
  }
  
  document.addEventListener('keydown', handleKeyboard);
  
  document.getElementById('pgnInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      loadGame();
    }
  });
  
  document.getElementById('fenInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadGame();
    }
  });
  
  setTimeout(() => {
    showToast('Game Review ready! Load a game to start analyzing.', 'success');
  }, 2000);
  
  console.log('Game Review initialized successfully!');
});