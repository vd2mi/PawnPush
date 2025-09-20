import fetch from 'node-fetch';

export default async function handler(req, res) {
  try {
    const { fen, userMove, question } = req.query;

    if (!fen) return res.status(400).json({ hint: 'FEN is required' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ hint: 'AI key not configured' });

    // Call a Stockfish API (example: lichess.org’s cloud API)
    const sfResp = await fetch('https://lichess.org/api/cloud-eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `fen=${encodeURIComponent(fen)}&multiPv=1`
    });

    const sfData = await sfResp.json();
    if (!sfData?.pvs?.[0]?.moves) return res.status(500).json({ hint: 'Stockfish API error' });

    const bestMove = sfData.pvs[0].moves.split(' ')[0];

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
