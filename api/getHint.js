import fetch from 'node-fetch';

export default async function handler(req, res) {
    try {
        const { fen, userMove, stockfishMove, question } = req.query;

        // Check if API key exists
        if (!process.env.OPENAI_API_KEY) {
            console.error('OpenAI API key is missing');
            return res.status(500).json({ hint: 'AI service configuration error' });
        }

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
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 200
            })
        });

        const data = await response.json();

        // Check if OpenAI returned an error
        if (!response.ok) {
            console.error('OpenAI API error:', data);
            return res.status(500).json({ hint: 'AI service error' });
        }

        // Check if response has expected structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('Unexpected OpenAI response structure:', data);
            return res.status(500).json({ hint: 'Invalid AI response' });
        }

        res.status(200).json({ hint: data.choices[0].message.content });

    } catch (err) {
        console.error('Full error details:', err);
        res.status(500).json({ hint: 'Error fetching hint from AI' });
    }
}
  