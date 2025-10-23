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
    console.log('Making request to HuggingFace API with FEN:', fen);
    console.log('HF_TOKEN present:', !!HF_TOKEN);
    console.log('Request body:', JSON.stringify({ 
      fen: fen,
      depth: 12,
      time: 5000
    }));
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);
    
    const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ 
        fen: fen,
        depth: 12,
        time: 5000
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log('API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stockfish API error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `Stockfish API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    console.log('API response data:', JSON.stringify(data, null, 2));
    

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
    
    // Handle timeout errors specifically
    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: 'Request timeout - Stockfish API took too long to respond',
        details: 'The analysis request timed out after 50 seconds'
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to analyze position',
      details: error.message 
    });
  }
}

