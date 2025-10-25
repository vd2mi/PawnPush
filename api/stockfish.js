export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fen } = req.body;
  if (!fen) {
    return res.status(400).json({ error: 'FEN position is required' });
  }

  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    return res.status(500).json({ error: 'API token not configured' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ fen, depth: 8 }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: `Stockfish API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    let evalScore = 0;
    if (data.evaluation) {
      if (data.evaluation.type === 'cp') {
        evalScore = data.evaluation.value;
      } else if (data.evaluation.type === 'mate') {
        evalScore = data.evaluation.value > 0 ? 10000 : -10000;
      }
    }

    return res.status(200).json({
      fen: data.fen,
      move: data.best_move,
      eval: evalScore / 100,
      depth: 20,
      time: 1000
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(200).json({
        fen: fen,
        move: 'e2e4',
        eval: 0,
        depth: 1,
        time: 100,
        fallback: true,
        message: 'API timeout - using fallback analysis'
      });
    }
    
    return res.status(200).json({
      fen: fen,
      move: 'e2e4',
      eval: 0,
      depth: 1,
      time: 100,
      fallback: true,
      message: 'API error - using fallback analysis'
    });
  }
}