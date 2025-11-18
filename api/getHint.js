import { Chess } from 'chess.js';

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
      method: 'Agentic GPT + Stockfish',
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
  
  let positionFacts = computeFullPositionFacts(fen, solutionMoves);
  
  const conversationHistory = [
    {
      role: 'system',
      content: buildSystemPrompt(fen, solutionMoves, moveHistory, puzzleType, positionFacts, null)
    },
    {
      role: 'user',
      content: userQuestion || 'Why is this the best move?'
    }
  ];

  let iteration = 0;
  let finalExplanation = null;
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

            
            if (analysisResult.principalVariation.length === 0 || 
                analysisResult.principalVariation[0] === undefined) {
              
              if (analysisResult.topMoves?.[0]?.pv?.length > 0) {
                analysisResult.principalVariation = analysisResult.topMoves[0].pv;
                console.log("PV recovered from topMoves[0].pv");
              } else {
                console.log("PV missing — requesting deeper analysis for recovery");

                const recovery = await analyzePosition({
                  fen: args.fen || fen,
                  depth: 22,
                  multipv: 1,
                  purpose: "pv_recovery",
                  hfToken: HF_TOKEN
                });

                analysisResult.principalVariation = recovery.principalVariation;
                analysisResult.topMoves = recovery.topMoves;
              }
            }

            analysisSteps.push({
              request: args,
              result: analysisResult
            });

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(analysisResult)
            });

            if (!bestMove && analysisResult.bestMove) {
              const candidateBestMove = analysisResult.bestMove;
              
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
                
                if (args.purpose === 'main_position' || !args.fen || args.fen === fen) {
                  positionFacts = factsForPosition;
                  const updatedPrompt = buildSystemPrompt(analyzedFen, solutionMoves, moveHistory, puzzleType, positionFacts, bestMove);
                  
                  const lastUserMessage = [...conversationHistory].reverse().find(m => m.role === 'user' && !m.tool_call_id);
                  conversationHistory.length = 0;
                  conversationHistory.push({
                    role: 'system',
                    content: updatedPrompt
                  });
                  if (lastUserMessage) {
                    conversationHistory.push(lastUserMessage);
                  }
                  if (bestMove) {
                    conversationHistory.push({
                      role: 'assistant',
                      content: `Stockfish analysis indicates the best move is: ${bestMove}`
                    });
                  }
                }
              } else {
                console.warn(`Best move ${candidateBestMove} is not legal in position ${analyzedFen}`);
              }
            }
          }
        }
      } else {
        finalExplanation = assistantMessage.content;
        console.log('GPT returned final explanation');
        break;
      }
    } catch (error) {
      console.error(`Error in iteration ${iteration}:`, error);
      throw error;
    }
  }

  if (!finalExplanation) {
    finalExplanation = solutionMoves[0] 
      ? `The best move is ${solutionMoves[0]}. This appears to be a ${puzzleType || 'tactical'} puzzle.`
      : 'Unable to generate explanation. Please try again.';
  }

  const finalBestMove = solutionMoves[0] || bestMove || null;

  return {
    explanation: finalExplanation,
    analysisSteps: analysisSteps,
    bestMove: finalBestMove
  };
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


function validateMove(fen, move) {
  if (!move) return null;
  
  try {
    const sanitizedMove = sanitizeMove(move);
    if (sanitizedMove.length < 4) return null;
    
    const from = sanitizedMove.substring(0, 2);
    const to = sanitizedMove.substring(2, 4);
    const promotion = sanitizedMove.length > 4 ? sanitizedMove.substring(4) : undefined;
    
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
    
    const bestMove = data.best_move || null;
    
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
        const validatedMove = validateMove(fen, line.move || line.best_move || bestMove);
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
        const validatedMove = validateMove(fen, line.move || line.best_move || bestMove);
        return {
          move: validatedMove,
          evaluation: formatEval(line.evaluation || data.evaluation),
          evalScore: parseEval(line.evaluation || data.evaluation),
          pv: clampedLinePV
        };
      }).filter(m => m.move);
    } else {
      const validatedBestMove = validateMove(fen, bestMove);
      topMoves = validatedBestMove ? [{
        move: validatedBestMove,
        evaluation: formatEval(data.evaluation),
        evalScore: parseEval(data.evaluation),
        pv: clampedPV
      }] : [];
    }

    const validatedBestMove = validateMove(fen, bestMove);

    return {
      bestMove: validatedBestMove || bestMove,
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


function buildSystemPrompt(fen, solutionMoves, moveHistory, puzzleType, positionFacts, bestMoveFromStockfish = null) {
  const factsJson = JSON.stringify(positionFacts, null, 2);
  
  let hasTacticalInfo = false;
  
  try {
    const pieces = positionFacts.pieces || [];
    
    for (const piece of pieces) {
      if (piece.attacksPieces && piece.attacksPieces.length > 0) {
        hasTacticalInfo = true;
        break;
      }
      if (piece.defendsPieces && piece.defendsPieces.length > 0) {
        hasTacticalInfo = true;
        break;
      }
      if (piece.forks && piece.forks.length > 0) {
        hasTacticalInfo = true;
        break;
      }
      if (piece.pinned === true || piece.hanging === true || piece.overloaded === true || piece.skewer === true || piece.discoveredAttack) {
        hasTacticalInfo = true;
        break;
      }
    }
  } catch (error) {
    console.error('Error checking tactical info:', error);
  }
  
  const moveToCheck = bestMoveFromStockfish || (solutionMoves && solutionMoves[0]) || null;
  
  return `You are a chess coach with access to Stockfish engine analysis.

Your job: Explain why the best move is best, using the FACTS provided and Stockfish data.

REQUIRED EXPLANATION TEMPLATE (4-6 sentences):
1. "The best move is [move] with an evaluation of [eval]."
2. "The principal variation continues: [PV moves from Stockfish]."
3. If tactical FACTS exist: Use those facts to explain the move. Reference attacks/defends/forks/hanging/pins as listed in FACTS.
4. If tactical facts DO NOT exist: Explain using Stockfish evaluation differences. You can say things like "This move improves the position by [eval difference]" or "Alternative moves evaluate worse: [comparison]."
5. If alternatives exist in multipv: "Alternative moves evaluate worse: [move + eval comparison]."
6. Conclude with why Stockfish prefers this move.

IMPORTANT RULES:
- Use information from FACTS JSON when available. If FACTS contain tactical details (attacks, defends, forks, pins, etc.), reference them.
- If FACTS do not contain tactical details, you can still explain using Stockfish evaluation and PV.
- You CAN explain positional/strategic reasons based on Stockfish evaluation (e.g., "improves the position", "better evaluation", "leads to winning endgame") - these are based on engine data, not invented.
- You MUST NOT invent piece locations, attacks, or defenses that are NOT in FACTS.
- You CAN use tactical language like "attacks", "defends", "pressure", "fork", "pin", "hanging", "overloaded" IF those facts appear in FACTS JSON.
- Compare alternative moves using their evalScore differences from Stockfish multipv.
- Ground your explanation in Stockfish data (evaluations, PV) and FACTS when available.
- Positional explanations based on Stockfish evaluation are allowed and encouraged when tactical FACTS are not available.

Your reasoning steps:
1. First analyze the main position (multipv=3, purpose='main_position').
2. If there is a solution move, analyze the position after that move (purpose='after_solution').
3. If needed, analyze alternatives (purpose='alternative_move').
4. Once you have Stockfish data, output the explanation following the template above.

FACTS ABOUT THIS POSITION (COMPUTED WITH CHESS.JS):
${factsJson}

${hasTacticalInfo ? 'Note: This position contains tactical elements (attacks, defends, forks, pins, etc.) listed in FACTS above.' : 'Note: This position may not have obvious tactical patterns. Focus on Stockfish evaluation and positional factors.'}

When you need Stockfish analysis, call "analyze_position".
When ready, output your final explanation following the template above.

${moveToCheck ? `Move to explain: ${moveToCheck}` : ''}
${puzzleType ? `Puzzle type: ${puzzleType}` : ''}

FINAL REQUIREMENT: Ground explanations in Stockfish data and FACTS. Do not invent details not present in FACTS, but you can explain based on Stockfish evaluation even if FACTS lack tactical details.`;
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
    const allSquares = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
                       'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
                       'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
                       'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
                       'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
                       'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
                       'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
                       'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8'];
    
    const pieces = [];
    const attackMap = new Map();
    const defenseMap = new Map();
    
    for (const square of allSquares) {
      const piece = chess.get(square);
      if (!piece) continue;
      
      const color = piece.color === 'w' ? 'white' : 'black';
      const type = getPieceName(piece.type);
      
      const attackedSquares = getAttackedSquaresPseudoLegal(chess, square);
      
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
      
      for (const sq of pieceData.attacks) {
        if (!attackMap.has(sq)) attackMap.set(sq, []);
        attackMap.get(sq).push({ square: pieceData.square, color, type });
      }
      
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
        piece.pinned = isPinned(chess, piece.square, piece.color);
      }
      
      piece.overloaded = isOverloaded(chess, piece, pieces, attackMap, defenseMap);
    }
    
    for (const piece of pieces) {
      const forks = detectForks(chess, piece, pieces);
      if (forks.length >= 2) {
        piece.forks = forks;
      }
      
      const skewer = detectSkewer(chess, piece, pieces);
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
    const inCheck = chess.in_check();
    
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

function getDirection(from, to) {
  const fromFile = from.charCodeAt(0) - 97;
  const fromRank = parseInt(from[1]);
  const toFile = to.charCodeAt(0) - 97;
  const toRank = parseInt(to[1]);
  
  const fileDiff = toFile - fromFile;
  const rankDiff = toRank - fromRank;
  
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
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]);
  
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
  
  if (newFile < 0 || newFile > 7 || newRank < 1 || newRank > 8) {
    return null;
  }
  
  return String.fromCharCode(97 + newFile) + newRank;
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

