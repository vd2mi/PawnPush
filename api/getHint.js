import { Chess } from 'chess.js';

function isInCheck(chess) {
  if (typeof chess.in_check === "function") return chess.in_check();
  if (typeof chess.inCheck === "function") return chess.inCheck();
  if (typeof chess.isCheck === "function") return chess.isCheck();
  return false;
}

function sanitizeMove(move) {
  if (!move) return "";
  let cleaned = move.toLowerCase().trim();
  
  if (cleaned.includes('=')) {
    const parts = cleaned.split('=');
    if (parts.length === 2) {
      const movePart = parts[0].replace(/[^a-h1-8]/g, "");
      const promoPart = parts[1].replace(/[^qrnb]/g, "");
      if (movePart.length >= 4 && promoPart.length === 1) {
        cleaned = movePart + promoPart;
      }
    }
  }
  
  cleaned = cleaned.replace(/[^a-h1-8=qrnb]/g, "");
  cleaned = cleaned.replace(/=+/g, "");
  
  if (cleaned.length > 4) {
    const base = cleaned.substring(0, 4);
    const promo = cleaned.substring(4).replace(/[^qrnb]/g, "");
    cleaned = base + (promo ? promo[0] : "");
  }
  
  return cleaned;
}

function validateMove(fen, move) {
  if (!move) return null;
  
  try {
    const sanitizedMove = sanitizeMove(move);
    if (sanitizedMove.length < 4) return null;
    
    const from = sanitizedMove.substring(0, 2);
    const to = sanitizedMove.substring(2, 4);
    
    if (from.length !== 2 || to.length !== 2) return null;
    
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });
    const isLegal = legalMoves.some(m => m.from === from && m.to === to);
    
    return isLegal ? sanitizedMove : null;
  } catch (error) {
    return null;
  }
}

function validatePVMoves(fen, pvMoves) {
  if (!Array.isArray(pvMoves) || pvMoves.length === 0) return [];
  
  const validated = [];
  let currentFen = fen;
  
  for (const move of pvMoves) {
    const validatedMove = validateMove(currentFen, move);
    if (!validatedMove) break;
    
    validated.push(validatedMove);
    
    try {
      const chess = new Chess(currentFen);
      const from = validatedMove.substring(0, 2);
      const to = validatedMove.substring(2, 4);
      const promotion = validatedMove.length > 4 ? validatedMove.substring(4) : undefined;
      const moveObj = chess.move({ from, to, promotion: promotion || 'q' });
      if (moveObj) {
        currentFen = chess.fen();
      } else {
        break;
      }
    } catch (error) {
      break;
    }
  }
  
  return validated;
}

function getPieceName(pieceType) {
  const names = {
    'p': 'pawn',
    'r': 'rook',
    'n': 'knight',
    'b': 'bishop',
    'q': 'queen',
    'k': 'king'
  };
  return names[pieceType] || 'piece';
}

function getPieceValue(pieceType) {
  const values = {
    'pawn': 1,
    'knight': 3,
    'bishop': 3,
    'rook': 5,
    'queen': 9,
    'king': 100
  };
  return values[pieceType] || 0;
}

function squareToCoords(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]);
  return { file, rank };
}

function coordsToSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return String.fromCharCode(97 + file) + rank;
}

function buildPseudoLegalAttackMap(chess) {
  const attackMap = new Map();
  const allSquares = [];
  
  for (let r = 1; r <= 8; r++) {
    for (let f = 0; f < 8; f++) {
      allSquares.push(coordsToSquare(f, r));
    }
  }
  
  for (const square of allSquares) {
    const piece = chess.get(square);
    if (!piece) continue;
    
    const attackedSquares = getPseudoLegalAttacks(chess, square, piece);
    
    for (const targetSquare of attackedSquares) {
      if (!attackMap.has(targetSquare)) {
        attackMap.set(targetSquare, []);
      }
      attackMap.get(targetSquare).push({
        square,
        color: piece.color === 'w' ? 'white' : 'black',
        type: getPieceName(piece.type)
      });
    }
  }
  
  return attackMap;
}

function buildDefenseMap(chess, attackMap) {
  const defenseMap = new Map();
  
  for (const [square, attackers] of attackMap.entries()) {
    const piece = chess.get(square);
    if (!piece) continue;
    
    const defenders = attackers.filter(a => {
      const attackerPiece = chess.get(a.square);
      return attackerPiece && attackerPiece.color === piece.color;
    });
    
    if (defenders.length > 0) {
      defenseMap.set(square, defenders);
    }
  }
  
  return defenseMap;
}

