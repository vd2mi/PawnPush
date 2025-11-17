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
    const result = await runAgenticCoach(fen, userQuestion, solutionMoves, moveHistory, puzzleType);
    

    return res.status(200).json({
      success: true,
      hint: result.explanation,
      explanation: result.explanation,
      bestMove: solutionMoves[0] || result.bestMove || 'Unknown',
      puzzleType: puzzleType,
      analysisSteps: result.analysisSteps,
      method: 'Agentic GPT + Stockfish',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Agentic coach error:', error);
    
    // Fallback response
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
  const conversationHistory = [
    {
      role: 'system',
      content: buildSystemPrompt(fen, solutionMoves, moveHistory, puzzleType)
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
        // Process tool calls
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
              bestMove = analysisResult.bestMove;
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

  return {
    explanation: finalExplanation,
    analysisSteps: analysisSteps,
    bestMove: bestMove || solutionMoves[0] || null
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
        temperature: 0.7,
        max_tokens: 500
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

    
    let topMoves = [];
    if (data.lines && Array.isArray(data.lines)) {
      topMoves = data.lines.slice(0, multipv || 3).map(line => ({
        move: line.move || line.best_move || bestMove,
        evaluation: formatEval(line.evaluation || data.evaluation),
        evalScore: parseEval(line.evaluation || data.evaluation),
        pv: line.pv || line.principal_variation || line.principalVariation || []
      }));
    } else if (data.multipv && Array.isArray(data.multipv)) {
      topMoves = data.multipv.slice(0, multipv || 3).map(line => ({
        move: line.move || line.best_move || bestMove,
        evaluation: formatEval(line.evaluation || data.evaluation),
        evalScore: parseEval(line.evaluation || data.evaluation),
        pv: line.pv || line.principal_variation || line.principalVariation || []
      }));
    } else {
      
      topMoves = [{
        move: bestMove,
        evaluation: formatEval(data.evaluation),
        evalScore: parseEval(data.evaluation),
        pv: principalVariation
      }];
    }

    return {
      bestMove,
      evaluation,
      evalScore,
      isMate,
      mateIn,
      topMoves: topMoves.map(m => ({
        move: m.move,
        evaluation: m.evaluation,
        pv: m.pv.slice(0, 6) 
      })),
      principalVariation: principalVariation.slice(0, 8), // First 8 moves
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


function buildSystemPrompt(fen, solutionMoves, moveHistory, puzzleType) {
  
  let afterSolutionFen = null;
  if (solutionMoves && solutionMoves.length > 0) {
    afterSolutionFen = applyMoveToFen(fen, solutionMoves[0]);
  }

  return `You are an expert chess coach with access to Stockfish.  

Use the "analyze_position" tool to gather engine evaluations as needed.

Your reasoning steps:

1. First analyze the main position (multipv=3).  
2. If there is a provided best move/solution move, analyze the position after that move.  
3. If uncertain, analyze alternatives with multipv or manual testing.  
4. Once you have enough data to explain the position accurately, output the final explanation.

Rules:
- You MUST NOT invent moves, threats, tactics, or piece interactions. 
- Only state what Stockfish explicitly shows.
- Speak confidently even if the engine didn't give long variations.
- Use concrete move sequences from the PV.
- Max 4 sentences.

When you need information, call "analyze_position".

When ready, stop and output your final explanation.

Current position (FEN): ${fen}
${solutionMoves && solutionMoves.length > 0 ? `Solution move(s): ${solutionMoves.join(' ')}` : ''}
${afterSolutionFen && afterSolutionFen !== fen ? `Position after solution (FEN): ${afterSolutionFen}` : ''}
${puzzleType ? `Puzzle type: ${puzzleType}` : ''}
${moveHistory ? `Move history: ${Array.isArray(moveHistory) ? moveHistory.join(' ') : moveHistory}` : ''}`;
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
