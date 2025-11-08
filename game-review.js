const ENGINE_DEPTH = 16;
const QUICK_EVAL_TIME = 900;
const MAX_RETRIES = 3;
const API_TIMEOUT = 55000;
const CACHE_LIMIT = 50;
const MATE_SENTINEL_CP = 1000;
const CPL_CAP = 400;
const CPL_TRIM_RATIO = 0.1;

let chess;
let board;
let stockfish;
let gameHistory = [];
let currentMoveIndex = 0;
let moveAnalyses = {};
let positionEvalCache = {};
let engineType = 'api';
let isAnalyzing = false;
let isContinuousAnalysis = false;
let currentAnalysis = {};
let currentAnalysisContext = { index: null, fen: null, requestId: 0 };
let isQuickEvalActive = false;
let quickEvalTimeout = null;
let analysisTimeout = null;
let selectedSquare = null;
let gameMetadata = { white: 'White', black: 'Black' };
let performanceOverviewEl = null;
let performanceElements = null;

const playSound = (soundName) => {
  if (window.audioManager) window.audioManager.playSound(soundName);
};

const showToast = (message, type = 'info') => {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const enforceCacheLimit = () => {
  const keys = Object.keys(positionEvalCache);
  if (keys.length <= CACHE_LIMIT) return;
  keys
    .map((key) => ({ key, updatedAt: positionEvalCache[key].updatedAt }))
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, keys.length - CACHE_LIMIT)
    .forEach(({ key }) => delete positionEvalCache[key]);
};

const cleanFenForAnalysis = (fen) => {
  const parts = fen.split(' ');
  if (parts.length >= 4 && parts[3] !== '-') parts[3] = '-';
  return parts.join(' ');
};

const resetPositionEvalCache = () => {
  positionEvalCache = {};
  currentAnalysisContext = { index: null, fen: null, requestId: 0 };
};

const prunePositionEvalCache = (maxIndexToKeep) => {
  Object.keys(positionEvalCache).forEach((key) => {
    const numericKey = parseInt(key, 10);
    if (!Number.isNaN(numericKey) && numericKey > maxIndexToKeep) delete positionEvalCache[key];
  });
};

const formatEvaluationText = (centipawns) => {
  if (typeof centipawns !== 'number' || Number.isNaN(centipawns)) return '+0.00';
  const pawns = (centipawns / 100).toFixed(2);
  return `${centipawns >= 0 ? '+' : ''}${pawns}`;
};

const formatMateText = (mate) => {
  if (typeof mate !== 'number' || Number.isNaN(mate)) return '#?';
  const abs = Math.abs(mate);
  return mate > 0 ? `#${abs}` : `-#${abs}`;
};

const toCentipawnsFromApi = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
};

const normalizeDepth = (value) => {
  const depthNumber = Number(value);
  return Number.isFinite(depthNumber) ? depthNumber : undefined;
};

const normalizeEvalToWhite = (centipawns, fen) => {
  if (typeof centipawns !== 'number' || Number.isNaN(centipawns)) return undefined;
  if (!fen) return centipawns;
  const parts = fen.split(' ');
  if (parts.length < 2) return centipawns;
  return parts[1] === 'b' ? -centipawns : centipawns;
};

const toWhitePerspective = (centipawns, fallback, fen) => {
  const normalized = normalizeEvalToWhite(centipawns, fen);
  if (typeof normalized === 'number' && !Number.isNaN(normalized)) return normalized;
  if (typeof fallback === 'number' && !Number.isNaN(fallback)) return fallback;
  return centipawns;
};

const cplBetween = (beforeWhite, afterWhite) => {
  if (typeof beforeWhite !== 'number' || typeof afterWhite !== 'number') return 0;
  if (Math.abs(beforeWhite) >= MATE_SENTINEL_CP || Math.abs(afterWhite) >= MATE_SENTINEL_CP) {
    return CPL_CAP;
  }
  return Math.min(Math.abs(afterWhite - beforeWhite), CPL_CAP);
};

const trimmedMean = (values, trimRatio = CPL_TRIM_RATIO) => {
  if (!values.length) return null;
  if (values.length <= 2) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.min(Math.floor(sorted.length * trimRatio), Math.floor((sorted.length - 1) / 2));
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (!trimmed.length) return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
};

const cachePositionEvaluation = (index, { score, mate, depth, fen, normalized = false }) => {
  const numericIndex = Number(index);
  if (Number.isNaN(numericIndex) || (typeof score !== 'number' && typeof mate !== 'number')) return;

  const existing = positionEvalCache[numericIndex];
  const normalizedDepth = typeof depth === 'number' && !Number.isNaN(depth)
    ? depth
    : (existing && typeof existing.depth === 'number' ? existing.depth : undefined);

  if (existing && typeof normalizedDepth === 'number' && typeof existing.depth === 'number' && normalizedDepth < existing.depth) return;

  const sideToMove = fen ? fen.split(' ')[1] : null;
  const scoreWhite = typeof score === 'number'
    ? (normalized ? score : (sideToMove === 'b' ? -score : score))
    : (existing ? existing.score : undefined);
  const mateWhite = typeof mate === 'number'
    ? (normalized ? mate : (sideToMove === 'b' ? -mate : mate))
    : (existing ? existing.mate : undefined);

  let centipawns;
  let displayText;

  if (typeof mateWhite === 'number') {
    centipawns = mateWhite > 0 ? MATE_SENTINEL_CP : -MATE_SENTINEL_CP;
    displayText = formatMateText(mateWhite);
  } else if (typeof scoreWhite === 'number') {
    centipawns = scoreWhite;
    displayText = formatEvaluationText(scoreWhite);
  } else if (existing) {
    centipawns = existing.centipawns;
    displayText = existing.text;
        } else {
    return;
  }

  positionEvalCache[numericIndex] = {
    centipawns,
    score: typeof scoreWhite === 'number' ? scoreWhite : undefined,
    mate: typeof mateWhite === 'number' ? mateWhite : undefined,
    depth: normalizedDepth,
    fen: fen || (existing ? existing.fen : undefined),
    text: displayText,
    updatedAt: Date.now()
  };
  enforceCacheLimit();
};

const applyCachedEvaluationForMove = (index) => {
  const numericIndex = Number(index);
  if (Number.isNaN(numericIndex)) return false;
  const cached = positionEvalCache[numericIndex];
  if (!cached) return false;
  updateEvaluationBar(cached.centipawns, { textOverride: cached.text });
  return true;
};

const requestStockfishEvaluation = async (fen, signal) => {
  const controller = signal ? null : new AbortController();
  const activeSignal = signal || controller.signal;
  const timeoutId = setTimeout(() => {
    if (!signal) controller.abort();
  }, API_TIMEOUT);

  try {
    const response = await fetch('/api/stockfish', {
                      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen }),
      signal: activeSignal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  } finally {
                      clearTimeout(timeoutId);
  }
};

const createApiEngine = () => {
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let controller = null;

  const sendToListener = (payload) => {
    if (stockfish.onmessage) stockfish.onmessage({ data: payload });
  };

  const analyzeFen = async (fen, movetime) => {
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      const result = await requestStockfishEvaluation(fen, controller.signal);
      const centipawns = toCentipawnsFromApi(result?.eval);
      const depth = normalizeDepth(result?.depth) || ENGINE_DEPTH;
      if (centipawns !== null) {
        sendToListener(`info depth ${depth} score cp ${centipawns} time ${movetime || QUICK_EVAL_TIME} nodes 1000000`);
      }
      sendToListener(`bestmove ${result?.move || 'e2e4'}`);
    } catch (error) {
      if (error.name !== 'AbortError') {
        sendToListener('info string API error');
        sendToListener('bestmove e2e4 ponder e7e5');
      }
    } finally {
      controller = null;
    }
  };

  return {
    onmessage: null,
    postMessage: (command) => {
      const trimmed = command.trim();
      if (trimmed === 'uci') {
        sendToListener('id name PawnPush Stockfish API');
        sendToListener('id author PawnPush');
        sendToListener('uciok');
        return;
      }
      if (trimmed === 'ucinewgame') {
        currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        return;
      }
      if (trimmed.startsWith('setoption') || trimmed.startsWith('isready')) {
        if (trimmed.startsWith('isready')) sendToListener('readyok');
        return;
      }
      if (trimmed.startsWith('position')) {
        const parts = trimmed.split(' ');
        const fenIndex = parts.indexOf('fen');
        if (fenIndex !== -1 && fenIndex + 6 < parts.length) {
          currentFen = parts.slice(fenIndex + 1, fenIndex + 7).join(' ');
        }
        return;
      }
      if (trimmed.startsWith('go')) {
        const movetimeMatch = trimmed.match(/movetime\s+(\d+)/);
        const movetime = movetimeMatch ? Number(movetimeMatch[1]) : QUICK_EVAL_TIME;
        analyzeFen(currentFen, movetime);
        return;
      }
      if (trimmed === 'stop') {
        if (controller) controller.abort();
        controller = null;
        sendToListener('bestmove e2e4 ponder e7e5');
      }
    },
    terminate: () => {
      if (controller) controller.abort();
      controller = null;
    }
  };
};