function getPseudoLegalAttacks(chess, square, piece) {
  const attackedSquares = new Set();
  const { file, rank } = squareToCoords(square);
  const pieceType = piece.type;
  const pieceColor = piece.color;
  
  if (pieceType === 'p') {
    const direction = pieceColor === 'w' ? 1 : -1;
    const leftFile = file - 1;
    const rightFile = file + 1;
    const newRank = rank + direction;
    
    if (leftFile >= 0 && newRank >= 1 && newRank <= 8) {
      attackedSquares.add(coordsToSquare(leftFile, newRank));
    }
    if (rightFile <= 7 && newRank >= 1 && newRank <= 8) {
      attackedSquares.add(coordsToSquare(rightFile, newRank));
    }
  } else if (pieceType === 'n') {
    const knightMoves = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [df, dr] of knightMoves) {
      const targetSquare = coordsToSquare(file + df, rank + dr);
      if (targetSquare) attackedSquares.add(targetSquare);
    }
  } else if (pieceType === 'k') {
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const targetSquare = coordsToSquare(file + df, rank + dr);
        if (targetSquare) attackedSquares.add(targetSquare);
      }
    }
  } else {
    const directions = [];
    if (pieceType === 'r' || pieceType === 'q') {
      directions.push([0, 1], [0, -1], [1, 0], [-1, 0]);
    }
    if (pieceType === 'b' || pieceType === 'q') {
      directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    
    for (const [df, dr] of directions) {
      for (let i = 1; i < 8; i++) {
        const targetSquare = coordsToSquare(file + df * i, rank + dr * i);
        if (!targetSquare) break;
        
        attackedSquares.add(targetSquare);
        
        if (chess.get(targetSquare)) break;
      }
    }
  }
  
  return Array.from(attackedSquares).filter(Boolean);
}

function getKingSquare(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.type === 'k' && piece.color === color) {
        return coordsToSquare(c, 8 - r);
      }
    }
  }
  return null;
}

function isSquareAttackedByColor(chess, square, attackerColor, attackMap) {
  const attackers = attackMap.get(square) || [];
  return attackers.some(a => a.color === attackerColor);
}

function isPinned(chess, square, pieceColor, attackMap) {
  try {
    const kingColor = pieceColor === 'white' ? 'w' : 'b';
    const kingSquare = getKingSquare(chess, kingColor);
    if (!kingSquare) return false;
    
    const originalPiece = chess.get(square);
    if (!originalPiece || originalPiece.type === 'k') return false;
    
    const test = new Chess(chess.fen());
    const attackerColor = pieceColor === 'white' ? 'black' : 'white';
    
    const attackMapBefore = buildPseudoLegalAttackMap(test);
    const kingAttackedBefore = isSquareAttackedByColor(test, kingSquare, attackerColor, attackMapBefore);
    
    test.remove(square);
    const attackMapAfter = buildPseudoLegalAttackMap(test);
    const kingAttackedAfter = isSquareAttackedByColor(test, kingSquare, attackerColor, attackMapAfter);
    
    return !kingAttackedBefore && kingAttackedAfter;
  } catch (error) {
    return false;
  }
}

function detectForks(chess, piece, attackMap) {
  const forks = [];
  
  if (piece.attacksPieces.length < 2) return forks;
  
  const attackedPieces = piece.attacksPieces.map(desc => {
    const match = desc.match(/(\w+) (\w+) on (\w+)/);
    if (match) {
      return { color: match[1], type: match[2], square: match[3] };
    }
    return null;
  }).filter(Boolean);
  
  if (attackedPieces.length < 2) return forks;
  
  for (let i = 0; i < attackedPieces.length; i++) {
    for (let j = i + 1; j < attackedPieces.length; j++) {
      const p1 = attackedPieces[i];
      const p2 = attackedPieces[j];
      
      const canCapture1 = piece.attacks.includes(p1.square.toLowerCase());
      const canCapture2 = piece.attacks.includes(p2.square.toLowerCase());
      
      if (canCapture1 && canCapture2) {
        forks.push(`${p1.color} ${p1.type} on ${p1.square}`, `${p2.color} ${p2.type} on ${p2.square}`);
      }
    }
  }
  
  return forks;
}

function detectSkewer(chess, piece, allPieces, attackMap) {
  if (piece.type === 'pawn' || piece.type === 'knight' || piece.type === 'king') {
    return false;
  }
  
  if (piece.attacksPieces.length !== 1) return false;
  
  const attackedDesc = piece.attacksPieces[0];
  const match = attackedDesc.match(/(\w+) (\w+) on (\w+)/);
  if (!match) return false;
  
  const attackedSquare = match[3].toLowerCase().trim();
  const attackedPiece = allPieces.find(p => p.square.toLowerCase().trim() === attackedSquare);
  if (!attackedPiece) return false;
  
  const direction = getDirection(piece.square, attackedSquare);
  if (!direction) return false;
  
  const lineSquares = [];
  let checkSquare = getNextSquare(piece.square, direction);
  while (checkSquare && checkSquare !== attackedSquare) {
    lineSquares.push(checkSquare);
    checkSquare = getNextSquare(checkSquare, direction);
  }
  
  const hasEnemyBlockers = lineSquares.some(sq => {
    const blocker = chess.get(sq);
    return blocker && blocker.color !== piece.color;
  });
  
  if (hasEnemyBlockers) return false;
  
  const attackedValue = getPieceValue(attackedPiece.type);
  if (attackedValue < 5 && attackedPiece.type !== 'king') return false;
  
  const oppositeDir = getOppositeDirection(direction);
  if (!oppositeDir) return false;
  
  let current = getNextSquare(attackedSquare, oppositeDir);
  let behindPiece = null;
  let behindSquare = null;
  
  while (current) {
    const p = chess.get(current);
    if (p) {
      if (p.color === attackedPiece.color) {
        behindPiece = p;
        behindSquare = current;
      }
      break;
    }
    current = getNextSquare(current, oppositeDir);
  }
  
  if (!behindPiece || !behindSquare) return false;
  
  const behindValue = getPieceValue(behindPiece.type);
  const isValidSkewer = (behindValue < attackedValue || (behindPiece.type === 'king' && attackedPiece.type !== 'king')) ||
                        (attackedPiece.type === 'king' && behindValue > 0);
  
  if (!isValidSkewer) return false;
  
  const attackedColorCode = attackedPiece.color === 'white' ? 'w' : 'b';
  const canInterpose = chess.moves({ verbose: true })
    .some(m => m.to === behindSquare && m.color === attackedColorCode);
  
  return !canInterpose;
}

