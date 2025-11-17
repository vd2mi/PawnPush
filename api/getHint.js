import { Chess } from 'chess.js';


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
    
    const stockfishAnalysis = await getStockfishAnalysis(fen, solutionMoves);

    
    const gptExplanation = await getGPTExplanation(
      fen,
      stockfishAnalysis,
      userQuestion,
      moveHistory,
      solutionMoves,
      puzzleType
    );


    return res.status(200).json({
      success: true,
      hint: gptExplanation,
      bestMove: solutionMoves[0] || stockfishAnalysis?.bestMove || 'Unknown',
      puzzleType: puzzleType,
      explanation: gptExplanation,
      analysis: stockfishAnalysis, 
      method: 'Enhanced Stockfish + GPT analysis',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Enhanced hint error:', error);

    return res.status(200).json({
      success: true,
      hint: solutionMoves[0] 
        ? `The best move is ${solutionMoves[0]}. This appears to be a ${puzzleType || 'tactical'} puzzle.`
        : 'Error occurred, but try looking for tactical patterns like checks, captures, and threats.',
      bestMove: solutionMoves[0] || 'Unknown',
      explanation: 'API temporarily unavailable',
      analysis: null
    });
  }
}


async function getStockfishAnalysis(fen, solutionMoves) {
  const HF_TOKEN = process.env.HF_TOKEN;
  
  if (!HF_TOKEN) {
    console.log('No HF_TOKEN available for Stockfish analysis');
    return null;
  }

  try {
    
    const controller1 = new AbortController();
    const timeoutId1 = setTimeout(() => {
      controller1.abort();
    }, 25000); 

    let currentAnalysisResponse;
    try {
      currentAnalysisResponse = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HF_TOKEN}`
        },
        body: JSON.stringify({ fen, depth: 18, multipv: 3 }),
        signal: controller1.signal
      });
      clearTimeout(timeoutId1);
    } catch (error) {
      clearTimeout(timeoutId1);
      if (error.name === 'AbortError') {
        console.error('Stockfish analysis timeout');
        return null;
      }
      throw error;
    }

    if (!currentAnalysisResponse.ok) {
      console.error('Stockfish API error:', currentAnalysisResponse.status);
      return null;
    }

    const currentAnalysis = await currentAnalysisResponse.json();
    
    // Debug: log API response structure (remove in production if too verbose)
    console.log('Stockfish API response keys:', Object.keys(currentAnalysis));
    if (currentAnalysis.lines) console.log('Found lines array with', currentAnalysis.lines.length, 'entries');
    if (currentAnalysis.multipv) console.log('Found multipv array with', currentAnalysis.multipv.length, 'entries');
    if (currentAnalysis.pv) console.log('Found pv with', currentAnalysis.pv.length, 'moves');
    
    // Extract principal variation and top moves
    const principalVariation = currentAnalysis.pv || 
                              currentAnalysis.principal_variation || 
                              currentAnalysis.principalVariation || 
                              [];
    
    // Extract top moves (multipv results)
    let topMoves = [];
    if (currentAnalysis.lines && Array.isArray(currentAnalysis.lines)) {
      topMoves = currentAnalysis.lines.slice(0, 3).map(line => ({
        move: line.move || line.best_move || currentAnalysis.best_move,
        evaluation: line.evaluation || currentAnalysis.evaluation,
        evalScore: parseEval(line.evaluation || currentAnalysis.evaluation),
        pv: line.pv || line.principal_variation || line.principalVariation || []
      }));
    } else if (currentAnalysis.multipv && Array.isArray(currentAnalysis.multipv)) {
      topMoves = currentAnalysis.multipv.slice(0, 3).map(line => ({
        move: line.move || line.best_move || currentAnalysis.best_move,
        evaluation: line.evaluation || currentAnalysis.evaluation,
        evalScore: parseEval(line.evaluation || currentAnalysis.evaluation),
        pv: line.pv || line.principal_variation || line.principalVariation || []
      }));
    } else {
      // Fallback: create single entry from best move
      topMoves = [{
        move: currentAnalysis.best_move,
        evaluation: currentAnalysis.evaluation,
        evalScore: parseEval(currentAnalysis.evaluation),
        pv: principalVariation
      }];
    }

    let afterSolutionAnalysis = null;
    if (solutionMoves && solutionMoves.length > 0) {
      const afterSolutionFen = applyMove(fen, solutionMoves[0]);
      if (afterSolutionFen && afterSolutionFen !== fen) {
        try {
          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(() => {
            controller2.abort();
          }, 20000);

          try {
            const afterResponse = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${HF_TOKEN}`
              },
              body: JSON.stringify({ fen: afterSolutionFen, depth: 18 }),
              signal: controller2.signal
            });
            clearTimeout(timeoutId2);
            
            if (afterResponse.ok) {
              afterSolutionAnalysis = await afterResponse.json();
            }
          } catch (error) {
            clearTimeout(timeoutId2);
            if (error.name === 'AbortError') {
              console.error('After-solution analysis timeout');
            } else {
              throw error;
            }
          }
        } catch (error) {
          console.error('Error analyzing after-solution position:', error);
        }
      }
    }


    const bestMove = currentAnalysis.best_move || null;
    

    let evaluation = null;
    let isMate = false;
    let mateIn = null;
    let evalScore = 0;
    
    if (currentAnalysis.evaluation) {
      if (currentAnalysis.evaluation.type === 'cp') {
        evalScore = currentAnalysis.evaluation.value;
        evaluation = (evalScore / 100).toFixed(1);
        if (evalScore > 0) evaluation = '+' + evaluation;
      } else if (currentAnalysis.evaluation.type === 'mate') {
        isMate = true;
        mateIn = Math.abs(currentAnalysis.evaluation.value);
        evaluation = currentAnalysis.evaluation.value > 0 ? `M${mateIn}` : `-M${mateIn}`;
        evalScore = currentAnalysis.evaluation.value > 0 ? 10000 : -10000;
      }
    }


    const tacticalTheme = identifyTacticalTheme(
      fen,
      solutionMoves,
      currentAnalysis,
      afterSolutionAnalysis
    );

    return {
      bestMove,
      evaluation,
      evalScore,
      isMate,
      mateIn,
      tacticalTheme,
      principalVariation: principalVariation.slice(0, 8), // First 8 moves of PV
      topMoves: topMoves.map(m => ({
        move: m.move,
        evaluation: formatEval(m.evaluation),
        evalScore: m.evalScore,
        pv: m.pv.slice(0, 4) // First 4 moves of each line
      })),
      opponentBestResponse: afterSolutionAnalysis?.best_move || null,
      opponentEvalAfterSolution: afterSolutionAnalysis?.evaluation || null
    };

  } catch (error) {
    console.error('Stockfish analysis failed:', error);
    return null;
  }
}