function getSquareBehind(square, direction) {
  const reverseDirections = {
    'up': 'down',
    'down': 'up',
    'left': 'right',
    'right': 'left',
    'up-right': 'down-left',
    'up-left': 'down-right',
    'down-right': 'up-left',
    'down-left': 'up-right'
  };
  const reverseDir = reverseDirections[direction];
  if (!reverseDir) return null;
  return getNextSquare(square, reverseDir);
}

function getAttackedSquaresPseudoLegal(chess, square) {
  try {
    const piece = chess.get(square);
    if (!piece) return [];
    
    const attackedSquares = new Set();
    const pieceType = piece.type;
    const pieceColor = piece.color;
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1]);
    
    if (pieceType === 'p') {
      const direction = pieceColor === 'w' ? 1 : -1;
      const leftFile = file - 1;
      const rightFile = file + 1;
      const newRank = rank + direction;
      
      if (leftFile >= 0 && newRank >= 1 && newRank <= 8) {
        attackedSquares.add(String.fromCharCode(97 + leftFile) + newRank);
      }
      if (rightFile <= 7 && newRank >= 1 && newRank <= 8) {
        attackedSquares.add(String.fromCharCode(97 + rightFile) + newRank);
      }
    }
    else if (pieceType === 'n') {
      const knightMoves = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1]
      ];
      for (const [df, dr] of knightMoves) {
        const newFile = file + df;
        const newRank = rank + dr;
        if (newFile >= 0 && newFile <= 7 && newRank >= 1 && newRank <= 8) {
          attackedSquares.add(String.fromCharCode(97 + newFile) + newRank);
        }
      }
    }
    else if (pieceType === 'k') {
      for (let df = -1; df <= 1; df++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (df === 0 && dr === 0) continue;
          const newFile = file + df;
          const newRank = rank + dr;
          if (newFile >= 0 && newFile <= 7 && newRank >= 1 && newRank <= 8) {
            attackedSquares.add(String.fromCharCode(97 + newFile) + newRank);
          }
        }
      }
    }
    else {
      const directions = [];
      if (pieceType === 'r' || pieceType === 'q') {
        directions.push([0, 1], [0, -1], [1, 0], [-1, 0]);
      }
      if (pieceType === 'b' || pieceType === 'q') {
        directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      }
      
      for (const [df, dr] of directions) {
        for (let i = 1; i < 8; i++) {
          const newFile = file + df * i;
          const newRank = rank + dr * i;
          if (newFile < 0 || newFile > 7 || newRank < 1 || newRank > 8) break;
          
          const targetSquare = String.fromCharCode(97 + newFile) + newRank;
          attackedSquares.add(targetSquare);
          
          if (chess.get(targetSquare)) break;
        }
      }
    }
    
    return Array.from(attackedSquares);
  } catch (error) {
    return [];
  }
}

function getKingSquare(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.type === 'k' && piece.color === color) {
        return String.fromCharCode(97 + c) + (8 - r);
      }
    }
  }
  return null;
}