function isOverloaded(chess, piece, attackMap, defenseMap) {
  if (piece.type === 'king') return false;
  
  const criticalThreats = [];
  
  const defenders = defenseMap.get(piece.square) || [];
  const attackers = attackMap.get(piece.square) || [];
  const enemyAttackers = attackers.filter(a => a.color !== piece.color);
  
  for (const defender of defenders) {
    const defendedSquare = defender.square;
    const defendersOfDefended = defenseMap.get(defendedSquare) || [];
    const attackersOfDefended = attackMap.get(defendedSquare) || [];
    const enemyAttackersOfDefended = attackersOfDefended.filter(a => a.color !== piece.color);
    
    if (enemyAttackersOfDefended.length > defendersOfDefended.length) {
      criticalThreats.push(defendedSquare);
    }
  }
  
  for (const pieceDesc of piece.defendsPieces) {
    const match = pieceDesc.match(/(\w+) (\w+) on (\w+)/);
    if (match) {
      const defendedSquare = match[3];
      const defendersOfDefended = defenseMap.get(defendedSquare) || [];
      const attackersOfDefended = attackMap.get(defendedSquare) || [];
      const enemyAttackersOfDefended = attackersOfDefended.filter(a => a.color !== piece.color);
      
      if (enemyAttackersOfDefended.length > defendersOfDefended.length) {
        criticalThreats.push(defendedSquare);
      }
    }
  }
  
  if (criticalThreats.length < 2) return false;
  
  const testChess = new Chess(chess.fen());
  testChess.remove(piece.square);
  const testAttackMap = buildPseudoLegalAttackMap(testChess);
  const testDefenseMap = buildDefenseMap(testChess, testAttackMap);
  
  let undefendedAfterRemoval = 0;
  for (const threatSquare of criticalThreats) {
    const defendersAfter = testDefenseMap.get(threatSquare) || [];
    const attackersAfter = testAttackMap.get(threatSquare) || [];
    const enemyAttackersAfter = attackersAfter.filter(a => a.color !== piece.color);
    
    if (enemyAttackersAfter.length > defendersAfter.length) {
      undefendedAfterRemoval++;
    }
  }
  
  return undefendedAfterRemoval >= 2;
}

function getDirection(from, to) {
  const fromCoords = squareToCoords(from);
  const toCoords = squareToCoords(to);
  
  const fileDiff = toCoords.file - fromCoords.file;
  const rankDiff = toCoords.rank - fromCoords.rank;
  
  if (fileDiff === 0 && rankDiff !== 0) {
    return rankDiff > 0 ? 'up' : 'down';
  } else if (rankDiff === 0 && fileDiff !== 0) {
    return fileDiff > 0 ? 'right' : 'left';
  } else if (Math.abs(fileDiff) === Math.abs(rankDiff)) {
    if (fileDiff > 0 && rankDiff > 0) return 'up-right';
    if (fileDiff > 0 && rankDiff < 0) return 'down-right';
    if (fileDiff < 0 && rankDiff > 0) return 'up-left';
    if (fileDiff < 0 && rankDiff < 0) return 'down-left';
  }
  
  return null;
}

function getNextSquare(square, direction) {
  const { file, rank } = squareToCoords(square);
  
  let newFile = file;
  let newRank = rank;
  
  if (direction === 'up') newRank++;
  else if (direction === 'down') newRank--;
  else if (direction === 'right') newFile++;
  else if (direction === 'left') newFile--;
  else if (direction === 'up-right') { newFile++; newRank++; }
  else if (direction === 'up-left') { newFile--; newRank++; }
  else if (direction === 'down-right') { newFile++; newRank--; }
  else if (direction === 'down-left') { newFile--; newRank--; }
  
  return coordsToSquare(newFile, newRank);
}

function getSquareBetween(from, to, chess) {
  const direction = getDirection(from, to);
  if (!direction) return null;
  
  let current = getNextSquare(from, direction);
  while (current && current !== to) {
    const piece = chess.get(current);
    if (piece) return current;
    current = getNextSquare(current, direction);
  }
  
  return null;
}

function getOppositeDirection(dir) {
  const opposites = {
    'up': 'down',
    'down': 'up',
    'left': 'right',
    'right': 'left',
    'up-right': 'down-left',
    'up-left': 'down-right',
    'down-right': 'up-left',
    'down-left': 'up-right'
  };
  return opposites[dir] || null;
}

function parseEval(evaluation) {
  if (!evaluation) return 0;
  
  if (evaluation.type === 'mate') {
    return evaluation.value > 0 ? 10000 : -10000;
  }
  
  if (evaluation.type === 'cp') {
    return evaluation.value / 100;
  }
  
  return 0;
}

