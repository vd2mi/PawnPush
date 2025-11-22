export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fen, depth = 18 } = req.body;

  if (!fen) {
    return res.status(400).json({ error: 'FEN is required' });
  }

  const HF_TOKEN = process.env.HF_TOKEN;

  if (!HF_TOKEN) {
    return res.status(500).json({ error: 'HF_TOKEN not configured' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ 
        fen, 
        depth,
        multipv: 3
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('HF API error:', errorText);
      return res.status(response.status).json({ error: 'HF API error' });
    }

    const data = await response.json();

    return res.status(200).json({
      score: data.evaluation?.value || 0,
      mate: data.evaluation?.type === 'mate' ? data.evaluation.value : null,
      depth: data.depth || depth,
      bestMove: data.best_move || data.bestMove,
      multiPV: data.lines || data.multipv || []
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed' });
  }
}

