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
  
      // SIMPLIFIED VERSION - Skip Lichess for now, go straight to GPT
      let bestMove = null;
      let evaluation = null;
  
      // Basic chess analysis with GPT only (more reliable)
      const gptPrompt = `Analyze this chess position and give the best move:
  
  FEN: ${fen}
  ${userMove ? `User is considering: ${userMove}` : ''}
  Question: ${question || 'What is the best move?'}
  
  Provide:
  1. The best move in algebraic notation
  2. Brief explanation why it's good
  3. Any key tactics
  
  Keep it concise and educational.`;
  
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
        bestMove: 'See analysis',
        explanation: explanation,
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