const updateEvaluationBar = (centipawns, options = {}) => {
  const evalBarBoard = document.getElementById('evalBarFill');
  const evalScoreBoard = document.getElementById('evalScoreBoard');
  if (!evalBarBoard || !evalScoreBoard) return;

  let percentage;
  if (Math.abs(centipawns) >= 1000) {
    percentage = centipawns > 0 ? 95 : 5;
      } else {
    percentage = Math.max(5, Math.min(95, 50 + centipawns / 40));
  }

  evalBarBoard.style.width = `${percentage}%`;

  const score = (centipawns / 100).toFixed(2);
  const scoreText = options.textOverride || `${centipawns >= 0 ? '+' : ''}${score}`;
  evalScoreBoard.textContent = scoreText;

  if (centipawns > 100) {
    evalScoreBoard.style.color = '#FFFFFF';
    evalScoreBoard.style.backgroundColor = '#4CAF50';
  } else if (centipawns < -100) {
    evalScoreBoard.style.color = '#FFFFFF';
    evalScoreBoard.style.backgroundColor = '#000000';
        } else {
    evalScoreBoard.style.color = '#ffffff';
    evalScoreBoard.style.backgroundColor = 'rgba(100, 181, 246, 0.2)';
  }

  if (percentage > 70) evalBarBoard.style.background = '#4CAF50';
  else if (percentage < 30) evalBarBoard.style.background = '#f44336';
  else evalBarBoard.style.background = 'linear-gradient(90deg, #f44336, #666, #4CAF50)';
};

const applyMaterialFallback = (fen) => {
  const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  try {
    const boardPart = fen.split(' ')[0];
    let score = 0;
    boardPart.split('').forEach((ch) => {
      const lower = ch.toLowerCase();
      if (pieceValues[lower] !== undefined) {
        const val = pieceValues[lower];
        score += ch === ch.toUpperCase() ? val : -val;
      }
    });
    updateEvaluationBar(score);
  } catch {
    updateEvaluationBar(0);
  }
};

const triggerQuickEval = () => {
  try {
    if (!chess) return;
    const fen = gameHistory[currentMoveIndex] || chess.fen();
    if (applyCachedEvaluationForMove(currentMoveIndex)) return;

    applyMaterialFallback(fen);
    if (!stockfish || engineType === 'mock') return;

    if (isQuickEvalActive) {
      stockfish.postMessage('stop');
      if (quickEvalTimeout) {
        clearTimeout(quickEvalTimeout);
        quickEvalTimeout = null;
      }
      isQuickEvalActive = false;
    }

    if (isAnalyzing && !isContinuousAnalysis) return;

    isQuickEvalActive = true;
    stockfish.postMessage('ucinewgame');
    stockfish.postMessage(`position fen ${fen}`);
    stockfish.postMessage(`go depth ${ENGINE_DEPTH} movetime ${QUICK_EVAL_TIME}`);

    quickEvalTimeout = setTimeout(() => {
      if (isQuickEvalActive) {
        stockfish.postMessage('stop');
        isQuickEvalActive = false;
      }
    }, QUICK_EVAL_TIME);
  } catch {
    applyMaterialFallback(gameHistory[currentMoveIndex]);
  }
};

const updateMoveInList = (moveIndex, evaluation) => {
  if (!moveAnalyses[moveIndex]) moveAnalyses[moveIndex] = {};
  moveAnalyses[moveIndex].evaluation = evaluation;

  const moveItems = document.querySelectorAll('.move-item');
  const item = moveItems[moveIndex];
  if (item) {
    const evalSpan = item.querySelector('.move-evaluation');
    if (evalSpan) {
      evalSpan.textContent = evaluation.symbol;
      evalSpan.style.color = evaluation.color;
      evalSpan.title = evaluation.text;
    }
  }

  updatePerformanceOverview(calculatePerformanceRating());
};

const parseAnalysisLine = (line) => {
  const parts = line.split(' ');
  const analysis = {};
  for (let i = 0; i < parts.length; i += 1) {
    switch (parts[i]) {
      case 'depth':
        analysis.depth = parts[i + 1];
        break;
      case 'score':
        if (parts[i + 1] === 'cp') analysis.score = parseInt(parts[i + 2], 10);
        if (parts[i + 1] === 'mate') analysis.mate = parseInt(parts[i + 2], 10);
        break;
      case 'time':
        analysis.time = parseInt(parts[i + 1], 10);
        break;
      case 'nodes':
        analysis.nodes = parseInt(parts[i + 1], 10);
        break;
      case 'pv':
        analysis.pv = parts.slice(i + 1).join(' ').split(' ').slice(0, 8);
        return analysis;
      default:
        break;
    }
  }
  return analysis;
};

const updateAnalysisDisplay = (analysis, altMoves) => {
  const display = document.getElementById('analysisDisplay');
  if (!display) return;

  let text = '';
  if (analysis.depth) text += `Depth: ${analysis.depth}`;
  if (analysis.time) text += ` | Time: ${(analysis.time / 1000).toFixed(1)}s`;
  text += '\n';

  const depthNumber = analysis.depth ? parseInt(analysis.depth, 10) : undefined;
  const contextIndex = typeof currentAnalysisContext.index === 'number' ? currentAnalysisContext.index : null;
  const contextFen = currentAnalysisContext.fen;

  if (analysis.score !== undefined) {
    const whiteScore = toWhitePerspective(analysis.score, analysis.score, contextFen);
    const score = (whiteScore / 100).toFixed(2);
    text += `Evaluation: ${score > 0 ? '+' : ''}${score}`;
    updateEvaluationBar(whiteScore);

    if (contextIndex !== null) {
      cachePositionEvaluation(contextIndex, {
        score: whiteScore,
        depth: depthNumber,
        fen: contextFen,
        normalized: true
      });
    }

    if (Math.abs(whiteScore) > 200) text += whiteScore > 0 ? ' (White has significant advantage)' : ' (Black has significant advantage)';
    else if (Math.abs(whiteScore) < 50) text += ' (Position is roughly equal)';
  }

  if (analysis.mate !== undefined) {
    text += `Mate in: ${Math.abs(analysis.mate)}`;
    const mateWhite = normalizeEvalToWhite(analysis.mate > 0 ? 1000 : -1000, contextFen);
    text += analysis.mate > 0 ? ' (White to mate)' : ' (Black to mate)';
    updateEvaluationBar(mateWhite, { textOverride: formatMateText(analysis.mate) });

    if (contextIndex !== null) {
      cachePositionEvaluation(contextIndex, {
        mate: analysis.mate,
        depth: depthNumber,
        fen: contextFen
      });
    }
  }

  if (analysis.nodes) text += ` | Nodes: ${Math.floor(analysis.nodes / 1000)}k`;
  text += '\n';

  if (analysis.pv && analysis.pv.length > 0) text += `Principal variation: ${analysis.pv.join(' ')}`;

  if (currentMoveIndex > 0 && moveAnalyses[currentMoveIndex - 1]) {
    const moveAnalysis = moveAnalyses[currentMoveIndex - 1];
    text += '\n\n=== MOVE ANALYSIS ===';
    text += `\nLast move: ${moveAnalysis.played} - ${moveAnalysis.evaluation.text}`;
    text += `\nMove score: ${(moveAnalysis.score / 100).toFixed(2)}`;
    text += `\nBest score: ${(moveAnalysis.bestScore / 100).toFixed(2)}`;
    if (moveAnalysis.alternatives && moveAnalysis.alternatives.length > 0) {
      text += `\nAlternatives: ${moveAnalysis.alternatives.join(', ')}`;
    }
  }

  if (altMoves && altMoves.length > 1) {
    text += '\n\nBest moves in this position:';
    altMoves.slice(0, 4).forEach((move, i) => {
      const priority = i === 0 ? 'BEST' : i === 1 ? 'GOOD' : 'OK';
      text += `\n${priority}: ${move.san}`;
      if (move.captured) text += ` (captures ${move.captured})`;
    });
  }

  display.textContent = text;
};