function applyMove(fen, move) {
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
    console.error('Error applying move:', error);
    return fen;
  }
}


function identifyTacticalTheme(fen, solution, beforeAnalysis, afterAnalysis) {
  if (!solution || solution.length === 0) {
    return 'Positional';
  }

  const move = solution[0].toLowerCase();
  

  if (beforeAnalysis?.evaluation?.type === 'mate' && beforeAnalysis.evaluation.value > 0) {
    return 'Forced Checkmate';
  }
  
  if (move.includes('x')) {
    try {
      const chess = new Chess(fen);
      const from = move.substring(0, 2);
      const to = move.substring(2, 4);
      const promotion = move.length > 4 ? move.substring(4) : undefined;
      
      const moveObj = chess.move({ from, to, promotion: promotion || 'q' });
      if (moveObj && chess.in_check()) {
        return 'Checking Capture';
      }
    } catch (e) {

    }
    

    if (beforeAnalysis?.evaluation && afterAnalysis?.evaluation) {
      const beforeEval = parseEval(beforeAnalysis.evaluation);
      const afterEval = parseEval(afterAnalysis.evaluation);
      const evalDiff = afterEval - beforeEval;
      
      if (evalDiff > 5) {
        return 'Winning Material';
      }
    }
    
    return 'Tactical Capture';
  }
  

  try {
    const chess = new Chess(fen);
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    const promotion = move.length > 4 ? move.substring(4) : undefined;
    
    const moveObj = chess.move({ from, to, promotion: promotion || 'q' });
    if (moveObj && chess.in_check()) {
      return 'Check';
    }
  } catch (e) {

  }
  
  return 'Tactical Shot';
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


async function getGPTExplanation(fen, stockfishAnalysis, userQuestion, moveHistory, solutionMoves, puzzleType) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    console.log('No OpenAI API key');
    return solutionMoves[0] 
      ? `The best move is ${solutionMoves[0]}. This appears to be a ${puzzleType || 'tactical'} puzzle.`
      : 'Unable to generate explanation. Please check API configuration.';
  }


  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(fen, stockfishAnalysis, userQuestion, moveHistory, solutionMoves, puzzleType);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 20000); 

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 300
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('GPT API timeout');
        throw new Error('GPT API request timeout');
      }
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GPT API error:', errorText);
      throw new Error('GPT API request failed');
    }

    const data = await response.json();
    return data.choices[0].message.content || 'Unable to generate explanation.';

  } catch (error) {
    console.error('GPT explanation failed:', error);
    return solutionMoves[0] 
      ? `The best move is ${solutionMoves[0]}. This appears to be a ${puzzleType || 'tactical'} puzzle.`
      : 'Unable to generate explanation at this time.';
  }
}