function formatEval(evaluation) {
  if (!evaluation) return 'Unknown';
  
  if (evaluation.type === 'mate') {
    const mateIn = Math.abs(evaluation.value);
    return evaluation.value > 0 ? `M${mateIn}` : `-M${mateIn}`;
  }
  
  if (evaluation.type === 'cp') {
    const score = (evaluation.value / 100).toFixed(1);
    return evaluation.value > 0 ? `+${score}` : score;
  }
  
  return 'Unknown';
}

function recoverPV(analysisResult, fen, hfToken) {
  if (analysisResult.principalVariation.length > 0 && analysisResult.principalVariation[0] !== undefined) {
    return Promise.resolve(analysisResult);
  }
  
  if (analysisResult.topMoves?.[0]?.pv?.length > 0) {
    analysisResult.principalVariation = analysisResult.topMoves[0].pv;
    return Promise.resolve(analysisResult);
  }
  
  return analyzePosition({
    fen,
    depth: 20,
    multipv: 1,
    purpose: "pv_recovery",
    hfToken
  }).then(recovery => {
    analysisResult.principalVariation = recovery.principalVariation;
    analysisResult.topMoves = recovery.topMoves;
    return analysisResult;
  });
}

async function analyzePosition({ fen, depth, multipv, purpose, hfToken }) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 25000);

    const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hfToken}`
      },
      body: JSON.stringify({ 
        fen, 
        depth: depth || 18,
        multipv: multipv || 3
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stockfish API error:', errorText);
      throw new Error(`Stockfish API error: ${response.status}`);
    }

    const data = await response.json();
    
    const bestMoveRaw = data.best_move || null;
    const bestMove = validateMove(fen, bestMoveRaw);
    
    let evaluation = null;
    let isMate = false;
    let mateIn = null;
    let evalScore = 0;
    
    if (data.evaluation) {
      if (data.evaluation.type === 'cp') {
        evalScore = data.evaluation.value;
        evaluation = (evalScore / 100).toFixed(1);
        if (evalScore > 0) evaluation = '+' + evaluation;
      } else if (data.evaluation.type === 'mate') {
        isMate = true;
        mateIn = Math.abs(data.evaluation.value);
        evaluation = data.evaluation.value > 0 ? `M${mateIn}` : `-M${mateIn}`;
        evalScore = data.evaluation.value > 0 ? 10000 : -10000;
      }
    }

    const principalVariation = data.pv || 
                               data.principal_variation || 
                               data.principalVariation || 
                               [];

    const validatedPV = validatePVMoves(fen, principalVariation);
    const clampedPV = validatedPV.slice(0, Math.min(validatedPV.length, 4));

    let topMoves = [];
    if (data.lines && Array.isArray(data.lines)) {
      topMoves = data.lines.slice(0, multipv || 3).map(line => {
        const linePV = line.pv || line.principal_variation || line.principalVariation || [];
        const validatedLinePV = validatePVMoves(fen, linePV);
        const clampedLinePV = validatedLinePV.slice(0, Math.min(validatedLinePV.length, 4));
        const validatedMove = validateMove(fen, line.move || line.best_move || bestMoveRaw);
        return {
          move: validatedMove,
          evaluation: formatEval(line.evaluation || data.evaluation),
          evalScore: parseEval(line.evaluation || data.evaluation),
          pv: clampedLinePV
        };
      }).filter(m => m.move);
    } else if (data.multipv && Array.isArray(data.multipv)) {
      topMoves = data.multipv.slice(0, multipv || 3).map(line => {
        const linePV = line.pv || line.principal_variation || line.principalVariation || [];
        const validatedLinePV = validatePVMoves(fen, linePV);
        const clampedLinePV = validatedLinePV.slice(0, Math.min(validatedLinePV.length, 4));
        const validatedMove = validateMove(fen, line.move || line.best_move || bestMoveRaw);
        return {
          move: validatedMove,
          evaluation: formatEval(line.evaluation || data.evaluation),
          evalScore: parseEval(line.evaluation || data.evaluation),
          pv: clampedLinePV
        };
      }).filter(m => m.move);
    } else {
      topMoves = bestMove ? [{
        move: bestMove,
        evaluation: formatEval(data.evaluation),
        evalScore: parseEval(data.evaluation),
        pv: clampedPV
      }] : [];
    }

    return {
      bestMove: bestMove || bestMoveRaw,
      evaluation,
      evalScore,
      isMate,
      mateIn,
      topMoves: topMoves.map(m => ({
        move: m.move,
        evaluation: m.evaluation,
        evalScore: m.evalScore,
        pv: m.pv
      })),
      principalVariation: clampedPV,
      purpose
    };

  } catch (error) {
    console.error('Stockfish analysis failed:', error);
    if (error.name === 'AbortError') {
      throw new Error('Stockfish analysis timeout');
    }
    throw error;
  }
}

function filterFactsForSideToMove(positionFacts, turn) {
  if (!positionFacts.pieces) return positionFacts;
  
  const filteredPieces = positionFacts.pieces.filter(p => p.color === turn);
  
  return {
    ...positionFacts,
    pieces: filteredPieces
  };
}

function getAllLegalSquares() {
  const squares = [];
  for (let r = 1; r <= 8; r++) {
    for (let f = 0; f < 8; f++) {
      squares.push(coordsToSquare(f, r));
    }
  }
  return squares;
}

function extractTacticsFromFacts(positionFacts) {
  const tactics = {
    forks: [],
    pins: [],
    skewers: [],
    hanging: [],
    overloaded: []
  };
  
  if (!positionFacts.pieces) return tactics;
  
  for (const piece of positionFacts.pieces) {
    if (piece.forks && piece.forks.length > 0) {
      tactics.forks.push(`${piece.color} ${piece.type} on ${piece.square}: ${piece.forks.join(', ')}`);
    }
    if (piece.pinned) {
      tactics.pins.push(`${piece.color} ${piece.type} on ${piece.square}`);
    }
    if (piece.skewer) {
      tactics.skewers.push(`${piece.color} ${piece.type} on ${piece.square}`);
    }
    if (piece.hanging) {
      tactics.hanging.push(`${piece.color} ${piece.type} on ${piece.square}`);
    }
    if (piece.overloaded) {
      tactics.overloaded.push(`${piece.color} ${piece.type} on ${piece.square}`);
    }
  }
  
  return tactics;
}

function buildAllowedPieceDescriptors(positionFacts) {
  if (!positionFacts || !Array.isArray(positionFacts.pieces)) return [];
  
  return positionFacts.pieces.map(p => {
    return `${p.color} ${p.type} on ${p.square}`.toLowerCase();
  });
}

function buildLegalSquares(positionFacts, latestAnalysis) {
  const sqSet = new Set();
  
  if (positionFacts?.pieces) {
    for (const p of positionFacts.pieces) {
      sqSet.add(p.square.toLowerCase());
      for (const a of p.attacks || []) sqSet.add(a.toLowerCase());
      for (const d of p.defends || []) sqSet.add(d.toLowerCase());
    }
  }
  
  const addMoveSquares = (moves) => {
    if (!Array.isArray(moves)) return;
    for (const mv of moves) {
      const m = sanitizeMove(mv);
      if (m.length >= 4) {
        sqSet.add(m.substring(0, 2).toLowerCase());
        sqSet.add(m.substring(2, 4).toLowerCase());
      }
    }
  };
  
  if (latestAnalysis) {
    addMoveSquares(latestAnalysis.principalVariation);
    for (const line of latestAnalysis.topMoves || []) {
      addMoveSquares(line.pv || []);
    }
  }
  
  return Array.from(sqSet);
}

function buildSystemPrompt(fen, solutionMoves, moveHistory, puzzleType, positionFacts, bestMoveFromStockfish = null) {
  const turn = positionFacts.turn || 'white';
  const filteredFacts = filterFactsForSideToMove(positionFacts, turn);
  const factsJson = JSON.stringify(filteredFacts, null, 2);
  
  return `Chess coach with Stockfish. Explain the best move using engine data and FACTS.

