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

    let Chess;
    try {
        Chess = (await import('chess.js')).Chess;
    } catch {
        return res.status(500).json({ error: 'Chess library not available' });
    }

    const HF_TOKEN = process.env.HF_TOKEN;
    const HF_URL = 'https://vd2mi-stockfishapi.hf.space/analyze/fen';
    const CF_URL = 'https://stockfish.online/api/s/v2.php';

    const cache = new Map();

    function getCacheKey(fen, depth, multipv) {
        const shortFen = fen.split(' ').slice(0, 4).join(' ');
        return `${shortFen}|${depth}|${multipv}`;
    }

    async function safeFetch(url, options, timeout) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            clearTimeout(timer);
            return null;
        }
    }

    function uciToSan(fen, uciMoves) {
        const chess = new Chess(fen);
        const san = [];
        for (const uci of uciMoves) {
            if (!uci || uci.length < 4) break;
            const move = chess.move({
                from: uci.slice(0, 2),
                to: uci.slice(2, 4),
                promotion: uci[4]
            });
            if (!move) break;
            san.push(move.san);
        }
        return san;
    }

    function normalizeCloudflareEval(raw) {
        if (raw === null || raw === undefined) return 0;
        const str = String(raw).trim().replace(',', '.');
        if (str === '0' || str === '-0') return 0;
        const num = parseFloat(str);
        if (isNaN(num)) return 0;
        if (str.includes('.')) return Math.round(num * 100);
        const abs = Math.abs(num);
        if (abs >= 1000) return Math.round(num);
        if (abs < 40) return Math.round(num);
        if (abs <= 300) return Math.round(num);
        if (abs < 900) return Math.round(num);
        return Math.round(num);
    }

    async function fetchHuggingFace(positionFen, depthVal, multipvVal) {
        if (!HF_TOKEN) return null;
        
        const cacheKey = getCacheKey(positionFen, depthVal, multipvVal);
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const json = await safeFetch(HF_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${HF_TOKEN}`
            },
            body: JSON.stringify({ fen: positionFen, depth: depthVal, multipv: multipvVal })
        }, 20000);
        
        if (!json || json.error) return null;

        const chess = new Chess(positionFen);
        const turn = chess.turn();

        let pvs = [];
        if (json.pvs && Array.isArray(json.pvs)) {
            pvs = json.pvs.map(pv => {
                let cp = pv.cp ?? pv.eval ?? 0;
                let mate = pv.mate ?? null;
                
                if (mate !== null) {
                    mate = turn === 'w' ? mate : -mate;
                }
                if (turn === 'b') {
                    cp = -cp;
                }

                const uci = pv.pv || pv.moves || pv.uci || [];
                const uciArray = Array.isArray(uci) ? uci : uci.split(' ').filter(Boolean);
                const san = uciToSan(positionFen, uciArray);

                return {
                    cp,
                    mate,
                    depth: pv.depth ?? depthVal,
                    uci: uciArray,
                    san
                };
            });
        }

        pvs.sort((a, b) => {
            if (a.mate !== null && b.mate !== null) {
                return a.mate > 0 ? (b.mate > 0 ? a.mate - b.mate : -1) : 1;
            }
            if (a.mate !== null) return a.mate > 0 ? -1 : 1;
            if (b.mate !== null) return b.mate > 0 ? 1 : -1;
            return b.cp - a.cp;
        });

        const result = {
            cpWhite: pvs[0]?.cp ?? 0,
            mate: pvs[0]?.mate ?? null,
            depth: depthVal,
            bestMove: pvs[0]?.uci?.[0] ?? '',
            pvs
        };

        cache.set(cacheKey, result);
        return result;
    }

    async function fetchCloudflare(positionFen, depthVal) {
        const cacheKey = getCacheKey(positionFen, depthVal, 1);
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const params = new URLSearchParams({
            fen: positionFen,
            depth: String(depthVal),
            mode: 'bestmove'
        });
        
        const json = await safeFetch(`${CF_URL}?${params}`, {
            method: 'GET'
        }, 1500);
        
        if (!json) return null;

        let cpWhite = 0;
        let mate = null;

        if (json.mate !== null && json.mate !== undefined) {
            mate = parseInt(json.mate, 10);
            if (isNaN(mate)) mate = null;
        }
        
        if (json.evaluation !== undefined && json.evaluation !== null) {
            cpWhite = normalizeCloudflareEval(json.evaluation);
        } else if (json.eval !== undefined && json.eval !== null) {
            cpWhite = normalizeCloudflareEval(json.eval);
        }

        const bestMove = json.bestmove || json.move || '';
        const uci = bestMove ? [bestMove] : [];
        const san = uciToSan(positionFen, uci);

        const pvs = [{
            cp: cpWhite,
            mate,
            depth: json.depth || depthVal,
            uci,
            san
        }];

        const result = {
            cpWhite,
            mate,
            depth: json.depth || depthVal,
            bestMove,
            pvs
        };

        cache.set(cacheKey, result);
        return result;
    }

    async function evaluatePosition(fen, depth, multipv) {
        let result = await fetchHuggingFace(fen, depth, multipv);
        if (result) return result;
        result = await fetchCloudflare(fen, 12);
        if (result) return result;
        return null;
    }

    if (fen && !pgn) {
        const result = await evaluatePosition(fen, depth, multipv);
        if (!result) {
            return res.status(500).json({ error: 'All engines failed' });
        }
        return res.status(200).json(result);
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
        return res.status(400).json({ error: 'Invalid PGN: ' + err.message });
    }

    const history = game.history({ verbose: true });
    const totalMoves = history.length;
    if (totalMoves === 0) {
        return res.status(400).json({ error: 'No moves found in PGN' });
    }

    game.reset();
    const fens = [game.fen()];
    for (let move of history) {
        game.move(move);
        fens.push(game.fen());
    }

    const analysisResults = [];
    for (let i = 0; i < fens.length; i++) {
        const result = await evaluatePosition(fens[i], depth, multipv);
        if (!result) {
            return res.status(500).json({ error: `Analysis failed at position ${i}` });
        }
        analysisResults.push(result);
    }

    function normalizeEval(raw, sideToMove) {
        if (raw.mate !== null && raw.mate !== undefined) {
            const m = Number(raw.mate);
            const signed = sideToMove === 'w' ? m : -m;
            return { cp: signed > 0 ? 10000 : -10000, mate: signed };
        }
        const cp = Number(raw.cp ?? raw.cpWhite ?? 0);
        return { cp: sideToMove === 'w' ? cp : -cp, mate: null };
    }

    function isSacrifice(move, beforeEval, afterEval) {
        if (!move.captured) return false;
        const materialLoss = { p: 1, n: 3, b: 3, r: 5, q: 9 }[move.captured] || 0;
        if (materialLoss === 0) return false;
        const evalDiff = Math.abs(afterEval.cp - beforeEval.cp);
        return evalDiff <= 50;
    }

    function isTactical(pvMoves) {
        if (pvMoves.length < 3) return false;
        const chess = new Chess();
        let forcingCount = 0;
        for (const san of pvMoves.slice(0, 6)) {
            const move = chess.move(san);
            if (!move) break;
            if (chess.in_check() || move.captured || san.includes('+') || san.includes('#')) {
                forcingCount++;
            }
        }
        return forcingCount >= 2;
    }

    function detectMotifs(move, fen) {
        const motifs = [];
        if (move.san.includes('+')) motifs.push('Check');
        if (move.san.includes('#')) motifs.push('Checkmate');
        if (move.captured) motifs.push('Capture');
        
        const chess = new Chess(fen);
        const piece = move.piece;
        const to = move.to;
        
        const attackedSquares = chess.moves({ verbose: true, square: to });
        if (attackedSquares.length >= 2) {
            const pieceTypes = new Set(attackedSquares.map(m => m.captured).filter(Boolean));
            if (pieceTypes.size >= 2) motifs.push('Fork');
        }
        
        return motifs;
    }

    function classifyCpl(cpl) {
        if (cpl <= 15) return ['Best', 'move-best'];
        if (cpl <= 40) return ['Good', 'move-good'];
        if (cpl <= 80) return ['Inaccuracy', 'move-inaccuracy'];
        if (cpl <= 200) return ['Mistake', 'move-mistake'];
        return ['Blunder', 'move-blunder'];
    }

    function accuracyFromAcpl(acpl) {
        acpl = Math.min(300, Math.max(0, acpl));
        return Math.round(100 - (100 * Math.pow(acpl / 130, 0.65)));
    }

    function ratingFromAcpl(acpl) {
        return Math.max(400, Math.round(2850 - 220 * Math.log10(acpl + 10)));
    }

    const movesAnalysis = [];
    let totalCpLossWhite = 0, totalCpLossBlack = 0;
    let movesWhiteCount = 0, movesBlackCount = 0;
    const swings = [];
    const brilliants = [];
    const greats = [];

    for (let m = 0; m < totalMoves; m++) {
        const side = m % 2 === 0 ? 'w' : 'b';
        const beforeEval = analysisResults[m];
        const afterEval = analysisResults[m + 1];
        const move = history[m];

        const beforePv = beforeEval.pvs[0];
        const afterPv = afterEval.pvs[0];

        let cpLoss = 0;

        if (beforePv?.mate !== null || afterPv?.mate !== null) {
            if (beforePv?.mate !== null && (afterPv?.mate === null || Math.sign(beforePv.mate) !== Math.sign(afterPv.mate))) {
                cpLoss = 1000;
            } else if (afterPv?.mate !== null && afterPv.mate * (side === 'w' ? 1 : -1) < 0) {
                cpLoss = 1000;
            }
        } else {
            const beforeNorm = normalizeEval(beforePv, side);
            const afterNorm = normalizeEval(afterPv, side);
            cpLoss = Math.max(0, beforeNorm.cp - afterNorm.cp);
        }

        if (side === 'w') {
            totalCpLossWhite += cpLoss;
            movesWhiteCount++;
        } else {
            totalCpLossBlack += cpLoss;
            movesBlackCount++;
        }

        const [label, category] = classifyCpl(cpLoss);

        const bestSan = beforeEval.pvs[0]?.san?.[0] || null;
        const secondBestSan = beforeEval.pvs[1]?.san?.[0] || null;

        let isGreat = false;
        let isBrilliant = false;
        let isOnlyMove = false;
        let brilliantReason = null;

        if (beforeEval.pvs.length >= 2 && move.san === bestSan) {
            const pv0cp = beforeEval.pvs[0].cp;
            const pv1cp = beforeEval.pvs[1].cp;
            const cpGap = Math.abs(pv0cp - pv1cp);

            if (cpGap >= 150) {
                isOnlyMove = true;
            }

            if (cpGap >= 120 && cpLoss <= 15) {
                isGreat = true;
                greats.push({ moveIndex: m, san: move.san });
            }

            const wasSacrifice = isSacrifice(move, beforePv, afterPv);
            const wasTactical = isTactical(beforeEval.pvs[0].san);

            if (wasSacrifice && cpGap >= 150 && wasTactical && cpLoss <= 15) {
                isBrilliant = true;
                brilliantReason = 'Sacrificial forcing move with no alternatives';
                brilliants.push({ moveIndex: m, san: move.san, reason: brilliantReason });
            }
        }

        const motifs = detectMotifs(move, fens[m]);

        const evalTrend = m >= 2 ? 
            (normalizeEval(analysisResults[m].pvs[0], side).cp > normalizeEval(analysisResults[m - 2].pvs[0], side).cp ? 'improving' : 
             normalizeEval(analysisResults[m].pvs[0], side).cp < normalizeEval(analysisResults[m - 2].pvs[0], side).cp ? 'declining' : 'stable') : 'stable';

        if (cpLoss >= 180) {
            swings.push({ type: 'swing', amount: cpLoss, moveIndex: m, san: move.san });
        }

        movesAnalysis.push({
            san: move.san,
            cpLoss,
            category,
            label,
            bestSan,
            secondBestSan,
            engineTrend: evalTrend,
            motifs,
            isBrilliant,
            isGreat,
            isOnlyMove,
            brilliantReason,
            pv: beforeEval.pvs
        });
    }

    const acplWhite = movesWhiteCount ? Math.round(totalCpLossWhite / movesWhiteCount) : 0;
    const acplBlack = movesBlackCount ? Math.round(totalCpLossBlack / movesBlackCount) : 0;

    const accuracyWhite = accuracyFromAcpl(acplWhite);
    const accuracyBlack = accuracyFromAcpl(acplBlack);

    const ratingWhite = ratingFromAcpl(acplWhite);
    const ratingBlack = ratingFromAcpl(acplBlack);

    const header = game.header();
    let winner = 'Draw';
    if (header.Result === '1-0') winner = 'White';
    else if (header.Result === '0-1') winner = 'Black';
    else if (header.Result === '1/2-1/2') winner = 'Draw';

    const keyMoments = [];

    brilliants.forEach(b => {
        const moveNum = Math.floor(b.moveIndex / 2) + 1;
        const isBlackMove = b.moveIndex % 2 === 1;
        const notation = `${moveNum}${isBlackMove ? '...' : '.'} ${b.san}`;
        keyMoments.push({
            type: 'brilliant',
            text: `⚡ Brilliant! – ${notation} (${b.reason})`
        });
    });

    greats.forEach(g => {
        const moveNum = Math.floor(g.moveIndex / 2) + 1;
        const isBlackMove = g.moveIndex % 2 === 1;
        const notation = `${moveNum}${isBlackMove ? '...' : '.'} ${g.san}`;
        keyMoments.push({
            type: 'great',
            text: `⭐ Great Move! – ${notation}`
        });
    });

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

    swings.forEach(s => {
        const moveNum = Math.floor(s.moveIndex / 2) + 1;
        const isBlackMove = s.moveIndex % 2 === 1;
        const notation = `${moveNum}${isBlackMove ? '...' : '.'} ${s.san}`;
        keyMoments.push({
            type: 'swing',
            text: `🔄 Turning Point – ${notation} (${(s.amount / 100).toFixed(1)} pawn swing)`
        });
    });

    if (keyMoments.length === 0) {
        keyMoments.push({
            type: 'info',
            text: 'Clean game with no major mistakes or brilliant moves.'
        });
    }

    const openingMoves = movesAnalysis.slice(0, Math.min(10, totalMoves));
    const openingErrors = openingMoves.filter(m => m.category === 'move-mistake' || m.category === 'move-blunder').length;
    const openingSummary = openingErrors === 0 ? 'Both players handled the opening well.' : `${openingErrors} mistake(s) in the opening phase.`;

    const middlegameMoves = movesAnalysis.slice(10, Math.max(10, totalMoves - 10));
    const middlegameBlunders = middlegameMoves.filter(m => m.category === 'move-blunder').length;
    const middlegameSummary = middlegameBlunders > 0 ? `${middlegameBlunders} critical error(s) in the middlegame.` : 'Solid middlegame play.';

    const endgameMoves = movesAnalysis.slice(Math.max(0, totalMoves - 10));
    const endgameAccuracy = endgameMoves.filter(m => m.category === 'move-best' || m.category === 'move-good').length / Math.max(1, endgameMoves.length);
    const endgameSummary = endgameAccuracy > 0.8 ? 'Precise endgame technique.' : endgameAccuracy > 0.5 ? 'Decent endgame play.' : 'Inaccurate endgame.';

    let narrative = `${winner === 'Draw' ? 'The game ended in a draw.' : `${winner} won the game.`} `;
    narrative += `White's accuracy: ${accuracyWhite}% (ACPL: ${acplWhite}). Black's accuracy: ${accuracyBlack}% (ACPL: ${acplBlack}). `;
    narrative += `${openingSummary} ${middlegameSummary} ${endgameSummary} `;
    
    if (brilliants.length > 0) {
        narrative += `${brilliants.length} brilliant move(s) played! `;
    }
    
    const firstBlunder = keyMoments.find(m => m.type === 'blunder');
    if (firstBlunder) {
        narrative += firstBlunder.text.replace(/^Blunder – /, 'Critical moment: ').replace('loses', 'losing') + '. ';
    }

    return res.status(200).json({
        moves: movesAnalysis,
        summary: {
            white: { accuracy: accuracyWhite, acpl: acplWhite, rating: ratingWhite },
            black: { accuracy: accuracyBlack, acpl: acplBlack, rating: ratingBlack },
            moments: keyMoments,
            narrative: narrative.trim(),
            opening: openingSummary,
            middlegame: middlegameSummary,
            endgame: endgameSummary,
            brilliants: brilliants.length,
            blunders: movesAnalysis.filter(m => m.category === 'move-blunder').length,
            swings: swings.length
        }
    });
}
