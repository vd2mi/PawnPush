import fetch from 'node-fetch';

export default async function handler(req, res) {
    try {
      const { fen, userMove, stockfishMove, question } = req.query;
  
      const prompt = `
  Chess position (FEN): ${fen}
  User move: ${userMove || 'N/A'}
  Stockfish best move: ${stockfishMove || 'N/A'}
  User question: ${question || 'N/A'}
  Explain simply why this move is good/bad and give a tip for the next move.
      `;
  
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-5-nano',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200
        })
      });
  
      const data = await response.json();
      res.status(200).json({ hint: data.choices[0].message.content });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ hint: 'Error fetching hint from AI' });
    }
  }
  