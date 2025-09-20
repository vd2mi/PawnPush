export default async function handler(req, res) {
    
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
      const { fen, userMove, question, solutionMove, puzzleType, moveNumber } = req.query;
  
      if (!fen) {
        return res.status(400).json({ error: 'FEN is required' });
      }
  
      console.log('Getting hint for FEN:', fen);
      console.log('Solution move:', solutionMove);
      console.log('Puzzle type:', puzzleType);
  
      
      if (!process.env.OPENAI_API_KEY) {
        console.log('No OpenAI API key');
        return res.status(200).json({
          success: true,
          hint: `The best move is ${solutionMove || 'unknown'}. OpenAI API key needed for detailed explanation.`,
          bestMove: solutionMove || 'Unknown',
          explanation: 'API configuration needed'
        });
      }
      const gptPrompt = `You are a chess coach. Be concise and direct.
  
  Position: ${fen}
  Best move: ${solutionMove}
  Question: "${question || 'What is the best move?'}"
  
  Explain in 2-3 sentences:
  - Why ${solutionMove} is the best move
  - What tactical pattern it uses (fork, pin, skewer, etc.)
  - The immediate result
  
  Be brief and educational. Don't say "yes indeed" or repeat the question.`;
  
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
              content: 'You are an expert chess coach. You always have the correct answer and explain chess tactics clearly to help students learn.' 
            },
            { role: 'user', content: gptPrompt }
          ],
          max_tokens: 150,
          temperature: 0.2
        })
      });
  
      if (!gptResponse.ok) {
        const errorText = await gptResponse.text();
        console.error('GPT Error:', errorText);
        
        
        return res.status(200).json({
          success: true,
          hint: `The best move is ${solutionMove}. This appears to be a ${puzzleType || 'tactical'} puzzle.`,
          bestMove: solutionMove,
          explanation: `Best move: ${solutionMove}`
        });
      }
  
      const gptData = await gptResponse.json();
      console.log('GPT Response received');
      
      const explanation = gptData.choices?.[0]?.message?.content || `The best move is ${solutionMove}`;
  
      
      const response = {
        success: true,
        hint: explanation,
        bestMove: solutionMove,
        puzzleType: puzzleType,
        explanation: explanation,
        method: 'Solution-guided GPT analysis',
        timestamp: new Date().toISOString()
      };
      
      console.log('Returning hint with solution:', solutionMove);
      return res.status(200).json(response);
  
    } catch (error) {
      console.error('API Error:', error);
      
      return res.status(200).json({
        success: true,
        hint: `Error occurred, but try looking for tactical patterns like checks, captures, and threats.`,
        bestMove: req.query.solutionMove || 'Unknown',
        explanation: 'API temporarily unavailable'
      });
    }
  }