const clearHighlights = () => {
  document.querySelectorAll('.square-highlight, .square-highlight-to').forEach((el) => {
    el.classList.remove('square-highlight', 'square-highlight-to');
  });
};

const highlightMove = (move) => {
  clearHighlights();
  if (move.length < 4) return;
  const from = move.substring(0, 2);
  const to = move.substring(2, 4);
  const fromSquare = document.querySelector(`.square-${from}`);
  const toSquare = document.querySelector(`.square-${to}`);
  if (fromSquare) fromSquare.classList.add('square-highlight');
  if (toSquare) toSquare.classList.add('square-highlight-to');
};

const updateEngineStatus = (text, isReady) => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  if (!statusText) return;
  statusText.textContent = text;
  if (!statusDot) return;
  if (isReady) statusDot.classList.add('ready');
  else statusDot.classList.remove('ready');
};

const convertUciToSan = (uciMove, fen) => {
  try {
    const tempChess = new Chess(fen);
    const from = uciMove.substring(0, 2);
    const to = uciMove.substring(2, 4);
    const promotion = uciMove.length > 4 ? uciMove[4] : null;

    return tempChess.moves({ verbose: true }).find((move) => (
      move.from === from &&
      move.to === to &&
      ((!promotion && !move.promotion) || move.promotion === promotion)
    ))?.san || uciMove;
  } catch {
    return uciMove;
  }
};

const evaluateMoveQuality = (moveScore, bestScore) => {
  const diff = Math.abs(moveScore - bestScore);
  if (diff <= 10) return { type: 'best', symbol: '‼️', color: '#4CAF50', text: 'Best / Brilliant', score: 1.00 };
  if (diff <= 25) return { type: 'excellent', symbol: '!', color: '#8BC34A', text: 'Excellent', score: 0.95 };
  if (diff <= 50) return { type: 'good', symbol: '✓', color: '#2196F3', text: 'Good', score: 0.85 };
  if (diff <= 75) return { type: 'inaccuracy', symbol: '?!', color: '#FF9800', text: 'Inaccuracy', score: 0.60 };
  if (diff <= 150) return { type: 'mistake', symbol: '?', color: '#FF5722', text: 'Mistake', score: 0.30 };
  return { type: 'blunder', symbol: '??', color: '#f44336', text: 'Blunder', score: 0.00 };
};

const evaluateMoveQualityFromCPL = (cpl) => {
  if (cpl <= 3) return { type: 'brilliant', symbol: '‼️', color: '#4CAF50', text: 'Brilliant', score: 1.00 };
  if (cpl <= 10) return { type: 'best', symbol: '!', color: '#4CAF50', text: 'Best', score: 0.96 };
  if (cpl <= 25) return { type: 'excellent', symbol: '!', color: '#8BC34A', text: 'Excellent', score: 0.90 };
  if (cpl <= 50) return { type: 'good', symbol: '✓', color: '#2196F3', text: 'Good', score: 0.75 };
  if (cpl <= 100) return { type: 'inaccuracy', symbol: '?!', color: '#FF9800', text: 'Inaccuracy', score: 0.55 };
  if (cpl <= 200) return { type: 'mistake', symbol: '?', color: '#FF5722', text: 'Mistake', score: 0.25 };
  return { type: 'blunder', symbol: '??', color: '#f44336', text: 'Blunder', score: 0.00 };
};

const findPlayedMove = (beforeFen, afterFen) => {
  const tempChess = new Chess(beforeFen);
  const moves = tempChess.moves({ verbose: true });
  for (const move of moves) {
    const testChess = new Chess(beforeFen);
    testChess.move(move);
    if (testChess.fen() === afterFen) return move.from + move.to + (move.promotion || '');
  }
  return '??';
};

const fallbackAnalysis = (playedMove, moveIndex) => {
  const evaluation = { type: 'good', symbol: '✓', color: '#2196F3', text: 'Good Move', score: 0.85 };
  moveAnalyses[moveIndex] = {
    played: playedMove,
    evaluation,
    score: 0,
    bestScore: 0,
    cpl: 0,
    alternatives: []
  };

  const beforeFen = gameHistory[moveIndex];
  const afterFen = gameHistory[moveIndex + 1];
  if (beforeFen) cachePositionEvaluation(moveIndex, { score: 0, depth: 0, fen: cleanFenForAnalysis(beforeFen) });
  if (afterFen) cachePositionEvaluation(moveIndex + 1, { score: 0, depth: 0, fen: cleanFenForAnalysis(afterFen) });

  updateMoveInList(moveIndex, evaluation);
};

const analyzeMoveReal = async (beforeFen, afterFen, moveIndex) => {
  const playedMove = findPlayedMove(beforeFen, afterFen);
  const cleanBeforeFen = cleanFenForAnalysis(beforeFen);
  const cleanAfterFen = cleanFenForAnalysis(afterFen);

  try {
    const beforeData = await requestStockfishEvaluation(cleanBeforeFen);
    if (!beforeData || beforeData.error || beforeData.eval === undefined || !beforeData.move) {
      fallbackAnalysis(playedMove, moveIndex);
      return false;
    }

    const bestEvalRaw = toCentipawnsFromApi(beforeData.eval);
    const beforeWhiteEvalFixed = normalizeEvalToWhite(bestEvalRaw, cleanBeforeFen);
    if (bestEvalRaw === null || beforeWhiteEvalFixed === undefined) {
      fallbackAnalysis(playedMove, moveIndex);
      return false;
    }

    const beforeForCpl = cleanBeforeFen.includes(' b ') ? -beforeWhiteEvalFixed : beforeWhiteEvalFixed;

    const bestMove = beforeData.move;
    const beforeDepth = normalizeDepth(beforeData.depth);
    cachePositionEvaluation(moveIndex, {
      score: bestEvalRaw,
      depth: beforeDepth,
      fen: cleanBeforeFen
    });
      
      if (playedMove === bestMove) {
        const evaluation = evaluateMoveQualityFromCPL(0);
        moveAnalyses[moveIndex] = {
          played: playedMove,
        evaluation,
        score: beforeWhiteEvalFixed,
        bestScore: beforeWhiteEvalFixed,
        bestMove,
          cpl: 0,
          alternatives: []
        };
      cachePositionEvaluation(moveIndex + 1, {
        score: bestEvalRaw,
        depth: beforeDepth,
        fen: cleanAfterFen
      });
        updateMoveInList(moveIndex, evaluation);
      return true;
    }

    const afterData = await requestStockfishEvaluation(cleanAfterFen);
    if (!afterData || afterData.error || afterData.eval === undefined) {
      fallbackAnalysis(playedMove, moveIndex);
      return false;
    }

    const afterEvalRaw = toCentipawnsFromApi(afterData.eval);
    const afterWhiteEvalFixed = normalizeEvalToWhite(afterEvalRaw, cleanAfterFen);
    if (afterEvalRaw === null || afterWhiteEvalFixed === undefined) {
            fallbackAnalysis(playedMove, moveIndex);
      return false;
    }

    const afterForCpl = cleanAfterFen.includes(' b ') ? -afterWhiteEvalFixed : afterWhiteEvalFixed;

    const afterDepth = normalizeDepth(afterData.depth);
    cachePositionEvaluation(moveIndex + 1, {
      score: afterEvalRaw,
      depth: afterDepth,
      fen: cleanAfterFen
    });

    if (!Number.isFinite(beforeForCpl) || !Number.isFinite(afterForCpl)) {
      fallbackAnalysis(playedMove, moveIndex);
      return false;
    }

    const cpl = cplBetween(beforeForCpl, afterForCpl);
    const evaluation = evaluateMoveQualityFromCPL(cpl);

    moveAnalyses[moveIndex] = {
      played: playedMove,
      evaluation,
      score: afterWhiteEvalFixed,
      bestScore: beforeWhiteEvalFixed,
      bestMove,
      cpl,
      alternatives: []
    };
            updateMoveInList(moveIndex, evaluation);
    return true;
  } catch {
            fallbackAnalysis(playedMove, moveIndex);
    return false;
  }
};

const analyzeMoveWithRetries = async (beforeFen, afterFen, moveIndex) => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const success = await analyzeMoveReal(beforeFen, afterFen, moveIndex);
    if (success) return true;
    if (attempt < MAX_RETRIES) await delay(1500);
  }
  return false;
};

const evaluateLastMove = () => {
  if (!stockfish || currentMoveIndex < 1) return;
  const prevFen = gameHistory[currentMoveIndex - 1];
  const currentFen = gameHistory[currentMoveIndex];
  delay(500).then(() => analyzeMove(prevFen, currentFen, currentMoveIndex - 1));
};

const analyzeMove = (beforeFen, afterFen, moveIndex) => {
  const tempChess = new Chess(beforeFen);
  const moves = tempChess.moves({ verbose: true });
  
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage(`position fen ${beforeFen}`);
  stockfish.postMessage(`go depth ${ENGINE_DEPTH}`);
  
  setTimeout(() => {
      const playedMove = findPlayedMove(beforeFen, afterFen);
      const mockEval = Math.random() * 400 - 200;
      const bestEval = mockEval + (Math.random() * 100 - 50);
      const evaluation = evaluateMoveQuality(mockEval, bestEval);

      moveAnalyses[moveIndex] = {
          played: playedMove,
      evaluation,
          score: mockEval,
          bestScore: bestEval,
      alternatives: moves.slice(0, 3).map((m) => m.san)
      };
      
      updateMoveInList(moveIndex, evaluation);
  }, 1000);
};

const analyzeMoveBatch = async (batch) => {
  await Promise.all(batch.map(({ before, after, index }) => analyzeMoveWithRetries(before, after, index)));
};

const analyzeAllMoves = async () => {
  if (isAnalyzing) return;

  isAnalyzing = true;
  showLoadingOverlay();
  updateLoadingProgress('Starting analysis...');

  const totalMoves = Math.max(gameHistory.length - 1, 0);
  if (totalMoves === 0) {
    hideLoadingOverlay();
    isAnalyzing = false;
    return;
  }

  let processedMoves = 0;

  try {
    for (let start = 1; start < gameHistory.length; start += 5) {
      const batch = [];
      for (let offset = 0; offset < 5 && start + offset < gameHistory.length; offset += 1) {
        const moveIndex = start + offset - 1;
        batch.push({
          before: gameHistory[moveIndex],
          after: gameHistory[moveIndex + 1],
          index: moveIndex
        });
      }
      await analyzeMoveBatch(batch);
      processedMoves = Math.min(processedMoves + batch.length, totalMoves);
      updateLoadingProgress(`Analyzing... ${processedMoves}/${totalMoves} moves completed`);
    }

    const performanceStats = calculatePerformanceRating();
    updatePerformanceOverview(performanceStats);
    updateLoadingProgress('Finalizing analysis...');

    if (totalMoves < 10) {
      showToast('⚠️ This game is too short for accurate performance estimation', 'warning');
    }

    setTimeout(() => {
      hideLoadingOverlay();
      const completedMoves = Object.keys(moveAnalyses).length;
      let performanceText = '';
      if (performanceStats && (performanceStats.white?.rating !== null || performanceStats.black?.rating !== null)) {
        const parts = [];
        if (performanceStats.white?.rating !== null) {
          parts.push(`${gameMetadata.white}: ${performanceStats.white.rating}`);
        }
        if (performanceStats.black?.rating !== null) {
          parts.push(`${gameMetadata.black}: ${performanceStats.black.rating}`);
        }
        performanceText = parts.join(' | ');
      }

      showToast(`Analysis complete! Analyzed ${completedMoves} moves.`, 'success');
      isAnalyzing = false;
      const analyzeBtn = document.getElementById('analyzeBtn');
      if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze All Moves</span>';

      const analysisDisplay = document.getElementById('analysisDisplay');
      if (analysisDisplay) {
        let performanceDisplay = '';
        if (performanceStats && (performanceStats.white?.rating !== null || performanceStats.black?.rating !== null)) {
          performanceDisplay = '\n\n' + '='.repeat(40) + '\n';
          if (performanceStats.white?.rating !== null) performanceDisplay += `${gameMetadata.white}: ${Math.round(performanceStats.white.rating)}\n`;
          if (performanceStats.black?.rating !== null) performanceDisplay += `${gameMetadata.black}: ${Math.round(performanceStats.black.rating)}\n`;
        }
        analysisDisplay.textContent = `Analysis complete! Click on any move to see detailed evaluation.${performanceDisplay}`;
      }
    }, 500);
  } catch {
    hideLoadingOverlay();
    showToast('Analysis failed. Please try again.', 'error');
    isAnalyzing = false;
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze All Moves</span>';
  }
};

const displayMoveAnalysis = (moveIndex) => {
  const display = document.getElementById('analysisDisplay');
  if (!display || !moveAnalyses[moveIndex]) return;

  const analysis = moveAnalyses[moveIndex];
  const beforeFen = gameHistory[moveIndex] || gameHistory[0];

  let playedMoveDisplay;
  try {
    playedMoveDisplay = convertUciToSan(analysis.played, beforeFen);
  } catch {
    playedMoveDisplay = analysis.played;
  }

  let text = `=== MOVE ${moveIndex + 1} ANALYSIS ===\n`;
  text += `Move played: ${playedMoveDisplay}\n`;
  text += `Quality: ${analysis.evaluation.text} ${analysis.evaluation.symbol}\n`;
  text += `Evaluation: ${(analysis.score / 100).toFixed(2)}\n`;
  text += `Best line evaluation: ${(analysis.bestScore / 100).toFixed(2)}\n`;
  text += `Centipawn Loss (CPL): ${analysis.cpl}\n\n`;

  if (analysis.evaluation.type === 'blunder') text += '❌ This was a serious mistake that gives the opponent a big advantage.\n';
  else if (analysis.evaluation.type === 'mistake') text += '⚠️ This move loses some advantage or worsens your position.\n';
  else if (analysis.evaluation.type === 'inaccuracy') text += '💭 Not the most accurate move, but not terrible.\n';
  else if (analysis.evaluation.type === 'best' || analysis.evaluation.type === 'brilliant') text += '✅ Excellent play in this position.\n';

  if (analysis.alternatives && analysis.alternatives.length > 0) {
    text += '\nBetter alternatives were:\n';
    analysis.alternatives.forEach((alt, i) => {
      text += `${i + 1}. ${alt}\n`;
    });
  }

  display.textContent = text;
};

const goToMove = (index) => {
  currentMoveIndex = Math.max(0, Math.min(gameHistory.length - 1, index));
  updateBoard();
  updateMoveList();
  clearHighlights();

  if (isAnalyzing) {
    stockfish.postMessage('stop');
    isAnalyzing = false;
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze All Moves</span>';
  }

  if (!applyCachedEvaluationForMove(currentMoveIndex)) {
  const evalBarBoard = document.getElementById('evalBarFill');
  const evalScoreBoard = document.getElementById('evalScoreBoard');
    if (evalBarBoard) {
      evalBarBoard.style.width = '50%';
      evalBarBoard.style.background = 'linear-gradient(90deg, #f44336, #666, #4CAF50)';
    }
    if (evalScoreBoard) {
      evalScoreBoard.textContent = '+0.00';
    evalScoreBoard.style.color = '#ffffff';
    evalScoreBoard.style.backgroundColor = 'rgba(100, 181, 246, 0.2)';
  }
  }

  const analysisDisplay = document.getElementById('analysisDisplay');
  if (!analysisDisplay) return;
  if (currentMoveIndex === 0) analysisDisplay.textContent = 'Starting position. Click "Analyze All Moves" to analyze the entire game.';
  else analysisDisplay.textContent = `Position ${currentMoveIndex}. Click "Analyze All Moves" to analyze the entire game.`;
};

const firstMove = () => goToMove(0);
const prevMove = () => goToMove(currentMoveIndex - 1);
const nextMove = () => goToMove(currentMoveIndex + 1);
const lastMove = () => goToMove(gameHistory.length - 1);

