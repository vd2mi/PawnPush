import fetch from 'node-fetch';
import { spawn } from 'child_process';

export default async function handler(req, res) {
  try {
    const { fen, userMove, question } = req.query;

    if (!fen) return res.status(400).json({ hint: 'FEN is required' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ hint: 'AI service config error' });

    const engine = spawn('stockfish'); // Node spawns the binary

    let bestMove = null;
    engine.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1];
      }
    });

    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write('go depth 15\n');

    // wait until Stockfish returns a move
    while (!bestMove) await new Promise(r => setTimeout(r, 50));

    engine.kill(); // stop engine

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
        max_tokens: 200
      })
    });

    const data = await response.json();

    if (!response.ok || !data.choices?.[0]?.message) {
      console.error('OpenAI API error:', data);
      return res.status(500).json({ hint: 'AI service error or invalid response' });
    }

    res.status(200).json({ hint: data.choices[0].message.content });

  } catch (err) {
    console.error('Full error details:', err);
    res.status(500).json({ hint: 'Error fetching hint from AI' });
  }
}
