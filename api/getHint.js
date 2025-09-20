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
      const { fen, userMove, question, solutionMove, puzzleType, moveNumber } = req.query;
  
      if (!fen) {
        return res.status(400).json({ error: 'FEN is required' });
      }
  
      console.log('Getting hint for FEN:', fen);
      console.log('Solution move:', solutionMove);
      console.log('Puzzle type:', puzzleType);
  
      // Check if OpenAI key exists
      if (!process.env.OPENAI_API_KEY) {
        console.log('No OpenAI API key');
        return res.status(200).json({
          success: true,
          hint: `The best move is ${solutionMove || 'unknown'}. OpenAI API key needed for detailed explanation.`,
          bestMove: solutionMove || 'Unknown',
          explanation: 'API configuration needed'
        });
      }
  
      // Create intelligent prompt with the CORRECT answer
      const gptPrompt = `You are a chess coach explaining a tactical puzzle to a student.
  
  Position (FEN): ${fen}
  Puzzle Type: ${puzzleType || 'tactical puzzle'}
  Correct Answer: ${solutionMove}
  ${userMove ? `Student is considering: ${userMove}` : ''}
  ${moveNumber ? `This is move ${moveNumber} in the solution` : ''}
  
  Student asks: "${question || 'What is the best move?'}"
  
  Your job:
  1. Confirm that ${solutionMove} is indeed the best move
  2. Explain WHY this move works (what tactical theme it uses)
  3. Show what happens after this move
  4. If the student suggested a different move, explain why ${solutionMove} is better
  
  ${userMove && userMove !== solutionMove ? 
    `The student suggested ${userMove}, but the correct answer is ${solutionMove}. Explain why ${solutionMove} is superior.` : 
    `Explain why ${solutionMove} is the key move in this position.`
  }
  
  Focus on the tactical pattern (fork, pin, skewer, discovered attack, etc.) and be educational.`;
  
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
          max_tokens: 400,
          temperature: 0.3
        })
      });
  
      if (!gptResponse.ok) {
        const errorText = await gptResponse.text();
        console.error('GPT Error:', errorText);
        
        // Return basic hint even if GPT fails
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
  
      // Return in format your frontend expects
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
      
      // Always return something useful
      return res.status(200).json({
        success: true,
        hint: `Error occurred, but try looking for tactical patterns like checks, captures, and threats.`,
        bestMove: req.query.solutionMove || 'Unknown',
        explanation: 'API temporarily unavailable'
      });
    }
  }