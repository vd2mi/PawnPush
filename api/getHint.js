import fetch from 'node-fetch';
import Stockfish from 'stockfish.js';

export default async function handler(req, res) {
  try {
    const { fen, userMove, question } = req.query;

    if (!fen) return res.status(400).json({ hint: 'FEN is required' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ hint: 'AI key not configured' });

    // Initialize Stockfish.js engine
    const engine = Stockfish();
    let bestMove = null;

    engine.onmessage = (msg) => {
      const line = msg.data || msg;
      if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1];
      }
    };

    // Send FEN and start analysis
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage('go depth 15');

    // Wait until Stockfish returns a move
    while (!bestMove) await new Promise(r => setTimeout(r, 50));

    // Compose prompt for GPT
    const prompt = `
Chess position (FEN): ${fen}
User move: ${userMove || 'N/A'}
Stockfish best move: ${bestMove}
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
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 250
      })
    });

    const data = await response.json();
    if (!data.choices?.[0]?.message?.content) return res.status(500).json({ hint: 'GPT response error' });

    res.status(200).json({ hint: data.choices[0].message.content });

  } catch (err) {
    console.error('Error in getHint:', err);
    res.status(500).json({ hint: 'Server error' });
  }
}
