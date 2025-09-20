// /api/getHint.js
export default async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      const { fen, userMove, stockfishMove, question } = req.query;
  
      if (!fen) {
        return res.status(400).json({ error: 'FEN is required' });
      }
  
      console.log('Getting hint for FEN:', fen);
      console.log('Question:', question);
  
      // Try to get Stockfish evaluation from Lichess
      let bestMove = null;
      let evaluation = null;
      let engineError = null;
  
      try {
        // Method 1: Try Lichess Cloud Eval API
        const lichessResponse = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`, {
          method: 'GET',
          headers: {
            'User-Agent': 'Chess-Hint-App/1.0'
          },
          timeout: 8000
        });
  
        if (lichessResponse.ok) {
          const lichessData = await lichessResponse.json();
          console.log('Lichess response:', lichessData);
  
          if (lichessData.pvs && lichessData.pvs.length > 0) {
            const bestLine = lichessData.pvs[0];
            bestMove = bestLine.moves.split(' ')[0]; // First move
            evaluation = bestLine.cp ? `${bestLine.cp / 100}` : (bestLine.mate ? `Mate in ${bestLine.mate}` : 'Unknown');
          }
        } else {
          engineError = `Lichess API returned ${lichessResponse.status}`;
        }
      } catch (lichessErr) {
        engineError = `Lichess API failed: ${lichessErr.message}`;
        console.log('Lichess failed, trying alternative...');
  
        // Method 2: Try Chess.com API (if available)
        try {
          const chesscomResponse = await fetch('https://api.chess.com/pub/puzzle', {
            timeout: 5000
          });
          // This is just a fallback example - you'd need a real analysis API
        } catch (chesscomErr) {
          console.log('Chess.com API also failed');
        }
      }
  
      // Method 3: If all APIs fail, try a simple heuristic or basic analysis
      if (!bestMove) {
        console.log('All engines failed, using GPT analysis only');
        bestMove = 'Unable to calculate'; // or try to extract from basic rules
      }
  
      // Now use GPT to explain the position and give advice
      const gptPrompt = `
  You are a chess master analyzing this position:
  
  FEN: ${fen}
  ${bestMove && bestMove !== 'Unable to calculate' ? `Best engine move: ${bestMove}` : ''}
  ${evaluation ? `Position evaluation: ${evaluation}` : ''}
  ${userMove ? `User is considering: ${userMove}` : ''}
  ${stockfishMove ? `Previous computer move: ${stockfishMove}` : ''}
  
  Question: ${question || 'What is the best move and why?'}
  
  Please provide:
  1. The best move (if you can determine it)
  2. Clear explanation of why it's good
  3. What to look for in this position
  4. Any tactical themes present
  
  Be concise but educational. If the engine couldn't calculate, still give your best chess advice.`;
  
      const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are a chess grandmaster providing educational analysis.' },
            { role: 'user', content: gptPrompt }
          ],
          max_tokens: 500,
          temperature: 0.3
        })
      });
  
      if (!gptResponse.ok) {
        throw new Error(`GPT API failed: ${gptResponse.status}`);
      }
  
      const gptData = await gptResponse.json();
      const explanation = gptData.choices[0].message.content;
  
      // Return successful response
      return res.status(200).json({
        success: true,
        bestMove: bestMove,
        evaluation: evaluation,
        explanation: explanation,
        engineUsed: bestMove !== 'Unable to calculate' ? 'Lichess Cloud Eval' : 'GPT Analysis Only',
        engineError: engineError,
        timestamp: new Date().toISOString()
      });
  
    } catch (error) {
      console.error('API Error:', error);
      
      // Return error but don't crash
      return res.status(500).json({
        success: false,
        error: error.message,
        fallbackAdvice: 'Unable to analyze position. Try checking for basic tactics: pins, forks, discovered attacks, and piece safety.'
      });
    }
  }
  
  // Alternative simpler version if you want to skip engine entirely:
  export async function handlerGPTOnly(req, res) {
    const { fen, question } = req.query;
  
    try {
      const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { 
              role: 'system', 
              content: 'You are a chess grandmaster. Analyze positions and suggest the best moves with clear explanations.' 
            },
            { 
              role: 'user', 
              content: `Analyze this chess position: ${fen}\nQuestion: ${question}\n\nProvide: 1) Best move 2) Why it's good 3) Key ideas to remember` 
            }
          ],
          max_tokens: 400,
          temperature: 0.2
        })
      });
  
      const gptData = await gptResponse.json();
      
      return res.status(200).json({
        success: true,
        explanation: gptData.choices[0].message.content,
        method: 'GPT-4 Analysis'
      });
  
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }