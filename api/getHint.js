// /api/getHint.js
export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      const { fen, userMove, stockfishMove, question } = req.query;
  
      if (!fen) {
        return res.status(400).json({ error: 'FEN is required' });
      }
  
      console.log('Getting hint for FEN:', fen);
  
      // Try Chess-API.com for real Stockfish analysis
      let bestMove = null;
      let evaluation = null;
      let engineError = null;
  
      try {
        console.log('Trying Chess-API.com for engine analysis...');
        
        const chessApiResponse = await fetch('https://chess-api.com/v1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fen: fen,
            depth: 15
          })
        });
  
        if (chessApiResponse.ok) {
          const chessApiData = await chessApiResponse.json();
          console.log('Chess-API response:', chessApiData);
          
          if (chessApiData.bestMove) {
            bestMove = chessApiData.bestMove;
            evaluation = chessApiData.evaluation ? `${chessApiData.evaluation / 100}` : 'Unknown';
            console.log('Got engine move:', bestMove);
          }
        } else {
          engineError = `Chess-API returned ${chessApiResponse.status}`;
        }
      } catch (apiError) {
        engineError = `Chess-API failed: ${apiError.message}`;
        console.log('Chess-API failed:', apiError);
      }
  
      // Improved prompt with engine data if available
      const gptPrompt = `You are analyzing a chess position${bestMove ? ' with engine assistance' : ''}.
  
  FEN: ${fen}
  ${bestMove ? `Engine suggests: ${bestMove}` : ''}
  ${evaluation ? `Position evaluation: ${evaluation}` : ''}
  ${userMove ? `User is considering: ${userMove}` : ''}
  Question: ${question || 'What is the best move?'}
  
  ${bestMove ? 
    `The chess engine suggests ${bestMove}. Please explain why this move is strong and what ideas it contains.` :
    `Please analyze this position carefully. Only suggest moves that exist in this FEN position. If uncertain, focus on general principles.`
  }
  
  Provide clear, educational analysis.`;
  
      // Check if OpenAI key exists
      if (!process.env.OPENAI_API_KEY) {
        console.log('No OpenAI API key, returning basic analysis');
        return res.status(200).json({
          success: true,
          hint: 'OpenAI API key not configured. Please add OPENAI_API_KEY to environment variables.',
          bestMove: 'Unknown',
          explanation: 'API configuration needed'
        });
      }
  
      const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are a chess coach. Analyze positions and suggest moves with explanations.' },
            { role: 'user', content: gptPrompt }
          ],
          max_tokens: 300,
          temperature: 0.2
        })
      });
  
      if (!gptResponse.ok) {
        const errorText = await gptResponse.text();
        console.error('GPT Error:', errorText);
        throw new Error(`OpenAI API failed: ${gptResponse.status}`);
      }
  
      const gptData = await gptResponse.json();
      console.log('GPT Response:', gptData);
      
      const explanation = gptData.choices?.[0]?.message?.content || 'No analysis available';
      console.log('Extracted explanation:', explanation);
  
      // Return in format your frontend expects
      const response = {
        success: true,
        hint: explanation,
        bestMove: bestMove || 'See analysis',
        evaluation: evaluation,
        explanation: explanation,
        engineUsed: bestMove ? 'Chess-API.com (Stockfish 17)' : 'GPT Analysis Only',
        engineError: engineError,
        timestamp: new Date().toISOString()
      };
      
      console.log('Final API response:', response);
      return res.status(200).json(response);
  
    } catch (error) {
      console.error('API Error:', error);
      
      // Always return something instead of crashing
      return res.status(200).json({
        success: false,
        hint: `Error: ${error.message}. For this position, look for tactical patterns like pins, forks, and checks.`,
        bestMove: 'Error',
        explanation: 'API temporarily unavailable'
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