RULES: Never invent threats/tactics. Use only Stockfish/FACTS. Reference tactical facts if present. Compare alternatives via multipv.

OUTPUT (5-7 sentences):
1. "The best move is [move] with evaluation [eval]."
2. "Principal variation: [PV moves]."
3. Explain WHY using FACTS or positional reasons.
4. Describe tactical facts if present (forks, pins, hanging, etc.).
5. Compare with alternative using multipv eval.
6. "That is why Stockfish prefers [move]."

FACTS (${turn} to move):
${factsJson}

Use analyze_position for engine data.`;
}

function buildSafeSystemPrompt(legalSquares, legalPieces, tactics, allowedPieceDescriptors) {
  return `YOU ARE NOT ALLOWED TO INVENT ANYTHING.

You may ONLY produce an explanation by choosing from the structured data provided.

SAFETY RULES:
1. ONLY use squares that are in legal_squares.
2. ONLY use pieces mentioned in legal_pieces.
3. ONLY use tactics listed under facts.tactics.
4. ONLY refer to pieces using EXACTLY one of these descriptors:
${allowedPieceDescriptors.map(d => `   - ${d}`).join('\n')}
5. If any needed detail is missing, respond with: "Insufficient data to explain safely."
6. You may NOT invent positions, threats, captures, checks, or squares.
7. You may NOT describe any piece interactions that are not explicitly in facts.

Build the explanation ONLY from the provided structured facts.

Available tactics:
${JSON.stringify(tactics, null, 2)}

Legal squares: ${legalSquares.join(', ')}
Legal pieces: ${legalPieces.join(', ')}`;
}

async function safeGPT(messages, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: messages,
        temperature: 0.0,
        max_tokens: 300,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "explanation",
            schema: {
              type: "object",
              properties: {
                explanation: { type: "string" }
              },
              required: ["explanation"]
            }
          }
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Safe GPT API error:', errorText);
      throw new Error(`Safe GPT API request failed: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Safe GPT API request timeout');
    }
    throw error;
  }
}

function verifyExplanation(text, facts, legalSquares) {
  if (!text) return false;
  
  // 1) Squares check
  const squarePattern = /\b[a-h][1-8]\b/g;
  const usedSquares = [...text.matchAll(squarePattern)].map(m => m[0].toLowerCase());
  
  for (const sq of usedSquares) {
    if (!legalSquares.includes(sq)) {
      console.warn(`Hallucinated square detected: ${sq}`);
      return false;
    }
  }
  
  // 2) Piece type words check
  const piecePattern = /\b(pawn|knight|bishop|rook|queen|king)\b/gi;
  const usedPieces = [...text.matchAll(piecePattern)].map(m => m[0].toLowerCase());
  const legalPieces = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  
  for (const piece of usedPieces) {
    if (!legalPieces.includes(piece)) {
      console.warn(`Invalid piece mentioned: ${piece}`);
      return false;
    }
  }
  
  // 3) Cross-check actual "color piece on square" mentions
  const descriptorPattern = /\b(white|black)\s+(pawn|knight|bishop|rook|queen|king)\s+on\s+([a-h][1-8])\b/gi;
  const mentionedDescriptors = [];
  let match;
  
  while ((match = descriptorPattern.exec(text)) !== null) {
    const color = match[1].toLowerCase();
    const type = match[2].toLowerCase();
    const square = match[3].toLowerCase();
    mentionedDescriptors.push(`${color} ${type} on ${square}`);
  }
  
  if (mentionedDescriptors.length > 0) {
    const allowedDescriptors = buildAllowedPieceDescriptors(facts);
    for (const desc of mentionedDescriptors) {
      if (!allowedDescriptors.includes(desc.toLowerCase())) {
        console.warn(`Hallucinated piece descriptor: ${desc}`);
        return false;
      }
    }
  }
  
  return true;
}

function computeFullPositionFacts(fen, solutionMoves, skipAfterMove = false, recursionDepth = 0) {
  if (recursionDepth > 2) {
    console.warn('computeFullPositionFacts recursion depth exceeded');
    return {
      pieces: [],
      turn: 'white',
      check: false
    };
  }
  
  try {
    const chess = new Chess(fen);
    const allSquares = [];
    
    for (let r = 1; r <= 8; r++) {
      for (let f = 0; f < 8; f++) {
        allSquares.push(coordsToSquare(f, r));
      }
    }
    
    const attackMap = buildPseudoLegalAttackMap(chess);
    const defenseMap = buildDefenseMap(chess, attackMap);
    
    const pieces = [];
    
    for (const square of allSquares) {
      const piece = chess.get(square);
      if (!piece) continue;
      
      const color = piece.color === 'w' ? 'white' : 'black';
      const type = getPieceName(piece.type);
      
      const attackedSquares = getPseudoLegalAttacks(chess, square, piece);
      
      const attackedPieces = attackedSquares
        .map(sq => {
          const p = chess.get(sq);
          if (p && p.color !== piece.color) {
            const pColor = p.color === 'w' ? 'white' : 'black';
            return `${pColor} ${getPieceName(p.type)} on ${sq}`;
          }
          return null;
        })
        .filter(Boolean);
      
      const defendedSquares = [];
      const defendedPieces = [];
      
      for (const sq of attackedSquares) {
        const p = chess.get(sq);
        if (p && p.color === piece.color) {
          defendedSquares.push(sq);
          const pColor = p.color === 'w' ? 'white' : 'black';
          defendedPieces.push(`${pColor} ${getPieceName(p.type)} on ${sq}`);
        }
      }
      
      const pieceData = {
        square: square.toLowerCase().trim(),
        type: type,
        color: color,
        attacks: attackedSquares.map(sq => sq.toLowerCase().trim()),
        defends: defendedSquares.map(sq => sq.toLowerCase().trim()),
        attacksPieces: attackedPieces,
        defendsPieces: defendedPieces,
        forks: [],
        pinned: false,
        hanging: false,
        overloaded: false,
        skewer: false,
        discoveredAttack: null
      };
      
      pieces.push(pieceData);
      
      for (const sq of pieceData.defends) {
        if (!defenseMap.has(sq)) defenseMap.set(sq, []);
        defenseMap.get(sq).push({ square: pieceData.square, color, type });
      }
    }
    
    for (const piece of pieces) {
      const defenders = defenseMap.get(piece.square) || [];
      const attackers = attackMap.get(piece.square) || [];
      const enemyAttackers = attackers.filter(a => a.color !== piece.color);
      
      piece.hanging = enemyAttackers.length > 0 && defenders.length === 0;
      
      if (piece.type !== 'king') {
        piece.pinned = isPinned(chess, piece.square, piece.color, attackMap);
      }
      
      piece.overloaded = isOverloaded(chess, piece, attackMap, defenseMap);
    }
    
    for (const piece of pieces) {
      const forks = detectForks(chess, piece, attackMap);
      if (forks.length >= 2) {
        piece.forks = forks;
      }
      
      const skewer = detectSkewer(chess, piece, pieces, attackMap);
      if (skewer) {
        piece.skewer = true;
      }
    }
    
    for (const piece of pieces) {
      if (piece.type === 'pawn' || piece.type === 'knight' || piece.type === 'king') {
        continue;
      }
      
      for (const sq of piece.attacks) {
        const p = chess.get(sq);
        if (p && p.color !== piece.color) {
          const direction = getDirection(piece.square, sq);
          if (direction) {
            const blockingSquare = getSquareBetween(piece.square, sq, chess);
            if (blockingSquare) {
              const blockingSquareSanitized = blockingSquare.toLowerCase().trim();
              const blockingPiece = pieces.find(p => p.square.toLowerCase().trim() === blockingSquareSanitized);
              if (blockingPiece && blockingPiece.color === piece.color) {
                piece.discoveredAttack = `${blockingPiece.color} ${blockingPiece.type} on ${blockingPiece.square} can reveal attack on ${sq}`;
                break;
              }
            }
          }
        }
      }
    }
    
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    const inCheck = isInCheck(chess);
    
    const facts = {
      pieces: pieces,
      turn: turn,
      check: inCheck
    };
    
    if (!skipAfterMove && solutionMoves && solutionMoves.length > 0) {
      const move = solutionMoves[0];
      if (move && move.length >= 4) {
        const sanitizedMove = sanitizeMove(move);
        const from = sanitizedMove.substring(0, 2);
        const to = sanitizedMove.substring(2, 4);
        const promotion = sanitizedMove.length > 4 ? sanitizedMove.substring(4) : undefined;
        
        try {
          const afterChess = new Chess(fen);
          const legalMoves = afterChess.moves({ verbose: true });
          const isLegal = legalMoves.some(m => m.from === from && m.to === to);
          
          if (isLegal) {
            const moveObj = afterChess.move({ from, to, promotion: promotion || 'q' });
            
            if (moveObj) {
              const afterFacts = computeFullPositionFacts(afterChess.fen(), [], true, recursionDepth + 1);
              facts.afterMove = {
                move: sanitizedMove,
                position: afterFacts
              };
            }
          }
        } catch (error) {
          console.error('Error computing afterMove facts:', error);
        }
      }
    }
    
    return facts;
  
  } catch (error) {
    console.error('Error computing full position facts:', error);
    return {
      pieces: [],
      turn: 'white',
      check: false
    };
  }
}

