export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, year = '2025', month } = req.query;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Fetch games for the specified month
    const response = await fetch(
      `https://api.chess.com/pub/player/${username}/games/${year}/${month}/pgn`,
      {
        headers: {
          'User-Agent': 'PawnPush/1.0'
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Chess.com API error: ${response.status}` 
      });
    }

    const pgnText = await response.text();
    
    const games = [];
    const gameBlocks = pgnText.split('\n\n\n').filter(block => block.trim());
    
    gameBlocks.forEach(block => {
      const lines = block.split('\n');
      const headers = {};
      let moves = '';
      
      lines.forEach(line => {
        if (line.startsWith('[')) {
          const match = line.match(/\[(\w+)\s+"([^"]+)"\]/);
          if (match) {
            headers[match[1]] = match[2];
          }
        } else {
          moves += line + ' ';
        }
      });
      
      if (headers.Event || headers.White || headers.Black) {
        games.push({
          ...headers,
          moves: moves.trim(),
          pgn: block
        });
      }
    });

    return res.status(200).json({
      username,
      year,
      month,
      games: games,
      count: games.length
    });

  } catch (error) {
    console.error('Chess.com API error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch games from Chess.com',
      details: error.message 
    });
  }
}