function isPinned(chess, square, pieceColor) {
  const kingColor = pieceColor === 'white' ? 'w' : 'b';
  const kingSquare = getKingSquare(chess, kingColor);
  if (!kingSquare) return false;
  
  const piece = chess.get(square);
  if (!piece || piece.type === 'k') return false;
  
  const direction = getDirection(square, kingSquare);
  if (!direction) return false;
  
  const testChess = new Chess(chess.fen());
  const oppositeDir = getOppositeDirection(direction);
  if (!oppositeDir) return false;
  
  let attackerSquare = null;
  let current = getNextSquare(square, oppositeDir);
  let piecesBetween = 0;
  
  while (current) {
    const p = testChess.get(current);
    if (p) {
      if (p.color === pieceColor) {
        return false;
      }
      attackerSquare = current;
      break;
    }
    piecesBetween++;
    current = getNextSquare(current, oppositeDir);
  }
  
  if (!attackerSquare) return false;
  
  const attacker = testChess.get(attackerSquare);
  if (!attacker || attacker.color === pieceColor) return false;
  
  const attackerType = attacker.type;
  const isLinePiece = attackerType === 'r' || attackerType === 'b' || attackerType === 'q';
  if (!isLinePiece) return false;
  
  const canAttackAlongLine = 
    (attackerType === 'r' && (direction === 'up' || direction === 'down' || direction === 'left' || direction === 'right')) ||
    (attackerType === 'b' && (direction === 'up-right' || direction === 'up-left' || direction === 'down-right' || direction === 'down-left')) ||
    (attackerType === 'q');
  
  if (!canAttackAlongLine) return false;
  
  testChess.remove(square);
  const wouldBeInCheck = testChess.in_check();
  return wouldBeInCheck;
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

function detectForks(chess, piece, allPieces) {
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
      
      const canCapture1 = canCaptureSquare(chess, piece.square, p1.square, piece.color);
      const canCapture2 = canCaptureSquare(chess, piece.square, p2.square, piece.color);
      
      if (canCapture1 && canCapture2) {
        forks.push(`${p1.color} ${p1.type} on ${p1.square}`, `${p2.color} ${p2.type} on ${p2.square}`);
      }
    }
  }
  
  return forks;
}

function canCaptureSquare(chess, fromSquare, toSquare, pieceColor) {
  try {
    const testChess = new Chess(chess.fen());
    const moves = testChess.moves({ square: fromSquare, verbose: true });
    return moves.some(m => m.to === toSquare && m.captured);
  } catch {
    return false;
  }
}

function detectSkewer(chess, piece, allPieces) {
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
  
  const attackedValue = getPieceValue(attackedPiece.type);
  if (attackedValue < 5 && attackedPiece.type !== 'king') return false;
  
  const oppositeDir = getOppositeDirection(direction);
  if (!oppositeDir) return false;
  
  let current = getNextSquare(attackedSquare, oppositeDir);
  while (current) {
    const p = chess.get(current);
    if (p) {
      if (p.color === attackedPiece.color) {
        const behindValue = getPieceValue(p.type);
        if (behindValue < attackedValue || (p.type === 'king' && attackedPiece.type !== 'king')) {
          return true;
        }
        if (attackedPiece.type === 'king' && behindValue > 0) {
          return true;
        }
      }
      break;
    }
    current = getNextSquare(current, oppositeDir);
  }
  
  return false;
}

function isOverloaded(chess, piece, allPieces, attackMap, defenseMap) {
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
  
  let undefendedAfterRemoval = 0;
  for (const threatSquare of criticalThreats) {
    const defendersAfter = defenseMap.get(threatSquare)?.filter(d => d.square !== piece.square) || [];
    const attackersAfter = attackMap.get(threatSquare) || [];
    const enemyAttackersAfter = attackersAfter.filter(a => a.color !== piece.color);
    
    if (enemyAttackersAfter.length > defendersAfter.length) {
      undefendedAfterRemoval++;
    }
  }
  
  return undefendedAfterRemoval >= 2;
}

function applyMoveToFen(fen, move) {
  try {
    const chess = new Chess(fen);
    
    if (move && move.length >= 4) {
      const from = move.substring(0, 2);
      const to = move.substring(2, 4);
      const promotion = move.length > 4 ? move.substring(4) : undefined;
      
      const moveObj = chess.move({
        from: from,
        to: to,
        promotion: promotion || 'q'
      });
      
      if (moveObj) {
        return chess.fen();
      }
    }
    
    return fen;
  } catch (error) {
    console.error('Error applying move to FEN:', error);
    return fen;
  }
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
