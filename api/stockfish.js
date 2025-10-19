// Vercel Serverless Function to proxy Stockfish API calls
// This keeps the HF token secure on the server side

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

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

  // Get the HF token from environment variables
  const HF_TOKEN = process.env.HF_TOKEN;

  if (!HF_TOKEN) {
    console.error('HF_TOKEN environment variable is not set');
    return res.status(500).json({ error: 'API token not configured' });
  }

  try {
    const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ fen })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stockfish API error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `Stockfish API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    // Transform the response to match the expected format
    // The API returns: { fen, best_move, evaluation: { type: "cp", value: X } }
    // We need to convert to centipawns format
    let evalScore = 0;
    if (data.evaluation) {
      if (data.evaluation.type === 'cp') {
        evalScore = data.evaluation.value;
      } else if (data.evaluation.type === 'mate') {
        // Convert mate score to a large number
        evalScore = data.evaluation.value > 0 ? 10000 : -10000;
      }
    }

    // Return in a format compatible with the frontend
    return res.status(200).json({
      fen: data.fen,
      move: data.best_move,
      eval: evalScore / 100, // Convert centipawns to pawns
      depth: 20, // Stockfish typically analyzes deep
      time: 1000
    });

  } catch (error) {
    console.error('Error calling Stockfish API:', error);
    return res.status(500).json({ 
      error: 'Failed to analyze position',
      details: error.message 
    });
  }
}