function buildSystemPrompt() {
  return `You are a chess coach explaining puzzles. You have Stockfish engine analysis.

🚨 CRITICAL RULES - NEVER VIOLATE THESE:

1. ONLY explain variations that appear in the "FORCED SEQUENCE" or "pv" data provided. If a move sequence is not in the data, DO NOT mention it.

2. DO NOT invent moves, threats, or piece placements. If it's not in the Stockfish data or FEN, don't mention it.

3. When mentioning piece locations, they must be from the FEN or confirmed by the provided data.

4. If you don't have enough data to explain something, say "The engine shows this is best" instead of guessing or inventing details.

5. If the user says something unrelated to chess, chat normally like a friendly person.

LENGTH REQUIREMENT:
- Maximum 4 sentences
- Maximum 100 words
- Get to the point: best move, why it works (using PV), why alternatives fail

✅ GOOD (uses provided data):
"The best move is 1.Be5 (-2.8). The forcing sequence is: 1.Be5 Qxe5 2.Rxd5+ Kh8 3.Rxd8, winning the rook. Alternative moves like 1.Rxd5 (+0.9) are much weaker because Black can defend better."

❌ BAD (invented):
"The queen is protecting d5, so we deflect it" (you don't know if queen is protecting d5!)
"After Qxe5, the queen leaves its defense" (only say this if Qxe5 is in the PV!)

REQUIRED FORMAT:
1. State the best move and evaluation
2. Show the forcing sequence from Stockfish's PV (if available) - use EXACT moves from the data
3. Explain why alternatives are worse using their evaluations from the data
4. Keep it 3-4 sentences MAX

Now explain this puzzle using ONLY the Stockfish data provided. Do not invent variations.`;
}

function buildUserPrompt(fen, analysis, userQuestion, moveHistory, solutionMoves, puzzleType) {
  if (!analysis) {
    return `Position (FEN): ${fen}
${solutionMoves[0] ? `Best Move: ${solutionMoves[0]}` : ''}
Puzzle type: ${puzzleType || 'tactics'}
${userQuestion ? `User question: ${userQuestion}` : 'Why is this the best move?'}

Note: Stockfish analysis unavailable. Provide a general explanation based on the position and the best move provided.`;
  }

  const evalText = analysis.isMate 
    ? `FORCED MATE IN ${analysis.mateIn} MOVES`
    : `Evaluation: ${analysis.evaluation}`;

  const pvText = analysis.principalVariation && analysis.principalVariation.length > 0
    ? `- FORCED SEQUENCE: ${analysis.principalVariation.slice(0, 6).join(' ')}`
    : '';

  const alternativesText = analysis.topMoves && analysis.topMoves.length > 1
    ? `\n- Alternative moves and why they're worse:\n${analysis.topMoves.slice(1).map((m, i) => 
        `  ${i+2}. ${m.move} (${m.evaluation})${m.pv && m.pv.length > 0 ? ` - leads to ${m.pv.slice(0, 3).join(' ')}` : ''}`
      ).join('\n')}`
    : '';

  return `POSITION (FEN): ${fen}

STOCKFISH ANALYSIS:
- Best Move: ${analysis.bestMove || solutionMoves[0] || 'Unknown'}
- ${evalText}
${pvText}
- Tactical Theme: ${analysis.tacticalTheme}${alternativesText}
${analysis.opponentBestResponse ? `- Opponent's best response after solution: ${analysis.opponentBestResponse}` : ''}
${analysis.opponentEvalAfterSolution ? `- Position evaluation after solution: ${formatEval(analysis.opponentEvalAfterSolution)}` : ''}

${solutionMoves[0] ? `SOLUTION MOVE: ${solutionMoves[0]}` : ''}
${puzzleType ? `PUZZLE TYPE: ${puzzleType}` : ''}
${moveHistory ? `MOVE HISTORY:\n${Array.isArray(moveHistory) ? moveHistory.join(' ') : moveHistory}` : ''}

USER QUESTION: ${userQuestion || 'Why is this the best move?'}

Explain the solution using ONLY the Stockfish data above. 
- Use the FORCED SEQUENCE exactly as shown (do not invent moves)
- Compare alternatives using their evaluations
- Maximum 4 sentences, 100 words
- Do not mention piece placements or threats unless they appear in the data`;
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