const displayFullAnalysis = (bestMove) => {
  const display = document.getElementById('analysisDisplay');
  if (!display) return;
  
  let text = display.textContent || '';
  if (bestMove && bestMove !== '(none)' && bestMove.length >= 4) {
    text += '\n\n=== POSITION ANALYSIS ===';
    text += `\nRecommended move: ${bestMove}`;
    
    const tempChess = new Chess(gameHistory[currentMoveIndex]);
    const legalMoves = tempChess.moves({ verbose: true });
    const moveObj = legalMoves.find((m) => (m.from + m.to + (m.promotion || '')) === bestMove);
    
    if (moveObj) {
      text += ` (${moveObj.san})`;
      if (moveObj.captured) text += ` - Captures ${moveObj.captured}`;
      const copyChess = new Chess(gameHistory[currentMoveIndex]);
      copyChess.move(moveObj);
      if (copyChess.in_check()) text += ' - Gives check';
    }
    
    if (currentAnalysis.score !== undefined) {
      const score = currentAnalysis.score / 100;
      text += `\nPosition evaluation: ${score > 0 ? '+' : ''}${score.toFixed(2)}`;
      
      if (Math.abs(score) > 3) text += ' (Decisive advantage)';
      else if (Math.abs(score) > 1) text += ' (Clear advantage)';
      else if (Math.abs(score) > 0.5) text += ' (Slight advantage)';
      else text += ' (Balanced position)';
    }
    
    highlightMove(bestMove);
  }
  
  display.textContent = text;
};

const displayBestMove = (bestMove) => {
  displayFullAnalysis(bestMove);
};

const selectReasonableMove = (moves, refChess) => {
  let candidates = moves.filter((m) => m.captured);
  if (candidates.length === 0) {
    candidates = moves.filter((m) => {
      const testChess = new Chess(refChess.fen());
      testChess.move(m);
      return testChess.in_check();
    });
  }
  if (candidates.length === 0) {
    candidates = moves.filter((m) => ['d4', 'd5', 'e4', 'e5', 'c4', 'c5', 'f4', 'f5'].includes(m.to)
      || ['b1', 'g1', 'b8', 'g8', 'c1', 'f1', 'c8', 'f8'].includes(m.from));
  }
  if (candidates.length === 0) candidates = moves;
  return candidates[Math.floor(Math.random() * candidates.length)];
};

const calculatePositionValue = (refChess) => {
  const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let evaluation = 0;
  const boardArray = refChess.board();
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const piece = boardArray[i][j];
      if (piece) {
        const value = pieceValues[piece.type.toLowerCase()] * 100;
        evaluation += piece.color === 'w' ? value : -value;
      }
    }
  }
  evaluation += (Math.random() - 0.5) * 50;
  return evaluation;
};

const generateMockAnalysis = () => {
  const possibleMoves = chess.moves({ verbose: true });
  if (possibleMoves.length === 0) {
    stockfish.onmessage({ data: 'bestmove (none)' });
    return;
  }

  const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  const baseScore = (Math.random() - 0.5) * 200;

  for (let depth = 1; depth <= 12; depth += 1) {
    setTimeout(() => {
      const score = Math.round(baseScore + (Math.random() - 0.5) * 50);
      const timeMs = depth * 100;
      const nodes = depth * 15000;
      const bestMove = randomMove.from + randomMove.to + (randomMove.promotion || '');
      stockfish.onmessage({ data: `info depth ${depth} score cp ${score} time ${timeMs} nodes ${nodes} pv ${bestMove}` });
    }, depth * 200);
  }

  setTimeout(() => {
    const bestMove = randomMove.from + randomMove.to + (randomMove.promotion || '');
    stockfish.onmessage({ data: `bestmove ${bestMove}` });
  }, 2500);
};

const generateEnhancedMockAnalysis = () => {
  const currentFen = gameHistory[currentMoveIndex];
  const tempChess = new Chess(currentFen);
  const moves = tempChess.moves({ verbose: true });
  if (moves.length === 0) {
    const display = document.getElementById('analysisDisplay');
    if (display) display.textContent = 'Position is terminal (checkmate or stalemate)';
    return;
  }

  isAnalyzing = true;
  const display = document.getElementById('analysisDisplay');
  if (display) display.textContent = 'Enhanced analysis running...';

  const bestMove = selectReasonableMove(moves, tempChess);
  const evaluation = calculatePositionValue(tempChess);
  const alternativeMoves = moves.slice(0, 5);

  for (let depth = 1; depth <= 15; depth += 1) {
    setTimeout(() => {
      if (!isAnalyzing) return;
      const analysis = {
        depth,
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
    displayFullAnalysis(bestMove.from + bestMove.to + (bestMove.promotion || ''), alternativeMoves, evaluation);
    if (!isContinuousAnalysis) {
      isAnalyzing = false;
      const analyzeBtn = document.getElementById('analyzeBtn');
      if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Suggest Move</span>';
    } else {
      isAnalyzing = false;
    }
  }, 3200);
};

const handleStockfishMessage = (message) => {
  const messageText = typeof message === 'string' ? message : (message.data || '');

  if (messageText.includes('uciok')) {
    stockfish.postMessage('ucinewgame');
    return;
  }

  if (messageText.includes('info depth') && (isAnalyzing || isQuickEvalActive)) {
    const analysis = parseAnalysisLine(messageText);
    if (analysis.depth && parseInt(analysis.depth, 10) >= 1) {
      if (isQuickEvalActive && analysis.score !== undefined) {
        const currentFen = gameHistory[currentMoveIndex] || chess?.fen();
        const normalizedScore = toWhitePerspective(analysis.score, analysis.score, currentFen);
        updateEvaluationBar(normalizedScore);
        cachePositionEvaluation(currentMoveIndex, {
          score: normalizedScore,
          depth: normalizeDepth(analysis.depth),
          fen: cleanFenForAnalysis(currentFen),
          normalized: true
        });
      } else {
        currentAnalysis = { ...currentAnalysis, ...analysis };
        updateAnalysisDisplay(analysis);
      }
    }
  }

  if (messageText.includes('bestmove')) {
    const bestMove = messageText.split(' ')[1];
    if (isQuickEvalActive) {
      isQuickEvalActive = false;
      if (quickEvalTimeout) {
        clearTimeout(quickEvalTimeout);
        quickEvalTimeout = null;
      }
    } else if (isAnalyzing) {
      displayFullAnalysis(bestMove);
      if (!isContinuousAnalysis) isAnalyzing = false;
      if (analysisTimeout) {
        clearTimeout(analysisTimeout);
        analysisTimeout = null;
      }
      const analyzeBtn = document.getElementById('analyzeBtn');
      if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze Position</span>';
    }
  }
};

const setupStockfish = () => {
  stockfish = createApiEngine();
  stockfish.onmessage = (event) => handleStockfishMessage(event.data || event);
  engineType = 'api';
  updateEngineStatus('Stockfish Chess Analysis API', true);
};

const onDragStart = (source, piece) => {
  if (chess.game_over()) return false;
  if ((chess.turn() === 'w' && piece.search(/^b/) !== -1) || (chess.turn() === 'b' && piece.search(/^w/) !== -1)) return false;
  return true;
};

const onDrop = (source, target) => {
  const move = chess.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';

  if (chess.in_check()) {
    playSound('check');
  } else if (move.flags.includes('k') || move.flags.includes('q')) {
    playSound('castle');
  } else if (move.captured) {
    playSound('capture');
  } else {
    playSound('move');
  }

  gameHistory = gameHistory.slice(0, currentMoveIndex + 1);
  prunePositionEvalCache(currentMoveIndex);
  gameHistory.push(chess.fen());
  currentMoveIndex = gameHistory.length - 1;

  updateMoveList();
  triggerQuickEval();
  evaluateLastMove();
  analyzeCurrentPosition();
};

const onSnapEnd = () => {
  board.position(chess.fen());
};

const initBoard = () => {
  board = Chessboard('board', {
    position: chess.fen(),
    pieceTheme: (piece) => `https://assets-themes.chess.com/image/ejgfv/150/${piece.toLowerCase()}.png`,
    draggable: true,
    onDragStart,
    onDrop,
    onSnapEnd
  });

  const boardElement = document.getElementById('board');
  if (!boardElement) return;

  let suppressRightDrag = false;
  boardElement.addEventListener('pointerdown', (e) => { suppressRightDrag = (e.button === 2); });
  boardElement.addEventListener('pointerup', () => { suppressRightDrag = false; });

  boardElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const target = e.target.closest('[class*="square-"]');
    if (target) target.classList.toggle('square-red-mark');
  });

  boardElement.addEventListener('click', (e) => {
    let target = e.target;
    if (target.tagName === 'IMG') target = target.parentElement;
    target = target.closest('[class*="square-"]');
    if (!target) return;

    const cls = Array.from(target.classList).find((c) => c.startsWith('square-'));
    if (!cls) return;
    const square = cls.split('-')[1];

    document.querySelectorAll('.square-selected').forEach((el) => el.classList.remove('square-selected'));

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
      const result = onDrop(selectedSquare, square);
      if (result !== 'snapback') board.position(chess.fen());
      selectedSquare = null;
    }
  });

  const originalOnDragStart = onDragStart;
  board.onDragStart = (source, piece, position, orientation, event) => {
    if (suppressRightDrag) return false;
    return originalOnDragStart(source, piece, position, orientation, event);
  };
};

