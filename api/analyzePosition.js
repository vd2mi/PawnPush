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

    const { fen, depth = 18, multipv = 3 } = req.body || {};

    if (!fen) {
        return res.status(400).json({ error: 'FEN is required' });
    }

    const token = process.env.HF_TOKEN;
    if (!token) {
        return res.status(500).json({ error: 'HF_TOKEN not configured' });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 22000);

        const response = await fetch('https://vd2mi-stockfishapi.hf.space/analyze/fen', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ fen, depth, multipv }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const text = await response.text();
            console.error('HF API error:', text);
            return res.status(response.status).json({ error: 'HF API error' });
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        console.error('HF proxy error:', error);
        return res.status(500).json({ error: 'Analysis failed' });
    }
}

