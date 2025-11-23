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

    const { fen, pgn, depth = 18, multipv = 3 } = req.body || {};

    if (!fen && !pgn) {
        return res.status(400).json({ error: 'FEN or PGN input is required' });
    }

    
    const CF_URL = 'https://stockfish.online/api/s/v2.php';
    const HF_TOKEN = process.env.HF_TOKEN;
    const HF_URL = 'https://vd2mi-stockfishapi.hf.space/analyze/fen';

    
    async function fetchCloudflare(positionFen, depthVal) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        try {
            const params = new URLSearchParams({
                fen: positionFen,
                depth: String(depthVal),
                mode: 'bestmove'
            });
            const response = await fetch(`${CF_URL}?${params}`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            const data = await response.json();
            return data;
        } catch (err) {
            clearTimeout(timeoutId);
            return null;
        }
    }

    
    async function fetchHuggingFace(positionFen, depthVal, multipvVal) {
        if (!HF_TOKEN) return null;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 22000);
        try {
            const response = await fetch(HF_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${HF_TOKEN}`
                },
                body: JSON.stringify({ fen: positionFen, depth: depthVal, multipv: multipvVal }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            const data = await response.json();
            return data;
        } catch (err) {
            clearTimeout(timeoutId);
            return null;
        }
    }

    
    if (fen && !pgn) {
        let resultData = await fetchCloudflare(fen, depth);
        if (!resultData) {
            resultData = await fetchHuggingFace(fen, depth, multipv);
        }
        if (!resultData) {
            return res.status(500).json({ error: 'Analysis failed' });
        }
        return res.status(200).json(resultData);
    }

    
    let Chess;
    try {
        Chess = (await import('chess.js')).Chess;
    } catch {
        return res.status(500).json({ error: 'Chess library not available' });
    }

    let game;
    try {
        game = new Chess();
        if (!game.loadPgn(pgn)) {
            game.reset();
            const movesArr = pgn.trim().split(/\s+/);
            for (let san of movesArr) {
                if (!san || /^\d+\.+$/.test(san) || ['1-0', '0-1', '1/2-1/2', '*'].includes(san)) {
                    continue;
                }
                const legalMove = game.move(san);
                if (!legalMove) {
                    throw new Error(`Illegal move: "${san}"`);
                }
            }
        }
    } catch (err) {
        return res.status(400).json({ error: 'Invalid PGN or move list' });
    }

    const history = game.history();
    const totalMoves = history.length;
    if (totalMoves === 0) {
        return res.status(400).json({ error: 'No moves found in PGN' });
    }

    
    game.reset();
    const fens = [game.fen()];
    for (let san of history) {
        game.move(san);
        fens.push(game.fen());
    }

    
    const analysisResults = new Array(fens.length);
    let useCloud = true;

    
    const testData = await fetchCloudflare(fens[0], 8);
    if (!testData) {
        useCloud = false;
        if (!HF_TOKEN) {
            return res.status(500).json({ error: 'No functioning engine available' });
        }
    }

    for (let i = 0; i < fens.length; i++) {
        const depthVal = depth;
        const variantsVal = multipv;
        let engineData;

        if (useCloud) {
            engineData = await fetchCloudflare(fens[i], depthVal);
            if (!engineData && HF_TOKEN) {
                useCloud = false;
                engineData = await fetchHuggingFace(fens[i], depthVal, variantsVal);
            }
        } else {
            engineData = await fetchHuggingFace(fens[i], depthVal, variantsVal);
        }

        if (!engineData) {
            return res.status(500).json({ error: 'Analysis failed during game analysis' });
        }

        
        const chessForLine = new Chess(fens[i]);
        const sideToMove = chessForLine.turn();
        
        let pvLines = Array.isArray(engineData) ? engineData : [engineData];
        
        const lineOutputs = pvLines.map((pv) => {
            let evalCp = null;
            let mate = null;
            let depthInfo = pv.depth || depthVal;
            let uciMoves = [];

            
            if (pv.centipawns !== undefined) {
                evalCp = parseInt(pv.centipawns, 10);
            } else if (pv.eval !== undefined) {
                const val = typeof pv.eval === 'string' ? parseFloat(pv.eval) : pv.eval;
                evalCp = Math.round(val * 100);
            }

            if (pv.mate !== undefined && pv.mate !== null) {
                const mateVal = typeof pv.mate === 'string' ? parseInt(pv.mate, 10) : pv.mate;
                mate = sideToMove === 'w' ? mateVal : -mateVal;
            }

            
            if (pv.continuationArr) {
                uciMoves = pv.continuationArr;
            } else if (pv.pv) {
                uciMoves = Array.isArray(pv.pv) ? pv.pv : pv.pv.split(' ');
            } else if (pv.move) {
                uciMoves = [pv.move];
            }

            
            const movesSAN = [];
            const tempChess = new Chess(fens[i]);
            for (let uci of uciMoves) {
                let moveObj;
                if (/^[a-h][1-8][a-h][1-8][qnrb]?$/.test(uci)) {
                    moveObj = tempChess.move({
                        from: uci.slice(0, 2),
                        to: uci.slice(2, 4),
                        promotion: uci[4]
                    });
                } else {
                    moveObj = tempChess.move(uci);
                }
                if (!moveObj) break;
                movesSAN.push(moveObj.san);
            }

            const evalWhiteCp = evalCp !== null ? (sideToMove === 'w' ? evalCp : -evalCp) : null;

            return { movesSAN, evalCp: evalWhiteCp, mate, depth: depthInfo };
        });

        analysisResults[i] = lineOutputs;
    }

    
    const movesAnalysis = [];
    let totalCpLossWhite = 0, totalCpLossBlack = 0;
    let movesWhiteCount = 0, movesBlackCount = 0;

    for (let m = 0; m < totalMoves; m++) {
        const side = m % 2 === 0 ? 'w' : 'b';
        const beforeEval = analysisResults[m]?.[0];
        const afterEval = analysisResults[m + 1]?.[0];

        let cpLoss = 0;

        if (beforeEval?.mate !== null || afterEval?.mate !== null) {
            if (beforeEval?.mate !== null && (afterEval?.mate === null || Math.sign(beforeEval.mate) !== Math.sign(afterEval.mate))) {
                cpLoss = 1000;
            } else if (afterEval?.mate !== null && afterEval.mate * (side === 'w' ? 1 : -1) < 0) {
                cpLoss = 1000;
            }
        } else if (beforeEval?.evalCp !== undefined && afterEval?.evalCp !== undefined) {
            cpLoss = side === 'w' 
                ? Math.max(0, beforeEval.evalCp - afterEval.evalCp)
                : Math.max(0, afterEval.evalCp - beforeEval.evalCp);
        }

        if (side === 'w') {
            totalCpLossWhite += cpLoss;
            movesWhiteCount++;
        } else {
            totalCpLossBlack += cpLoss;
            movesBlackCount++;
        }

        let category = 'move-best';
        if (cpLoss < 10) category = 'move-best';
        else if (cpLoss < 25) category = 'move-excellent';
        else if (cpLoss < 60) category = 'move-good';
        else if (cpLoss < 150) category = 'move-inaccuracy';
        else if (cpLoss < 300) category = 'move-mistake';
        else category = 'move-blunder';

        movesAnalysis.push({
            san: history[m],
            cpLoss,
            category,
            pv: analysisResults[m]
        });
    }

    const acplWhite = movesWhiteCount ? Math.round(totalCpLossWhite / movesWhiteCount) : 0;
    const acplBlack = movesBlackCount ? Math.round(totalCpLossBlack / movesBlackCount) : 0;

    const accuracyWhite = Math.min(100, Math.round(100 * Math.exp(-0.002 * acplWhite)));
    const accuracyBlack = Math.min(100, Math.round(100 * Math.exp(-0.002 * acplBlack)));

    const ratingWhite = Math.max(400, Math.round(2900 - 250 * Math.log10(acplWhite + 12)));
    const ratingBlack = Math.max(400, Math.round(2900 - 250 * Math.log10(acplBlack + 12)));

    
    const header = game.header();
    let winner = 'Draw';
    if (header.Result === '1-0') winner = 'White';
    else if (header.Result === '0-1') winner = 'Black';
    else if (header.Result === '1/2-1/2') winner = 'Draw';

    
    const keyMoments = [];
    movesAnalysis.forEach((move, idx) => {
        if (move.category === 'move-blunder' || move.category === 'move-mistake') {
            const moveNum = Math.floor(idx / 2) + 1;
            const isBlackMove = idx % 2 === 1;
            const notation = `${moveNum}${isBlackMove ? '...' : '.'} ${move.san}`;
            const pawnsLost = (move.cpLoss / 100).toFixed(1).replace('.0', '');
            keyMoments.push({
                type: move.category === 'move-blunder' ? 'blunder' : 'mistake',
                text: `${move.category === 'move-blunder' ? 'Blunder' : 'Mistake'} – ${notation} (loses ${pawnsLost} pawns)`
            });
        }
    });

    if (keyMoments.length === 0) {
        keyMoments.push({
            type: 'info',
            text: 'No blunders or major mistakes – a well-played game by both sides.'
        });
    }

    
    let narrative = winner === 'Draw' 
        ? 'The game ended in a draw. '
        : `${winner} won the game. `;
    narrative += `White's ACPL: ${acplWhite}, Black's ACPL: ${acplBlack}. `;
    
    const firstBlunder = keyMoments.find(m => m.type === 'blunder' || m.type === 'mistake');
    if (firstBlunder) {
        narrative += firstBlunder.text.replace(/^(Blunder|Mistake) – /, 'The critical moment was ').replace('loses', 'losing') + '.';
    } else {
        narrative += 'Neither player blundered, and the game was decided by subtle factors.';
    }

    return res.status(200).json({
        moves: movesAnalysis,
        summary: {
            white: { accuracy: accuracyWhite, acpl: acplWhite, rating: ratingWhite },
            black: { accuracy: accuracyBlack, acpl: acplBlack, rating: ratingBlack },
            moments: keyMoments,
            narrative: narrative.trim()
        }
    });
}