const updateBoard = (skipAnalysis = false) => {
  if (!(board && gameHistory[currentMoveIndex])) return;
    chess.load(gameHistory[currentMoveIndex]);
    board.position(chess.fen());
  applyCachedEvaluationForMove(currentMoveIndex);
    if (!skipAnalysis) {
      triggerQuickEval();
      analyzeCurrentPosition();
    }
};

const updateMoveList = () => {
  const moveList = document.getElementById('moveList');
  if (!moveList) return;
  
  moveList.innerHTML = '';
  if (gameHistory.length <= 1) {
    moveList.innerHTML = '<div style="text-align: center; color: #94a3b8; font-style: italic; padding: 1rem;">No moves to display</div>';
    return;
  }
  
  const tempChess = new Chess();
  let moveNumber = 1;
  
  for (let i = 1; i < gameHistory.length; i += 1) {
    tempChess.load(gameHistory[i - 1]);
    const moveObj = tempChess.moves({ verbose: true }).find((move) => {
      const testChess = new Chess(gameHistory[i - 1]);
      testChess.move(move);
      return testChess.fen() === gameHistory[i];
    });
    if (!moveObj) continue;

      const moveDiv = document.createElement('div');
      moveDiv.className = 'move-item';
      if (i === currentMoveIndex) moveDiv.classList.add('active');
      
      const isWhite = i % 2 === 1;
      const displayNumber = isWhite ? `${moveNumber}.` : `${moveNumber}...`;
    if (!isWhite) moveNumber += 1;
      
      const moveIdx = i - 1;
      const hasAnalysis = moveAnalyses[moveIdx] && moveAnalyses[moveIdx].evaluation;
      const evalSymbol = hasAnalysis ? moveAnalyses[moveIdx].evaluation.symbol : '--';
      const evalColor = hasAnalysis ? moveAnalyses[moveIdx].evaluation.color : '#94a3b8';
      
      moveDiv.innerHTML = `
        <span class="move-notation">${displayNumber} ${moveObj.san}</span>
        <span class="move-evaluation" style="color: ${evalColor}">${evalSymbol}</span>
      `;
      
      if (hasAnalysis) {
        const evalSpan = moveDiv.querySelector('.move-evaluation');
        evalSpan.title = moveAnalyses[moveIdx].evaluation.text;
      }
      
      moveDiv.addEventListener('click', () => {
        currentMoveIndex = i;
        updateBoard();
        updateMoveList();
        clearHighlights();
      displayMoveAnalysis(i - 1);
      });
      
      moveList.appendChild(moveDiv);
    }
};

const analyzePosition = () => {
  if (!stockfish) {
    showToast('Engine not loaded yet', 'error');
    return;
  }
  
  if (isAnalyzing) {
    stockfish.postMessage('stop');
    isAnalyzing = false;
    hideLoadingOverlay();
    showToast('Analysis stopped', 'info');
    const analyzeBtn = document.getElementById('analyzeBtn');
    if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze All Moves</span>';
    clearHighlights();
    return;
  }
  
  isAnalyzing = true;
  showToast('Analyzing all moves in the game...', 'info');
  const analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🛑</span><span class="btn-text">Stop Analysis</span>';
  
  analyzeAllMoves();
  
  setTimeout(() => {
    const currentFen = gameHistory[currentMoveIndex];
    stockfish.postMessage('ucinewgame');
    stockfish.postMessage(`position fen ${currentFen}`);
    stockfish.postMessage(`go depth ${ENGINE_DEPTH}`);
  }, 500);
};

const analyzeCurrentPosition = () => {
  if (!stockfish || !chess) return;

  const nextRequestId = (typeof currentAnalysisContext.requestId === 'number'
    ? currentAnalysisContext.requestId + 1
    : 1);
  const currentFen = gameHistory[currentMoveIndex] || chess.fen();
  currentAnalysisContext = { index: currentMoveIndex, fen: currentFen, requestId: nextRequestId };
  currentAnalysis = {};

  if (!isContinuousAnalysis) {
    if (chess.game_over()) return;

    try {
      stockfish.postMessage('ucinewgame');
      stockfish.postMessage(`position fen ${currentFen}`);
      stockfish.postMessage(`go depth ${ENGINE_DEPTH} movetime ${QUICK_EVAL_TIME + 300}`);
      isAnalyzing = true;
    } catch {
      showToast('Unable to analyze position.', 'error');
    }
    return;
  }

  isAnalyzing = true;
  const analysisDisplay = document.getElementById('analysisDisplay');
  if (analysisDisplay) analysisDisplay.textContent = 'Analyzing position...';
  clearHighlights();
  
  stockfish.postMessage('ucinewgame');
  stockfish.postMessage(`position fen ${currentFen}`);
  
  if (engineType === 'mock') {
    stockfish.postMessage(`go depth ${ENGINE_DEPTH}`);
  } else {
    stockfish.postMessage('setoption name UCI_Variant value chess');
    stockfish.postMessage('setoption name UCI_AnalyseMode value true');
    stockfish.postMessage('go infinite');
    
    analysisTimeout = setTimeout(() => {
      if (!isAnalyzing) return;
        stockfish.postMessage('stop');
        isAnalyzing = false;
      setTimeout(() => generateEnhancedMockAnalysis(), 500);
    }, 5000);
  }
  
  setTimeout(() => {
    if (isAnalyzing && isContinuousAnalysis) stockfish.postMessage('stop');
  }, 3000);
};

const calculatePerformanceRating = () => {
  if (!moveAnalyses || Object.keys(moveAnalyses).length === 0) return null;

  const whiteEntries = [];
  const blackEntries = [];

  Object.keys(moveAnalyses).forEach((key) => {
          const analysis = moveAnalyses[key];
    if (!analysis) return;
    const moveIndex = parseInt(key, 10);
    if (Number.isNaN(moveIndex)) return;

    const evaluationScore = typeof analysis.evaluation?.score === 'number' ? analysis.evaluation.score : null;
    const cplValue = typeof analysis.cpl === 'number' ? analysis.cpl : null;
    const entry = { score: evaluationScore, cpl: cplValue };

    if (moveIndex % 2 === 0) whiteEntries.push(entry);
    else blackEntries.push(entry);
  });

  const mapScoresToElo = (scores) => {
    if (!scores.length) return null;
    const MU_REAL = 1500;
    const SIGMA_REAL = 400;
    const MU_PRED_BASELINE = 0.75;
    const meanScore = Math.min(1, Math.max(0, scores.reduce((sum, value) => sum + value, 0) / scores.length));
    const variance = scores.reduce((sum, value) => sum + ((value - meanScore) ** 2), 0) / scores.length;
    const sigma = Math.max(0.05, Math.sqrt(variance));
    const elo = MU_REAL + (SIGMA_REAL / sigma) * (meanScore - MU_PRED_BASELINE);
    return Math.round(Math.min(3000, Math.max(400, elo)));
  };

  const computeStats = (entries) => {
    if (!entries.length) return { rating: null, accuracy: null, acpl: null, moves: 0 };

    const scoreValues = entries.map((entry) => entry.score).filter((value) => typeof value === 'number');
    const cplValues = entries.map((entry) => entry.cpl).filter((value) => typeof value === 'number');

    const trimmedAcpl = cplValues.length ? trimmedMean(cplValues) : null;

    const accuracy = trimmedAcpl !== null
      ? accuracyFromAcpl(trimmedAcpl)
      : null;

    const acpl = trimmedAcpl;

    const rating = acpl != null ? eloFromAcpl(acpl) : null;

    return {
      rating,
      accuracy,
      acpl,
      moves: entries.length
    };
  };

  const stats = {
    white: computeStats(whiteEntries),
    black: computeStats(blackEntries)
  };

  const GAP_PER_ACC_PERCENT = 20;
  if (
    stats?.white?.rating != null &&
    stats?.black?.rating != null &&
    stats?.white?.accuracy != null &&
    stats?.black?.accuracy != null
  ) {
    const targetGap = GAP_PER_ACC_PERCENT * (stats.black.accuracy - stats.white.accuracy);
    const mid = (stats.white.rating + stats.black.rating) / 2;
    stats.white.rating = Math.round(mid - targetGap / 2);
    stats.black.rating = Math.round(mid + targetGap / 2);
  }

  return stats;
};

