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
    console.error('No FEN provided in request body');
    return res.status(400).json({ error: 'FEN position is required' });
  }

  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    console.error('HF_TOKEN environment variable is not set');
    return res.status(500).json({ error: 'API token not configured' });
  }
  
  console.log('Received FEN analysis request:', fen.substring(0, 30) + '...');

  try {
    console.log('Calling HuggingFace API with depth 15...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('Timeout triggered for FEN:', fen.substring(0, 30) + '...');
      controller.abort();
    }, 20000); // 20 second timeout - reduced from 30s to prevent 502s
    
    const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ fen, depth: 15 }), // Reduced depth for faster analysis
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log('Got response from HuggingFace API, status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('HuggingFace API returned error status:', response.status, 'Error:', errorText);
      return res.status(response.status).json({ 
        error: `Stockfish API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    console.log('Successfully received data from HuggingFace API for FEN:', fen.substring(0, 30) + '...');
    console.log('Best move:', data.best_move, 'Eval:', data.evaluation);
    
    // Validate that we got a valid response
    if (!data.best_move) {
      console.error('No best_move in response:', data);
      throw new Error('Invalid API response: no best_move');
    }
    
    let evalScore = 0;
    if (data.evaluation) {
      if (data.evaluation.type === 'cp') {
        evalScore = data.evaluation.value;
      } else if (data.evaluation.type === 'mate') {
        evalScore = data.evaluation.value > 0 ? 10000 : -10000;
      }
    }
    
    console.log('Returning:', { evalScore, best_move: data.best_move, fen: data.fen });

    return res.status(200).json({
      fen: data.fen,
      move: data.best_move,
      eval: evalScore / 100,
      depth: 15,
      time: 1000
    });

  } catch (error) {
    console.error('Stockfish API error:', error.name, error.message);
    console.error('Error stack:', error.stack);
    
    // Check if it's an abort (timeout)
    if (error.name === 'AbortError') {
      console.error('Request timed out after 20 seconds');
      return res.status(504).json({
        error: 'Request timeout',
        details: 'The analysis request timed out after 20 seconds',
        fallback: true
      });
    }
    
    // Return error response for other errors
    return res.status(500).json({
      error: 'Stockfish API call failed',
      details: error.message,
      fallback: true
    });
  }
}