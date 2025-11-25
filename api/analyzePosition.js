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

    console.log('[analyzePosition] Incoming request');
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = null;
        }
    }

    const { fens: fensArray, depth = 18, multipv = 3 } = body || {};
    console.log(`[analyzePosition] Parsed body: fens=${Array.isArray(fensArray) ? fensArray.length : 'invalid'}, depth=${depth}, multipv=${multipv}`);

    if (!fensArray || !Array.isArray(fensArray)) {
        console.warn('[analyzePosition] Missing or invalid FEN array');
        return res.status(400).json({ error: 'FENs array is required' });
    }

    let Chess;
    try {
        Chess = (await import('chess.js')).Chess;
    } catch {
        return res.status(500).json({ error: 'Chess library not available' });
    }

    const HF_TOKEN = process.env.HF_TOKEN;
    const HF_BATCH_URL = 'https://vd2mi-stockfishapi.hf.space/analyze/batch';
    const BATCH_SIZE = 20;

    const PERSISTENT_CACHE = global.EVAL_CACHE || (global.EVAL_CACHE = new Map());

    function getCacheKey(fen) {
        return fen;
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

    function tryApplyToken(chessInstance, token) {
        if (!token) return null;
        let str = '';
        if (typeof token === 'string') {
            str = token.trim();
        } else if (typeof token === 'object') {
            str = token.Move || token.move || token.san || '';
            if (typeof str === 'string') str = str.trim();
        }
        if (!str) return null;
        const uciPattern = /^[a-h][1-8][a-h][1-8][qnrb]?$/i;
        if (uciPattern.test(str)) {
            const normalized = str.toLowerCase();
            const moveObj = chessInstance.move({
                from: normalized.slice(0, 2),
                to: normalized.slice(2, 4),
                promotion: normalized.length > 4 ? normalized[4] : undefined
            });
            if (moveObj) return moveObj;
        }
        return chessInstance.move(str, { sloppy: true });
    }

    function parseLineMoves(positionFen, line) {
        const chess = new Chess(positionFen);
        const candidates = [
            line?.line ?? line?.Line,
            line?.moves ?? line?.Moves,
            line?.pv ?? line?.PV,
            line?.uci ?? line?.UCI
        ];

        let tokens = [];
        for (const candidate of candidates) {
            if (Array.isArray(candidate) && candidate.length) {
                tokens = candidate.slice();
                break;
            }
            if (typeof candidate === 'string' && candidate.trim()) {
                tokens = candidate.trim().split(/\s+/);
                break;
            }
        }
        if (tokens.length === 0 && typeof line?.Move === 'string' && line.Move.trim()) {
            tokens = [line.Move.trim()];
        }

        const uciSeq = [];
        const sanSeq = [];
        for (const token of tokens) {
            const moveObj = tryApplyToken(chess, token);
            if (!moveObj) break;
            uciSeq.push(`${moveObj.from}${moveObj.to}${moveObj.promotion || ''}`);
            sanSeq.push(moveObj.san);
        }
        return { uciSeq, sanSeq };
    }

    async function fetchBatch(fensToEvaluate, depthVal, multipvVal) {
        if (!HF_TOKEN || fensToEvaluate.length === 0) {
            console.warn('[fetchBatch] Missing HF token or empty batch');
            return null;
        }

        const uncachedFens = [];
        const fenIndexMap = [];

        fensToEvaluate.forEach((fen, idx) => {
            const cacheKey = getCacheKey(fen);
            if (PERSISTENT_CACHE.has(cacheKey)) {
                fenIndexMap[idx] = { cached: true, result: PERSISTENT_CACHE.get(cacheKey) };
            } else {
                fenIndexMap[idx] = { cached: false, batchIndex: uncachedFens.length };
                uncachedFens.push(fen);
            }
        });

        if (uncachedFens.length === 0) {
            console.log('[fetchBatch] All positions served from cache');
            return fensToEvaluate.map((fen, idx) => fenIndexMap[idx].result);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 40000);

        let json;
        try {
            console.log(`[fetchBatch] Requesting HF batch: size=${uncachedFens.length}, depth=${depthVal}, multipv=${multipvVal}`);
            const response = await fetch(HF_BATCH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                    'Authorization': `Bearer ${HF_TOKEN}`
            },
                body: JSON.stringify({ fens: uncachedFens, depth: depthVal, multipv: multipvVal }),
            signal: controller.signal
        });

            clearTimeout(timer);

        if (!response.ok) {
                console.error('[fetchBatch] HF batch failed:', response.status);
                return null;
            }

            const text = await response.text();
            try {
                json = JSON.parse(text);
            } catch {
                console.error('[fetchBatch] JSON Parse Error:', text.slice(0, 200));
                return null;
            }
        } catch (err) {
            clearTimeout(timer);
            console.error('[fetchBatch] Network error:', err);
            return null;
        }

        if (!json || !json.results || !Array.isArray(json.results)) {
            console.error('[fetchBatch] Invalid HF response structure:', json);
            return null;
        }
        console.log(`[fetchBatch] HF batch success: results=${json.results.length}`);

        if (json.results.length < uncachedFens.length) {
            console.warn(`[fetchBatch] HF returned ${json.results.length} results but expected ${uncachedFens.length}, padding with fallbacks`);
            while (json.results.length < uncachedFens.length) {
                json.results.push(null);
            }
        }

        const batchNormalized = json.results.map((result, idx) => {
            const positionFen = uncachedFens[idx];

            if (!result) {
                console.warn('[fetchBatch] Missing result entry, inserting fallback');
                const fallback = {
                    cpWhite: 0,
                    mate: null,
                    depth: depthVal,
                    bestMove: '',
                    pvs: []
                };
                PERSISTENT_CACHE.set(getCacheKey(positionFen), fallback);
                return fallback;
            }

            const chess = new Chess(positionFen);
            const turn = chess.turn();

            let rawLines = [];
            if (Array.isArray(result.pvs)) {
                rawLines = result.pvs;
            } else if (Array.isArray(result.top_moves)) {
                rawLines = result.top_moves;
            } else if (Array.isArray(result.topMoves)) {
                rawLines = result.topMoves;
            }

            if ((!rawLines || rawLines.length === 0) && result.best_move) {
                rawLines = [{
                    Move: result.best_move,
                    evaluation: result.evaluation,
                    depth: result.depth
                }];
            }
            if (!rawLines || rawLines.length === 0) {
                console.warn('[fetchBatch] No PV data returned for fen:', positionFen);
            }

            const limitedLines = Array.isArray(rawLines) ? rawLines.slice(0, multipvVal) : [];

            let pvs = limitedLines.map(line => {
                const { uciSeq, sanSeq } = parseLineMoves(positionFen, line);
                let uciMoves = uciSeq;
                let sanMoves = sanSeq;

                if (uciMoves.length === 0 && typeof line?.Move === 'string') {
                    uciMoves = [line.Move];
                    sanMoves = uciToSan(positionFen, uciMoves);
                }

                let rawCp = 0;
                let rawMate = null;

                if (line.cpWhite !== undefined) {
                    rawCp = Number(line.cpWhite);
                } else if (line.evaluation?.type === 'cp') {
                    rawCp = Number(line.evaluation.value);
                } else if (result.evaluation?.type === 'cp') {
                    rawCp = Number(result.evaluation.value);
                } else if (line.Centipawn !== undefined) {
                    rawCp = Number(line.Centipawn);
                } else if (line.centipawn !== undefined) {
                    rawCp = Number(line.centipawn);
                } else if (line.CP !== undefined) {
                    rawCp = Number(line.CP);
                } else if (line.cp !== undefined) {
                    rawCp = Number(line.cp);
                } else if (line.eval !== undefined) {
                    rawCp = Number(line.eval);
                } else if (line.Eval !== undefined) {
                    rawCp = Number(line.Eval);
                }

                if (!Number.isFinite(rawCp)) rawCp = 0;

                if (line.mateWhite !== undefined) {
                    rawMate = Number(line.mateWhite);
                } else if (line.evaluation?.type === 'mate') {
                    rawMate = Number(line.evaluation.value);
                } else if (result.evaluation?.type === 'mate') {
                    rawMate = Number(result.evaluation.value);
                } else if (line.Mate !== undefined) {
                    rawMate = Number(line.Mate);
                } else if (line.mate !== undefined) {
                    rawMate = Number(line.mate);
                }

                rawMate = rawMate === null || rawMate === undefined ? null : Number(rawMate);
                if (rawMate !== null && !Number.isFinite(rawMate)) rawMate = null;
                if (rawMate === 0) rawMate = null;

                const cpWhite = line.cpWhite !== undefined
                    ? rawCp
                    : (turn === 'w' ? rawCp : -rawCp);

                const mateWhite = line.mateWhite !== undefined
                    ? rawMate
                    : (rawMate !== null ? (turn === 'w' ? rawMate : -rawMate) : null);

                return {
                    cp: cpWhite,
                    mate: mateWhite,
                    depth: line.depth ?? result.depth ?? depthVal,
                    uci: uciMoves,
                    san: sanMoves
                };
            });

            if (!pvs.length) {
                pvs = [{
                    cp: 0,
                    mate: null,
                    depth: result.depth ?? depthVal,
                    uci: [],
                    san: []
                }];
            }

            pvs.sort((a, b) => {
                if (a.mate !== null && b.mate !== null) {
                    if (a.mate > 0 && b.mate > 0) return a.mate - b.mate;
                    if (a.mate < 0 && b.mate < 0) return b.mate - a.mate;
                    return a.mate > 0 ? -1 : 1;
                }
                if (a.mate !== null) return a.mate > 0 ? -1 : 1;
                if (b.mate !== null) return b.mate > 0 ? 1 : -1;
                
                return b.cp - a.cp;
            });

            let bestMove = result.best_move || result.bestMove || '';
            if ((!bestMove || bestMove.length < 4) && pvs[0]?.uci?.length) {
                bestMove = pvs[0].uci[0];
            }
            if (typeof bestMove !== 'string' || bestMove.length < 4) {
                bestMove = '';
            }

            const normalized = {
                cpWhite: pvs[0]?.cp ?? 0,
                mate: pvs[0]?.mate ?? null,
                depth: depthVal,
                bestMove,
                pvs
            };

            PERSISTENT_CACHE.set(getCacheKey(positionFen), normalized);
            return normalized;
        });

        return fensToEvaluate.map((fen, idx) => {
            if (fenIndexMap[idx].cached) {
                return fenIndexMap[idx].result;
            } else {
                return batchNormalized[fenIndexMap[idx].batchIndex];
            }
        });
    }

    const analysisResults = [];
    console.log(`[analyzePosition] Evaluating ${fensArray.length} positions in batches of ${BATCH_SIZE}`);

    for (let i = 0; i < fensArray.length; i += BATCH_SIZE) {
        const batch = fensArray.slice(i, i + BATCH_SIZE);
        const batchResults = await fetchBatch(batch, depth, multipv);
        
        if (!batchResults) {
            console.error('[analyzePosition] Batch evaluation failed at index', i);
            return res.status(500).json({ error: `Batch analysis failed at position ${i}` });
        }

        analysisResults.push(...batchResults);
    }
    console.log('[analyzePosition] All batches evaluated successfully');


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

    function isSacrifice(move, beforePv, afterPv) {
        if (!move.captured) return false;
        const materialLoss = { p: 1, n: 3, b: 3, r: 5, q: 9 }[move.captured] || 0;
        if (materialLoss === 0) return false;
        
        const beforeCp = beforePv?.cp ?? 0;
        const afterCp = afterPv?.cp ?? 0;
        
        const evalDrop = beforeCp - afterCp;
        return evalDrop <= 50;
    }

    function isTactical(pvMoves, positionFen) {
        if (!pvMoves || pvMoves.length < 3) return false;
        const chess = new Chess(positionFen);
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
        let applied = null;
        if (move?.san) {
            applied = chess.move(move.san, { sloppy: true });
        }
        if (!applied && move?.from && move?.to) {
            applied = chess.move({
                from: move.from,
                to: move.to,
                promotion: move.promotion
            });
        }

        if (applied) {
            const attackedSquares = chess.moves({ verbose: true, square: move.to });
            if (attackedSquares.length >= 2) {
                const pieceTypes = new Set(attackedSquares.map(m => m.captured).filter(Boolean));
                if (pieceTypes.size >= 2) motifs.push('Fork');
            }
        } else {
            console.warn('[detectMotifs] Failed to replay move, skipping fork detection for SAN:', move?.san);
        }

        return motifs;
    }

    const history = [];
    
    for (let i = 1; i < fensArray.length; i++) {
        const prevFen = fensArray[i - 1];
        const currentFen = fensArray[i];
        const tempGame = new Chess(prevFen);
        const moves = tempGame.moves({ verbose: true });
        const foundMove = moves.find(m => {
            const testGame = new Chess(prevFen);
            testGame.move(m);
            return testGame.fen() === currentFen;
        });
        if (foundMove) {
            history.push(foundMove);
        } else {
            history.push({ san: '--', piece: 'p', from: 'e2', to: 'e4', captured: null, flags: '' });
        }
    }

    const totalMoves = history.length;
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

        if (!beforeEval || !beforeEval.pvs || !Array.isArray(beforeEval.pvs) || beforeEval.pvs.length === 0) {
            console.warn(`[analyzePosition] Missing beforeEval at move ${m}, inserting fallback`);
            movesAnalysis.push({
                moveNumber: m + 1,
                side: side,
                san: move.san,
                from: move.from,
                to: move.to,
                promotion: move.promotion || null,
                captured: move.captured || null,
                cpl: 0,
                label: 'Best',
                category: 'move-best',
                cpBefore: 0,
                cpAfter: 0,
                bestSan: null,
                secondBestSan: null,
                engineTrend: 'stable',
                motifs: [],
                isBrilliant: false,
                isGreat: false,
                isOnlyMove: false,
                error: true
            });
            continue;
        }

        if (!afterEval || !afterEval.pvs || !Array.isArray(afterEval.pvs) || afterEval.pvs.length === 0) {
            console.warn(`[analyzePosition] Missing afterEval at move ${m}, inserting fallback`);
            const pv0 = beforeEval.pvs?.[0] || { cp: 0, san: [] };
            movesAnalysis.push({
                moveNumber: m + 1,
                side: side,
                san: move.san,
                from: move.from,
                to: move.to,
                promotion: move.promotion || null,
                captured: move.captured || null,
                cpl: 0,
                label: 'Best',
                category: 'move-best',
                cpBefore: pv0.cp ?? 0,
                cpAfter: 0,
                bestSan: pv0.san?.[0] || null,
                secondBestSan: beforeEval.pvs?.[1]?.san?.[0] || null,
                engineTrend: 'stable',
                motifs: [],
                isBrilliant: false,
                isGreat: false,
                isOnlyMove: false,
                error: true
            });
            continue;
        }

        const pv0 = beforeEval.pvs[0] || { cp: 0, mate: null, san: [], uci: [] };
        const pv1 = beforeEval.pvs[1] || { cp: 0, san: [] };
        const afterPv0 = afterEval.pvs[0] || { cp: 0, mate: null };

        const cpBefore = pv0.cp ?? 0;
        const cpAfter = afterPv0.cp ?? 0;
        const mateBefore = pv0.mate ?? null;
        const mateAfter = afterPv0.mate ?? null;

        let cpLoss = 0;
        if (mateBefore !== null || mateAfter !== null) {
            if (mateBefore !== null && mateBefore > 0 && (mateAfter === null || mateAfter <= 0)) {
                cpLoss = 500;
            } else if (mateBefore !== null && mateBefore < 0 && (mateAfter === null || mateAfter >= 0)) {
                cpLoss = 500;
            } else if (mateBefore !== null && mateAfter !== null && mateBefore > 0 && mateAfter > 0) {
                cpLoss = Math.max(0, mateAfter - mateBefore) * 50;
            } else if (mateBefore !== null && mateAfter !== null && mateBefore < 0 && mateAfter < 0) {
                cpLoss = Math.max(0, mateBefore - mateAfter) * 50;
            } else {
                cpLoss = 0;
            }
        } else {
            cpLoss = Math.max(0, cpBefore - cpAfter);
        }

        if (side === 'w') {
            totalCpLossWhite += cpLoss;
            movesWhiteCount++;
        } else {
            totalCpLossBlack += cpLoss;
            movesBlackCount++;
        }

        const [label, category] = classifyCpl(cpLoss);

        const playedMoveUci = move.from + move.to + (move.promotion || '');
        const bestMoveUci = pv0.uci?.[0] || null;
        const bestSan = pv0.san?.[0] || null;
        const secondBestSan = pv1.san?.[0] || null;

        let isGreat = false;
        let isBrilliant = false;
        let isOnlyMove = false;
        let brilliantReason = null;

        if (beforeEval.pvs.length >= 2 && playedMoveUci === bestMoveUci) {
            const pv0Cp = pv0.cp ?? 0;
            const pv1Cp = pv1.cp ?? 0;
            const cpGap = Math.abs(pv0Cp - pv1Cp);

            if (cpGap >= 150) {
                isOnlyMove = true;
            }

            const wasSacrifice = isSacrifice(move, pv0, afterPv0);
            const wasTactical = isTactical(pv0.san || [], fensArray[m]);

            if (wasSacrifice && cpGap >= 150 && wasTactical && cpLoss <= 15) {
                isBrilliant = true;
                brilliantReason = 'Sacrificial forcing move with no alternatives';
                brilliants.push({ moveIndex: m, san: move.san, reason: brilliantReason });
            } else if (!wasSacrifice && cpGap >= 120 && cpLoss <= 15) {
                isGreat = true;
                greats.push({ moveIndex: m, san: move.san });
            }
        }

        const motifs = detectMotifs(move, fensArray[m]);

        let evalTrend = 'stable';
        if (m >= 1) {
            const prevEval = analysisResults[m];
            const currentEval = analysisResults[m + 1];
            const prevCp = prevEval.pvs[0]?.cp ?? 0;
            const currentCp = currentEval.pvs[0]?.cp ?? 0;
            
            let diff = currentCp - prevCp;
            if (side === 'b') {
                diff = prevCp - currentCp;
            }
            
            if (diff > 20) {
                evalTrend = 'improving';
            } else if (diff < -20) {
                evalTrend = 'declining';
            }
        }

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
    console.log('[analyzePosition] ACPL White/Black:', acplWhite, acplBlack);

    const accuracyWhite = accuracyFromAcpl(acplWhite);
    const accuracyBlack = accuracyFromAcpl(acplBlack);

    const ratingWhite = ratingFromAcpl(acplWhite);
    const ratingBlack = ratingFromAcpl(acplBlack);

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

    let narrative = 'The game ended. ';
    narrative += `White's accuracy: ${accuracyWhite}% (ACPL: ${acplWhite}). Black's accuracy: ${accuracyBlack}% (ACPL: ${acplBlack}). `;
    narrative += `${openingSummary} ${middlegameSummary} ${endgameSummary} `;

    if (brilliants.length > 0) {
        narrative += `${brilliants.length} brilliant move(s) played! `;
    }

    const firstBlunder = keyMoments.find(m => m.type === 'blunder');
    if (firstBlunder) {
        narrative += firstBlunder.text.replace(/^Blunder – /, 'Critical moment: ').replace('loses', 'losing') + '. ';
    }

    console.log('[analyzePosition] Summary:', {
        totalMoves,
        swings: swings.length,
        brilliants: brilliants.length,
        greats: greats.length
    });
    return res.status(200).json({
        evaluations: analysisResults,
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