const ensurePerformanceOverviewStyle = () => {
  if (document.getElementById('performance-overview-style')) return;
  const style = document.createElement('style');
  style.id = 'performance-overview-style';
  style.textContent = `
    #performanceOverview {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      padding: 12px 16px;
      background: rgba(15, 23, 42, 0.7);
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      backdrop-filter: blur(6px);
      flex-wrap: wrap;
    }
    #performanceOverview .performance-card {
      flex: 1 1 240px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #performanceOverview .performance-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-weight: 600;
      color: #f8fafc;
    }
    #performanceOverview .performance-label {
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.85;
    }
    #performanceOverview .performance-rating {
      font-size: 18px;
      font-weight: 700;
    }
    #performanceOverview .performance-meter {
      height: 8px;
      background: rgba(148, 163, 184, 0.25);
      border-radius: 999px;
      overflow: hidden;
      position: relative;
    }
    #performanceOverview .performance-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      border-radius: 999px;
      transition: width 0.35s ease;
      opacity: 0.15;
    }
    #performanceOverview .performance-card[data-side="white"] .performance-fill {
      background: linear-gradient(90deg, #60a5fa, #38bdf8);
    }
    #performanceOverview .performance-card[data-side="black"] .performance-fill {
      background: linear-gradient(90deg, #f97316, #fb7185);
    }
    #performanceOverview .performance-metrics {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #e2e8f0;
      opacity: 0.85;
    }
    @media (max-width: 720px) {
      #performanceOverview {
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);
};

const ensurePerformanceOverview = () => {
  if (performanceOverviewEl && performanceElements) return performanceOverviewEl;
  const moveList = document.getElementById('moveList');
  if (!moveList || !moveList.parentElement) return null;

  ensurePerformanceOverviewStyle();

  performanceOverviewEl = document.createElement('div');
  performanceOverviewEl.id = 'performanceOverview';
  performanceOverviewEl.innerHTML = `
    <div class="performance-card" data-side="white">
      <div class="performance-header">
        <span class="performance-label">White</span>
        <span class="performance-rating">--</span>
      </div>
      <div class="performance-meter">
        <div class="performance-fill"></div>
      </div>
      <div class="performance-metrics">
        <span class="performance-accuracy">Accuracy: --</span>
        <span class="performance-acpl">ACPL: --</span>
      </div>
    </div>
    <div class="performance-card" data-side="black">
      <div class="performance-header">
        <span class="performance-label">Black</span>
        <span class="performance-rating">--</span>
      </div>
      <div class="performance-meter">
        <div class="performance-fill"></div>
      </div>
      <div class="performance-metrics">
        <span class="performance-accuracy">Accuracy: --</span>
        <span class="performance-acpl">ACPL: --</span>
      </div>
    </div>
  `;

  moveList.parentElement.insertBefore(performanceOverviewEl, moveList);

  performanceElements = {
    white: {
      rating: performanceOverviewEl.querySelector('[data-side="white"] .performance-rating'),
      accuracy: performanceOverviewEl.querySelector('[data-side="white"] .performance-accuracy'),
      acpl: performanceOverviewEl.querySelector('[data-side="white"] .performance-acpl'),
      fill: performanceOverviewEl.querySelector('[data-side="white"] .performance-fill')
    },
    black: {
      rating: performanceOverviewEl.querySelector('[data-side="black"] .performance-rating'),
      accuracy: performanceOverviewEl.querySelector('[data-side="black"] .performance-accuracy'),
      acpl: performanceOverviewEl.querySelector('[data-side="black"] .performance-acpl'),
      fill: performanceOverviewEl.querySelector('[data-side="black"] .performance-fill')
    }
  };

  return performanceOverviewEl;
};

const updatePerformanceOverview = (stats) => {
  const container = ensurePerformanceOverview();
  if (!container || !performanceElements) return;

  const updateSide = (sideKey) => {
    const elements = performanceElements[sideKey];
    if (!elements) return;
    const sideStats = stats && stats[sideKey] ? stats[sideKey] : null;

    if (sideStats && sideStats.rating !== null) {
      elements.rating.textContent = sideStats.rating;
      const percent = Math.max(0, Math.min(100, ((sideStats.rating - 400) / (3000 - 400)) * 100));
      elements.fill.style.width = `${percent}%`;
      elements.fill.style.opacity = 1;
    } else {
      elements.rating.textContent = '--';
      elements.fill.style.width = '0%';
      elements.fill.style.opacity = 0.15;
    }

    if (sideStats && sideStats.accuracy !== null) {
      elements.accuracy.textContent = `Accuracy: ${sideStats.accuracy.toFixed(1)}%`;
    } else {
      elements.accuracy.textContent = 'Accuracy: --';
    }

    if (sideStats && sideStats.acpl !== null) {
      elements.acpl.textContent = `ACPL: ${sideStats.acpl.toFixed(1)}`;
    } else {
      elements.acpl.textContent = 'ACPL: --';
    }
  };

  updateSide('white');
  updateSide('black');
};

const showLoadingOverlay = () => {
  if (document.getElementById('loadingOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.innerHTML = `
    <div class="loading-content">
      <div class="spinner"></div>
      <h3>Analyzing Game...</h3>
      <p id="loadingProgress">Initializing...</p>
    </div>
  `;
  document.body.appendChild(overlay);

  if (!document.querySelector('#loading-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'loading-overlay-style';
    style.textContent = `
      #loadingOverlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(10px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease-in;
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      .loading-content { text-align: center; color: white; }
      .spinner {
        width: 60px;
        height: 60px;
        border: 5px solid rgba(255, 255, 255, 0.2);
        border-top-color: #60a5fa;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .loading-content h3 { font-size: 24px; margin-bottom: 10px; }
      .loading-content p { font-size: 16px; color: #94a3b8; }
    `;
    document.head.appendChild(style);
  }
};

const hideLoadingOverlay = () => {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.style.animation = 'fadeOut 0.3s ease-out';
  setTimeout(() => overlay.remove(), 300);
};

const updateLoadingProgress = (text) => {
  const progress = document.getElementById('loadingProgress');
  if (progress) progress.textContent = text;
};

const loadGame = () => {
  const pgnInput = document.getElementById('pgnInput').value.trim();
  const fenInput = document.getElementById('fenInput').value.trim();

  try {
    chess = new Chess();
    moveAnalyses = {};
    resetPositionEvalCache();
    updatePerformanceOverview(null);

    if (fenInput) {
      chess.load(fenInput);
      gameHistory = [chess.fen()];
      currentMoveIndex = 0;
      updateBoard(true);
      updateMoveList();
      const analysisDisplay = document.getElementById('analysisDisplay');
      if (analysisDisplay) analysisDisplay.textContent = 'Position loaded! This is a specific position - use navigation buttons to move through the game.';
    } else if (pgnInput) {
      const whiteMatch = pgnInput.match(/\[White\s+"([^\"]+)"\]/);
      const blackMatch = pgnInput.match(/\[Black\s+"([^\"]+)"\]/);
      gameMetadata.white = whiteMatch ? whiteMatch[1] : 'White';
      gameMetadata.black = blackMatch ? blackMatch[1] : 'Black';

      if (chess.load_pgn(pgnInput)) {
        const history = chess.history();
        chess = new Chess();
        gameHistory = [chess.fen()];
        history.forEach((move) => {
          const moveObj = chess.move(move);
          if (moveObj) gameHistory.push(chess.fen());
        });
        currentMoveIndex = gameHistory.length - 1;
      } else {
        chess = new Chess();
        const moves = pgnInput.split(/\s+/).filter((m) => !m.match(/^\d+\./) && m.trim());
        gameHistory = [chess.fen()];
        moves.forEach((move) => {
          try {
            const cleanMove = move.replace(/[+#!?]/g, '');
            const moveObj = chess.move(cleanMove);
            if (moveObj) gameHistory.push(chess.fen());
          } catch {
            /* ignore invalid moves */
          }
        });
        currentMoveIndex = gameHistory.length - 1;
      }
    } else {
      throw new Error('Please enter PGN moves or FEN position');
    }

    updateBoard(true);
    updateMoveList();
    clearHighlights();

    const evalBarBoard = document.getElementById('evalBarFill');
    const evalScoreBoard = document.getElementById('evalScoreBoard');
    if (evalBarBoard) {
      evalBarBoard.style.width = '50%';
      evalBarBoard.style.background = 'linear-gradient(90deg, #f44336, #4CAF50)';
    }
    if (evalScoreBoard) {
      evalScoreBoard.textContent = '+0.00';
      evalScoreBoard.style.color = '#ffffff';
      evalScoreBoard.style.backgroundColor = 'rgba(100, 181, 246, 0.2)';
    }

    if (gameHistory.length > 1) {
      showToast('Game loaded successfully! Starting analysis...', 'success');
      analyzeAllMoves();
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
};

const showGameSelectionDialog = (games) => {
  const dialog = document.createElement('div');
  dialog.className = 'chesscom-dialog';
  dialog.innerHTML = `
    <div class="chesscom-dialog-content">
      <h3>Select a Game (${games.length} games found)</h3>
      <div class="chesscom-games-list">
        ${games.map((game, idx) => `
          <div class="chesscom-game-item" data-index="${idx}">
            <div class="chesscom-game-header">
              <strong>${game.Event || 'Game'}</strong>
              ${game.Date ? `<span>${game.Date}</span>` : ''}
            </div>
            <div class="chesscom-game-players">
              ${game.White || 'White'} vs ${game.Black || 'Black'}
            </div>
            ${game.Result ? `<div class="chesscom-game-result">${game.Result}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <button class="btn btn-secondary chesscom-close-btn">Cancel</button>
    </div>
  `;
  document.body.appendChild(dialog);
  
  dialog.querySelectorAll('.chesscom-game-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index, 10);
      loadSelectedGame(games[idx]);
      dialog.remove();
    });
  });
  
  dialog.querySelector('.chesscom-close-btn').addEventListener('click', () => dialog.remove());
  
  if (!document.querySelector('#chesscom-dialog-style')) {
    const style = document.createElement('style');
    style.id = 'chesscom-dialog-style';
    style.textContent = `
      .chesscom-dialog {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }
      .chesscom-dialog-content {
        background: #1e293b;
        border-radius: 12px;
        padding: 24px;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
      }
      .chesscom-games-list { margin: 16px 0; }
      .chesscom-game-item {
        background: #334155;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .chesscom-game-item:hover { background: #475569; }
      .chesscom-game-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .chesscom-game-players { color: #94a3b8; font-size: 14px; }
      .chesscom-game-result { margin-top: 4px; color: #60a5fa; font-weight: bold; }
    `;
    document.head.appendChild(style);
  }
};

const loadSelectedGame = (game) => {
  document.getElementById('pgnInput').value = game.pgn;
  loadGame();
  showToast('Game loaded from Chess.com!', 'success');
};

const loadChessComGames = async () => {
  const username = prompt('Enter Chess.com username:');
  if (!username) return;

  const months = ['10', '11', '12'];
  const allGames = [];

  showToast('Fetching games from Chess.com...', 'info');

  try {
    for (const month of months) {
      const response = await fetch(`/api/chesscom?username=${username}&year=2025&month=${month}`);
      const data = await response.json();
      if (data.games && data.games.length > 0) allGames.push(...data.games);
      await delay(500);
    }

    if (allGames.length === 0) {
      showToast('No games found for this user', 'info');
      return;
    }

    showGameSelectionDialog(allGames);
  } catch {
    showToast('Failed to fetch games from Chess.com', 'error');
  }
};

const clearGame = () => {
  if (isAnalyzing) {
    stockfish.postMessage('stop');
    isAnalyzing = false;
  }
  if (isContinuousAnalysis) {
    isContinuousAnalysis = false;
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
  resetPositionEvalCache();
  updatePerformanceOverview(null);
  
  document.getElementById('pgnInput').value = '';
  document.getElementById('fenInput').value = '';
  const analysisDisplay = document.getElementById('analysisDisplay');
  if (analysisDisplay) analysisDisplay.textContent = 'Load a game and click "Analyze Position" to see engine analysis...';

  const analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn) analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Suggest Move</span>';
  
  updateBoard(true);
  updateMoveList();
  clearHighlights();
  
  const evalBarBoard = document.getElementById('evalBarFill');
  const evalScoreBoard = document.getElementById('evalScoreBoard');
  if (evalBarBoard) {
    evalBarBoard.style.width = '50%';
    evalBarBoard.style.background = 'linear-gradient(90deg, #f44336, #4CAF50)';
  }
  if (evalScoreBoard) {
    evalScoreBoard.textContent = '+0.00';
    evalScoreBoard.style.color = '#ffffff';
    evalScoreBoard.style.backgroundColor = 'rgba(100, 181, 246, 0.2)';
  }
  
  showToast('Board cleared', 'info');
};

const handleKeyboard = (event) => {
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      prevMove();
      break;
    case 'ArrowRight':
      event.preventDefault();
      nextMove();
      break;
    case 'Home':
      event.preventDefault();
      firstMove();
      break;
    case 'End':
      event.preventDefault();
      lastMove();
      break;
    case 'a':
    case 'A':
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        analyzePosition();
      }
      break;
    case 'Escape':
      if (isAnalyzing) {
        event.preventDefault();
        analyzePosition();
      }
      break;
    default:
      break;
  }
};

const setupUIListeners = () => {
  document.getElementById('loadGameBtn')?.addEventListener('click', loadGame);
  document.getElementById('clearBtn')?.addEventListener('click', clearGame);
  document.getElementById('analyzeBtn')?.addEventListener('click', analyzePosition);
  document.getElementById('chesscomBtn')?.addEventListener('click', loadChessComGames);

  document.getElementById('firstBtn')?.addEventListener('click', firstMove);
  document.getElementById('prevBtn')?.addEventListener('click', prevMove);
  document.getElementById('nextBtn')?.addEventListener('click', nextMove);
  document.getElementById('lastBtn')?.addEventListener('click', lastMove);

  document.addEventListener('keydown', handleKeyboard);

  const pgnInput = document.getElementById('pgnInput');
  if (pgnInput) {
    pgnInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) loadGame();
    });
  }

  const fenInput = document.getElementById('fenInput');
  if (fenInput) {
    fenInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadGame();
    });
  }
};

const initialize = () => {
  chess = new Chess();
  initBoard();
  setupStockfish();
  setupUIListeners();
  ensurePerformanceOverview();
  updatePerformanceOverview(null);
  
  setTimeout(() => {
    showToast('Game Review ready! Load a game to start analyzing.', 'success');
  }, 2000);
};

document.addEventListener('DOMContentLoaded', initialize);

const accuracyFromAcpl = (acpl) => {
  if (acpl == null || !Number.isFinite(acpl)) return null;
  const x = Math.max(1, acpl);
  const accuracy = 103 - 16 * Math.log(x + 15);
  return Math.min(100, Math.max(0, accuracy));
};

const eloFromAcpl = (acpl) => {
  if (acpl == null || !Number.isFinite(acpl)) return null;
  const A = 2850;
  const B = 420;
  const ACPL0 = 10;
  const elo = A - B * Math.log(Math.max(acpl, 1) / ACPL0);
  return Math.round(Math.min(3000, Math.max(400, elo)));
};