async function callGPTWithTools(messages, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
        messages: messages,
        tools: [
          {
            type: 'function',
            function: {
              name: 'analyze_position',
              description: 'Analyze a chess position using Stockfish engine. Use this to get evaluations, best moves, and principal variations.',
              parameters: {
                type: 'object',
                properties: {
                  fen: {
                    type: 'string',
                    description: 'FEN string of the position to analyze'
                  },
                  depth: {
                    type: 'integer',
                    description: 'Search depth (default: 18)',
                    default: 18,
                    minimum: 10,
                    maximum: 25
                  },
                  multipv: {
                    type: 'integer',
                    description: 'Number of alternative moves to return (default: 3)',
                    default: 3,
                    minimum: 1,
                    maximum: 5
                  },
                  purpose: {
                    type: 'string',
                    enum: ['main_position', 'after_solution', 'alternative_move', 'verification'],
                    description: 'Purpose of this analysis: main_position (initial analysis), after_solution (position after best move), alternative_move (checking an alternative), verification (double-checking a line)'
                  }
                },
                required: ['purpose']
              }
            }
          }
        ],
        tool_choice: 'auto',
        temperature: 0.0,
        max_tokens: 400
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GPT API error:', errorText);
      throw new Error(`GPT API request failed: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('GPT API request timeout');
    }
    throw error;
  }
}

async function runAgenticCoach(fen, userQuestion, solutionMoves, moveHistory, puzzleType) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const HF_TOKEN = process.env.HF_TOKEN;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN not configured');
  }

  const maxIterations = 5;
  const analysisSteps = [];
  
  let positionFacts;
  try {
    positionFacts = computeFullPositionFacts(fen, solutionMoves);
  } catch (e) {
      console.error("FACTS ERROR:", e);
      positionFacts = { pieces: [], check: false, turn: "white" };
  }
  
  const conversationHistory = [
    {
      role: 'system',
      content: `Your ONLY job is to decide which analyze_position tool calls to make.

You are NOT allowed to generate any chess explanation.
You are NOT allowed to reason about tactics, squares, or pieces.
Never mention any chess content.
Only say which tool call you want to make next.

Use the analyze_position tool to get Stockfish analysis data.
Do not explain anything - only request tool calls.`
    },
    {
      role: 'user',
      content: JSON.stringify({ fen, question: userQuestion || 'Why is this the best move?' })
    }
  ];

  let iteration = 0;
  let bestMove = null;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`Agent iteration ${iteration}/${maxIterations}`);

    try {
      const response = await callGPTWithTools(conversationHistory, OPENAI_API_KEY);
      
      const assistantMessage = response.choices[0].message;
      conversationHistory.push(assistantMessage);

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          if (toolCall.function.name === 'analyze_position') {
            const args = JSON.parse(toolCall.function.arguments);
            
            console.log(`GPT requested analysis:`, args);
            
            const analysisResult = await analyzePosition({
              fen: args.fen || fen,
              depth: args.depth || 18,
              multipv: args.multipv || 3,
              purpose: args.purpose || 'main_position',
              hfToken: HF_TOKEN
            });

            const recoveredResult = await recoverPV(analysisResult, args.fen || fen, HF_TOKEN);

            analysisSteps.push({
              request: args,
              result: recoveredResult
            });

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(recoveredResult)
            });

            if (!bestMove && recoveredResult.bestMove) {
              const candidateBestMove = recoveredResult.bestMove;
              
              const analyzedFen = args.fen || fen;
              const sanitizedMove = sanitizeMove(candidateBestMove);
              const from = sanitizedMove?.substring(0, 2);
              const to = sanitizedMove?.substring(2, 4);
              
              let moveIsLegal = false;
              
              if (from && to && from.length === 2 && to.length === 2) {
                try {
                  const testChess = new Chess(analyzedFen);
                  const legalMoves = testChess.moves({ verbose: true });
                  moveIsLegal = legalMoves.some(m => m.from === from && m.to === to);
                } catch (error) {
                  moveIsLegal = false;
                }
              }
              
              if (moveIsLegal) {
                bestMove = candidateBestMove;
                
                const factsForPosition = computeFullPositionFacts(analyzedFen, [], true);
                
                if ((args.purpose === 'main_position' || !args.fen || args.fen === fen) && iteration === 1) {
                  positionFacts = factsForPosition;
                }
              } else {
                console.warn(`Best move ${candidateBestMove} is not legal in position ${analyzedFen}`);
              }
            }
          }
        }
        
      } else {
        console.log('GPT returned non-tool response, continuing to collect analysis');
        continue;
      }
    } catch (error) {
      console.error(`Error in iteration ${iteration}:`, error);
      throw error;
    }
  }

  // --------------------------------------
  // FINAL SAFE EXPLANATION
  // --------------------------------------
  
  let latestAnalysis = null;
  if (analysisSteps.length > 0) {
    latestAnalysis = analysisSteps[analysisSteps.length - 1].result;
  }
  
  const finalBestMove = bestMove || solutionMoves[0] || null;
  const legalPieces = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  const tactics = extractTacticsFromFacts(positionFacts);
  const allowedPieceDescriptors = buildAllowedPieceDescriptors(positionFacts);
  const legalSquares = buildLegalSquares(positionFacts, latestAnalysis);
  
  const structuredData = {
    bestMove: finalBestMove,
    eval: latestAnalysis?.evaluation || null,
    pv: latestAnalysis?.principalVariation || [],
    topMoves: latestAnalysis?.topMoves || [],
    analysis: analysisSteps,
    facts: positionFacts,
    tactics: tactics,
    legal_squares: legalSquares,
    legal_pieces: legalPieces,
    allowed_piece_descriptors: allowedPieceDescriptors
  };
  
  const safeSystem = buildSafeSystemPrompt(legalSquares, legalPieces, tactics, allowedPieceDescriptors);
  const safeUser = JSON.stringify(structuredData, null, 2);
  
  const safeMessages = [
    { role: 'system', content: safeSystem },
    { role: 'user', content: safeUser }
  ];
  
  let safeResponse = null;
  try {
    console.log('Calling safeGPT for final explanation');
    safeResponse = await safeGPT(safeMessages, OPENAI_API_KEY);
  } catch (err) {
    console.error('safeGPT failed:', err);
    safeResponse = null;
  }
  
  let finalExplanation = '';
  
  if (safeResponse?.choices?.[0]?.message?.content) {
    const safeContent = safeResponse.choices[0].message.content;
    
    if (typeof safeContent === 'string') {
      try {
        const parsed = JSON.parse(safeContent);
        finalExplanation = parsed.explanation || safeContent;
      } catch {
        finalExplanation = safeContent;
      }
    } else {
      finalExplanation = safeContent;
    }
  }
  
  // Safety: verify hallucinations
  if (!finalExplanation || !verifyExplanation(finalExplanation, positionFacts, legalSquares)) {
    console.warn('Explanation failed verification or is empty');
    if (latestAnalysis && finalBestMove) {
      finalExplanation = `The best move is ${finalBestMove} with an evaluation of ${latestAnalysis.evaluation}. Principal variation: ${latestAnalysis.principalVariation.join(' ')}.`;
    } else if (finalBestMove) {
      finalExplanation = `The best move is ${finalBestMove}.`;
    } else {
      finalExplanation = 'Insufficient data to explain safely.';
    }
  }
  
  return {
    explanation: finalExplanation,
    analysisSteps: analysisSteps,
    bestMove: finalBestMove
  };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

  let fen, userQuestion, solutionMoves, moveHistory, puzzleType;
  
  if (req.method === 'GET') {
    fen = req.query.fen;
    userQuestion = req.query.question;
    solutionMoves = req.query.solutionMove ? [req.query.solutionMove] : [];
    puzzleType = req.query.puzzleType;
    moveHistory = null;
  } else if (req.method === 'POST') {
    ({ fen, userQuestion, solutionMoves, moveHistory } = req.body);
    puzzleType = req.body.puzzleType;
  } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
      if (!fen) {
        return res.status(400).json({ error: 'FEN is required' });
      }

  try {
    const testChess = new Chess(fen);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid FEN format' });
  }

  try {
    const result = await runAgenticCoach(fen, userQuestion, solutionMoves, moveHistory, puzzleType);
    

    return res.status(200).json({
      success: true,
      hint: result.explanation,
      explanation: result.explanation,
      bestMove: result.bestMove || 'Unknown',
      puzzleType: puzzleType,
      analysisSteps: result.analysisSteps,
      method: 'Agentic GPT + SafeGPT + Stockfish',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Agentic coach error:', error);
    
        return res.status(200).json({
          success: true,
      hint: solutionMoves[0] 
        ? `The best move is ${solutionMoves[0]}. This appears to be a ${puzzleType || 'tactical'} puzzle.`
        : 'Error occurred, but try looking for tactical patterns like checks, captures, and threats.',
      bestMove: solutionMoves[0] || 'Unknown',
      explanation: 'API temporarily unavailable',
      analysisSteps: []
    });
  }
}
