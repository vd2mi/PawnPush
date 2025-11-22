const CONFIG = {
    CF_DEPTH: 20,
    HF_DEPTH: 18,
    CF_TIMEOUT: 15000,
    HF_TIMEOUT: 22000,
    SIGNIFICANT_CPL: 50,
    MAX_MULTIPV: 3,
    MAX_SCORE: 10000
};

const state = {
    chess: new Chess(),
    board: null,
    history: [],
    moveIndex: 0,
    evaluations: new Map(),
    moveAnalyses: [],
    isAnalyzing: false
};

const Analysis = {
    clampScore: (val) => {
        if (typeof val !== 'number' || Number.isNaN(val)) return 0;
        return Math.max(-CONFIG.MAX_SCORE, Math.min(CONFIG.MAX_SCORE, val));
    },

    normalizeMateScore: (score) => {
        if (Math.abs(score) >= CONFIG.MAX_SCORE - 500) {
            return score > 0 ? 1000 : -1000;
        }
        return score;
    },

    centipawnValue: (result) => {
        if (!result) return 0;
        if (typeof result.mate === 'number') {
            return result.mate > 0 ? CONFIG.MAX_SCORE : -CONFIG.MAX_SCORE;
        }
        return Analysis.clampScore(result.score || 0);
    },

    playerPerspective: (score, mate, turn) => {
        let val = score;
        if (typeof mate === 'number') {
            val = mate > 0 ? CONFIG.MAX_SCORE : -CONFIG.MAX_SCORE;
        }
        if (turn === 'b') val = -val;
        return val;
    },

    flipAfterMove: (score, mate, turn) => {
        let val = score;
        if (typeof mate === 'number') {
            val = mate > 0 ? CONFIG.MAX_SCORE : -CONFIG.MAX_SCORE;
        }
        if (turn === 'w') val = -val;
        return val;
    },

    calculateAccuracy: (acpl) => {
        const capped = Math.max(0, acpl);
        const acc = 103.1668 * Math.exp(-0.04354 * capped);
        return Math.max(0, Math.min(100, acc));
    },

    calculateElo: (acpl) => {
        const capped = Math.max(0, acpl);
        const elo = 2698 - 184.1 * Math.log(capped + 7);
        return Math.round(Math.max(100, Math.min(3000, elo)));
    },

    classifyMove: (cpl) => {
        if (cpl <= 10) return { type: 'best', label: 'Best', icon: '🌟', class: 'move-best' };
        if (cpl <= 25) return { type: 'excellent', label: 'Excellent', icon: '✓', class: 'move-excellent' };
        if (cpl <= 50) return { type: 'good', label: 'Good', icon: '✓', class: 'move-good' };
        if (cpl <= 100) return { type: 'inaccuracy', label: 'Inaccuracy', icon: '?!', class: 'move-inaccuracy' };
        if (cpl <= 200) return { type: 'mistake', label: 'Mistake', icon: '?', class: 'move-mistake' };
        return { type: 'blunder', label: 'Blunder', icon: '??', class: 'move-blunder' };
    }
};

class ApiEngine {
    makeKey(fen) {
        return fen.split(' ').slice(0, 4).join(' ');
    }

    cacheResult(key, result) {
        if (!result) return;
        state.evaluations.set(key, result);
    }

    async evaluate(fen, { forceHF = false } = {}) {
        const key = this.makeKey(fen);
        const targetDepth = forceHF ? CONFIG.HF_DEPTH : CONFIG.CF_DEPTH;
        const cached = state.evaluations.get(key);

        if (cached) {
            const meetsDepth = cached.depth >= targetDepth;
            const correctSource = forceHF ? cached.source === 'hf' : true;
            if (meetsDepth && correctSource) return cached;
        }

        if (!forceHF) {
            const cfResult = await this.analyzePositionCloudflare(fen);
            if (cfResult) {
                this.cacheResult(key, cfResult);
                return cfResult;
            }
        }

        const hfResult = await this.analyzePositionHF(fen);
        if (hfResult) {
            this.cacheResult(key, hfResult);
            return hfResult;
        }

        return null;
    }

    async analyzePositionCloudflare(fen) {
        try {
            const params = new URLSearchParams({
                fen,
                depth: CONFIG.CF_DEPTH,
                mode: 'bestmove'
            }).toString();

            const response = await fetch(`https://stockfish.online/api/s/v2.php?${params}`, {
                method: 'GET',
                signal: AbortSignal.timeout(CONFIG.CF_TIMEOUT)
            });

            if (!response.ok) return null;
            const data = await response.json();

            let score = 0;
            let mate = null;

            if (typeof data.mate === 'number') {
                mate = data.mate;
                score = mate > 0 ? CONFIG.MAX_SCORE : -CONFIG.MAX_SCORE;
            } else if (typeof data.evaluation === 'number') {
                score = Math.round(data.evaluation * 100);
            }

            const bestMove = data.bestmove || data.bestMove || null;

            return {
                score,
                mate,
                depth: CONFIG.CF_DEPTH,
                bestMove,
                multiPV: [],
                source: 'cloudflare'
            };
        } catch {
            return null;
        }
    }

    async analyzePositionHF(fen) {
        try {
            const response = await fetch('/api/analyzePosition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fen,
                    depth: CONFIG.HF_DEPTH,
                    multipv: CONFIG.MAX_MULTIPV
                }),
                signal: AbortSignal.timeout(CONFIG.HF_TIMEOUT)
            });

            if (!response.ok) return null;
            const data = await response.json();

            const evalValue = data.evaluation?.value ?? data.score ?? 0;
            const evalType = data.evaluation?.type;
            const mate = evalType === 'mate' ? data.evaluation.value : (data.mate ?? null);
            const bestMove = data.best_move || data.bestMove || data.bestmove || null;

            const multiPV = this.normalizeLines(data.lines || data.multipv || data.multiPV || [], {
                fallbackMove: bestMove,
                score: evalValue,
                mate,
                depth: data.depth || CONFIG.HF_DEPTH
            });

            return {
                score: Math.round(evalValue),
                mate,
                depth: data.depth || CONFIG.HF_DEPTH,
                bestMove: bestMove || multiPV[0]?.bestMove || null,
                multiPV,
                source: 'hf'
            };
        } catch {
            return null;
        }
    }

    normalizeLines(rawLines, defaults) {
        if (!Array.isArray(rawLines)) rawLines = [];
        const lines = [];

        rawLines.slice(0, CONFIG.MAX_MULTIPV).forEach((line, idx) => {
            const payload = this.extractLine(line);
            if (!payload) return;
            lines.push({
                depth: defaults.depth,
                score: payload.score ?? defaults.score ?? 0,
                mate: payload.mate ?? defaults.mate ?? null,
                bestMove: payload.bestMove || payload.moves[0] || defaults.fallbackMove || null,
                uciLine: payload.moves.join(' ').trim(),
                multipv: payload.multipv || idx + 1
            });
        });

        if (!lines.length && defaults.fallbackMove) {
            lines.push({
                depth: defaults.depth,
                score: defaults.score ?? 0,
                mate: defaults.mate ?? null,
                bestMove: defaults.fallbackMove,
                uciLine: defaults.fallbackMove,
                multipv: 1
            });
        }

        return lines;
    }

    extractLine(entry) {
        if (!entry) return null;

        if (typeof entry === 'string') {
            return { moves: entry.trim().split(/\s+/).filter(Boolean) };
        }

        if (Array.isArray(entry)) {
            return { moves: entry.map((m) => m.trim()).filter(Boolean) };
        }

        if (typeof entry === 'object') {
            const moves = [];
            if (Array.isArray(entry.moves)) moves.push(...entry.moves);
            if (typeof entry.line === 'string') moves.push(...entry.line.trim().split(/\s+/));
            if (!moves.length && typeof entry.uci === 'string') moves.push(...entry.uci.trim().split(/\s+/));
            if (!moves.length && typeof entry.uciLine === 'string') moves.push(...entry.uciLine.trim().split(/\s+/));

            return {
                moves: moves.filter(Boolean),
                bestMove: entry.bestMove || entry.bestmove,
                score: typeof entry.score === 'number' ? entry.score : undefined,
                mate: typeof entry.mate === 'number' ? entry.mate : undefined,
                multipv: entry.multipv
            };
        }

        return null;
    }
}

const engine = new ApiEngine();

const Reviewer = {
    async analyzeGame() {
        if (state.isAnalyzing) return;
        if (state.history.length < 2) {
            UI.showToast('Load a game before analyzing.', 'error');
            return;
        }

        state.isAnalyzing = true;
        UI.showLoading(true);
        state.moveAnalyses = new Array(state.history.length - 1).fill(null);

        const stats = {
            white: { cplSum: 0, moves: 0 },
            black: { cplSum: 0, moves: 0 }
        };

        try {
            for (let i = 0; i < state.history.length - 1; i++) {
                if (!state.isAnalyzing) break;

                const fenBefore = state.history[i];
                const fenAfter = state.history[i + 1];

                UI.updateProgress(i + 1, state.history.length - 1);

                const evalBefore = await engine.evaluate(fenBefore);
                const evalAfter = await engine.evaluate(fenAfter);

                if (!evalBefore || !evalAfter) {
                    state.moveAnalyses[i] = null;
                    continue;
                }

                const turn = new Chess(fenBefore).turn();
                const scoreBefore = Analysis.centipawnValue(evalBefore);
                const scoreAfter = Analysis.centipawnValue(evalAfter);

                const playerScoreBefore = Analysis.playerPerspective(scoreBefore, evalBefore.mate, turn);
                const playerScoreAfter = Analysis.flipAfterMove(scoreAfter, evalAfter.mate, turn);

                let cpl = 0;
                if (Math.abs(scoreBefore) < CONFIG.MAX_SCORE && Math.abs(scoreAfter) < CONFIG.MAX_SCORE) {
                    cpl = Math.max(0, playerScoreBefore - playerScoreAfter);
                } else if (Math.abs(scoreBefore) >= CONFIG.MAX_SCORE && Math.abs(scoreAfter) < CONFIG.MAX_SCORE) {
                    cpl = 500;
                }

                let finalEvalBefore = evalBefore;

                if (cpl >= CONFIG.SIGNIFICANT_CPL || evalBefore.source !== 'hf') {
                    const deepEval = await engine.evaluate(fenBefore, { forceHF: true });
                    if (deepEval) {
                        finalEvalBefore = deepEval;
                        const deepScore = Analysis.centipawnValue(deepEval);
                        const deepPlayerScore = Analysis.playerPerspective(deepScore, deepEval.mate, turn);
                        if (Math.abs(deepScore) < CONFIG.MAX_SCORE && Math.abs(scoreAfter) < CONFIG.MAX_SCORE) {
                            cpl = Math.max(0, deepPlayerScore - playerScoreAfter);
                        }
                    }
                }

                const bucket = turn === 'w' ? stats.white : stats.black;
                if (Math.abs(scoreBefore) < CONFIG.MAX_SCORE) {
                    bucket.cplSum += cpl;
                    bucket.moves += 1;
                }

                const quality = Analysis.classifyMove(cpl);

                state.moveAnalyses[i] = {
                    moveIndex: i,
                    playedMove: findMoveSan(fenBefore, fenAfter),
                    bestMove: finalEvalBefore.bestMove,
                    score: finalEvalBefore.score,
                    mate: finalEvalBefore.mate,
                    cpl,
                    quality,
                    fen: fenBefore,
                    multiPV: finalEvalBefore.multiPV || []
                };

                UI.updateMoveList(i);
            }

            const whiteAcpl = stats.white.moves ? stats.white.cplSum / stats.white.moves : 0;
            const blackAcpl = stats.black.moves ? stats.black.cplSum / stats.black.moves : 0;

            const summary = {
                white: {
                    accuracy: Analysis.calculateAccuracy(whiteAcpl),
                    rating: Analysis.calculateElo(whiteAcpl),
                    acpl: whiteAcpl
                },
                black: {
                    accuracy: Analysis.calculateAccuracy(blackAcpl),
                    rating: Analysis.calculateElo(blackAcpl),
                    acpl: blackAcpl
                }
            };

            UI.updateStats(summary);
            UI.showToast('Analysis complete!', 'success');
        } catch (error) {
            console.error('Analysis error:', error);
            UI.showToast('Analysis failed: ' + error.message, 'error');
        } finally {
            state.isAnalyzing = false;
            UI.showLoading(false);
        }
    }
};

function findMoveSan(fenFrom, fenTo) {
    const temp = new Chess(fenFrom);
    const moves = temp.moves({ verbose: true });

    for (const move of moves) {
        const test = new Chess(fenFrom);
        test.move(move);
        if (test.fen() === fenTo) return move.san;
    }
    return '--';
}

const UI = {
    init() {
        const els = {
            loadBtn: document.getElementById('loadGameBtn'),
            clearBtn: document.getElementById('clearBtn'),
            analyzeBtn: document.getElementById('analyzeBtn'),
            pgnInput: document.getElementById('pgnInput'),
            fenInput: document.getElementById('fenInput'),
            moveList: document.getElementById('moveList'),
            nav: {
                first: document.getElementById('firstBtn'),
                prev: document.getElementById('prevBtn'),
                next: document.getElementById('nextBtn'),
                last: document.getElementById('lastBtn')
            }
        };

        els.loadBtn.addEventListener('click', UI.loadGame);
        els.clearBtn.addEventListener('click', UI.clearGame);
        els.analyzeBtn.addEventListener('click', () => {
            if (state.isAnalyzing) {
                state.isAnalyzing = false;
                els.analyzeBtn.innerHTML = '<span class="btn-icon">🧠</span><span class="btn-text">Analyze</span>';
            } else {
                Reviewer.analyzeGame();
                els.analyzeBtn.innerHTML = '<span class="btn-icon">⏹</span><span class="btn-text">Stop</span>';
            }
        });

        els.nav.first.addEventListener('click', () => UI.goToMove(0));
        els.nav.prev.addEventListener('click', () => UI.goToMove(state.moveIndex - 1));
        els.nav.next.addEventListener('click', () => UI.goToMove(state.moveIndex + 1));
        els.nav.last.addEventListener('click', () => UI.goToMove(state.history.length - 1));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') UI.goToMove(state.moveIndex - 1);
            if (e.key === 'ArrowRight') UI.goToMove(state.moveIndex + 1);
        });

        const chessComBtn = document.getElementById('chesscomBtn');
        if (chessComBtn) {
            chessComBtn.addEventListener('click', async () => {
                const user = prompt('Enter Chess.com Username:');
                if (!user) return;

                UI.showLoading(true);
                try {
                    const res = await fetch(`https://api.chess.com/pub/player/${user}/games/archives`);
                    if (!res.ok) throw new Error('User not found');

                    const archives = await res.json();
                    if (!archives.archives.length) throw new Error('No archives found');

                    const lastArchive = archives.archives[archives.archives.length - 1];
                    const gamesRes = await fetch(lastArchive);
                    const gamesData = await gamesRes.json();
                    const games = gamesData.games.reverse().slice(0, 20);

                    if (games.length) {
                        UI.showGameSelector(games);
                    } else {
                        UI.showToast('No recent games found.', 'error');
                    }
                } catch (err) {
                    UI.showToast(err.message, 'error');
                } finally {
                    UI.showLoading(false);
                }
            });
        }

        state.board = Chessboard('board', {
            position: 'start',
            draggable: false,
            pieceTheme: (piece) => `https://assets-themes.chess.com/image/ejgfv/150/${piece.toLowerCase()}.png`
        });
    },

    showGameSelector(games) {
        const modal = document.createElement('div');
        modal.className = 'game-selector-modal';

        const content = document.createElement('div');
        content.className = 'selector-content';
        content.innerHTML = `
            <h3>Select a Game</h3>
            <div class="game-list"></div>
            <button class="close-btn">Cancel</button>
        `;

        const list = content.querySelector('.game-list');
        games.forEach((g) => {
            const el = document.createElement('div');
            el.className = 'game-option';

            const date = new Date(g.end_time * 1000).toLocaleDateString();
            const result = g.white.result === 'win' ? '1-0' : (g.black.result === 'win' ? '0-1' : '1/2-1/2');

            el.innerHTML = `
                <div class="game-info">
                    <span class="game-players">⬜ ${g.white.username} (${g.white.rating})</span>
                    <span class="game-players">⬛ ${g.black.username} (${g.black.rating})</span>
                    <span class="game-result">${date} • ${result}</span>
                </div>
            `;

            el.onclick = () => {
                document.getElementById('pgnInput').value = g.pgn;
                UI.loadGame();
                modal.remove();
                setTimeout(() => Reviewer.analyzeGame(), 400);
            };

            list.appendChild(el);
        });

        content.querySelector('.close-btn').onclick = () => modal.remove();
        modal.appendChild(content);
        document.body.appendChild(modal);
    },

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '8px';
        toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6';
        toast.style.color = '#fff';
        toast.style.zIndex = '9999';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    showLoading(show) {
        let overlay = document.getElementById('loadingOverlay');
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'loadingOverlay';
                overlay.style.cssText = `
                    position:fixed;top:0;left:0;width:100%;height:100%;
                    background:rgba(0,0,0,0.7);z-index:1000;
                    display:flex;justify-content:center;align-items:center;flex-direction:column;color:white;
                `;
                overlay.innerHTML = `
                    <div class="spinner" style="width:40px;height:40px;border:4px solid #fff;border-top:4px solid transparent;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:10px;"></div>
                    <div id="loadText">Preparing analysis...</div>
                    <style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
                `;
                document.body.appendChild(overlay);
            }
        } else if (overlay) {
            overlay.remove();
        }
    },

    updateProgress(current, total) {
        const el = document.getElementById('loadText');
        if (el) el.textContent = `Analyzing... ${current}/${total}`;
    },

    loadGame() {
        const pgn = document.getElementById('pgnInput').value;
        const fen = document.getElementById('fenInput').value;

        state.chess = new Chess();
        if (fen) {
            if (!state.chess.load(fen)) {
                UI.showToast('Invalid FEN', 'error');
                return;
            }
        } else if (pgn) {
            if (!state.chess.load_pgn(pgn)) {
                const stripped = pgn.replace(/\[.*?\]/g, '').replace(/\d+\./g, '').replace(/\s+/g, ' ').trim();
                const temp = new Chess();
                stripped.split(' ').forEach((mv) => { if (mv) temp.move(mv); });
                state.chess = temp;
            }
        }

        const history = state.chess.history({ verbose: true });
        state.chess.reset();
        state.history = [state.chess.fen()];
        history.forEach((move) => {
            state.chess.move(move);
            state.history.push(state.chess.fen());
        });

        state.moveIndex = 0;
        state.moveAnalyses = [];
        UI.updateBoard();
        UI.generateMoveList();
        UI.showToast('Game loaded. Click Analyze to begin.', 'success');
    },

    clearGame() {
        document.getElementById('pgnInput').value = '';
        document.getElementById('fenInput').value = '';
        state.chess = new Chess();
        state.history = [state.chess.fen()];
        state.moveIndex = 0;
        state.moveAnalyses = [];
        UI.updateBoard();
        UI.generateMoveList();
    },

    goToMove(index) {
        if (index < 0 || index >= state.history.length) return;
        state.moveIndex = index;
        UI.updateBoard();
    },

    updateBoard() {
        const fen = state.history[state.moveIndex];
        state.board.position(fen);

        document.querySelectorAll('.move-item').forEach((el, idx) => {
            if (idx === state.moveIndex - 1) el.classList.add('active');
            else el.classList.remove('active');
        });

        const key = fen.split(' ').slice(0, 4).join(' ');
        const cached = state.evaluations.get(key);
        const analysis = state.moveAnalyses[state.moveIndex - 1];
        const turn = new Chess(fen).turn();
        const evalData = analysis || cached;

        if (evalData?.multiPV?.length) {
            UI.drawArrows(evalData.multiPV);
            UI.updateTopLinesPanel(evalData.multiPV, turn);
        } else {
            UI.clearArrows();
            UI.hideTopLinesPanel();
        }

        if (evalData) {
            UI.updateEvalBar(evalData.score, evalData.mate, turn);
        } else {
            engine.evaluate(fen).then((result) => {
                if (result && state.history[state.moveIndex] === fen) {
                    UI.updateEvalBar(result.score, result.mate, turn);
                    if (result.multiPV?.length) {
                        UI.drawArrows(result.multiPV);
                        UI.updateTopLinesPanel(result.multiPV, turn);
                    }
                }
            });
        }

        UI.updateAnalysisDisplay();
    },

    drawArrows(lines) {
        const svg = document.getElementById('arrowOverlay');
        svg.innerHTML = '';
        const colors = ['#2ecc71', '#3498db', '#95a5a6'];

        lines.slice(0, 3).forEach((line, idx) => {
            if (!line.bestMove || line.bestMove.length < 4) return;

            const from = line.bestMove.substring(0, 2);
            const to = line.bestMove.substring(2, 4);

            const getCoords = (sq) => {
                const file = sq.charCodeAt(0) - 97;
                const rank = 8 - parseInt(sq[1], 10);
                return { x: (file + 0.5) * 12.5, y: (rank + 0.5) * 12.5 };
            };

            const start = getCoords(from);
            const end = getCoords(to);
            const color = colors[idx] || '#999';

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', `head-${idx}`);
            marker.setAttribute('markerWidth', '4');
            marker.setAttribute('markerHeight', '4');
            marker.setAttribute('refX', '2');
            marker.setAttribute('refY', '2');
            marker.setAttribute('orient', 'auto');

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 V4 L4,2 Z');
            path.setAttribute('fill', color);

            marker.appendChild(path);
            defs.appendChild(marker);
            svg.appendChild(defs);

            const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            lineEl.setAttribute('x1', start.x);
            lineEl.setAttribute('y1', start.y);
            lineEl.setAttribute('x2', end.x);
            lineEl.setAttribute('y2', end.y);
            lineEl.setAttribute('stroke', color);
            lineEl.setAttribute('stroke-width', '2');
            lineEl.setAttribute('marker-end', `url(#head-${idx})`);
            lineEl.setAttribute('opacity', '0.85');

            svg.appendChild(lineEl);
        });
    },

    clearArrows() {
        document.getElementById('arrowOverlay').innerHTML = '';
    },

    updateTopLinesPanel(lines, turn) {
        const panel = document.getElementById('topLinesPanel');
        panel.innerHTML = '';
        panel.style.display = 'block';

        lines.forEach((line, idx) => {
            const relativeScore = turn === 'w' ? line.score : -line.score;
            const displayScore = Analysis.normalizeMateScore(relativeScore);
            let scoreText = (displayScore / 100).toFixed(2);
            if (displayScore > 0) scoreText = '+' + scoreText;
            if (typeof line.mate === 'number') scoreText = `M${Math.abs(line.mate)}`;

            const sanLine = UI.convertUciToSan(line.uciLine, state.history[state.moveIndex]) || line.uciLine;

            const row = document.createElement('div');
            row.className = `top-line-row ${idx === 0 ? 'line-best' : ''}`;
            row.innerHTML = `
                <div class="line-score">${scoreText}</div>
                <div class="line-move">${sanLine}</div>
            `;
            panel.appendChild(row);
        });
    },

    hideTopLinesPanel() {
        document.getElementById('topLinesPanel').style.display = 'none';
    },

    convertUciToSan(uciLine, fen) {
        if (!uciLine) return '';
        try {
            const moves = uciLine.trim().split(/\s+/).filter(Boolean);
            const temp = new Chess(fen);
            const sanMoves = [];
            moves.slice(0, 6).forEach((uci) => {
                const from = uci.slice(0, 2);
                const to = uci.slice(2, 4);
                const promotion = uci.length > 4 ? uci.slice(4) : undefined;
                const move = temp.move({ from, to, promotion });
                if (move) sanMoves.push(move.san);
            });
            return sanMoves.join(' ');
        } catch {
            return uciLine;
        }
    },

    generateMoveList() {
        const list = document.getElementById('moveList');
        list.innerHTML = '';
        let moveNum = 1;

        for (let i = 1; i < state.history.length; i++) {
            const prev = state.history[i - 1];
            const current = state.history[i];
            const san = findMoveSan(prev, current);
            const isWhite = i % 2 !== 0;

            const item = document.createElement('div');
            item.className = 'move-item';
            item.dataset.index = i;
            item.onclick = () => UI.goToMove(i);
            item.innerHTML = `
                <span class="move-num">${isWhite ? moveNum + '.' : '...'}</span>
                <span class="move-san">${san}</span>
                <span class="move-eval"></span>
            `;
            list.appendChild(item);
            if (!isWhite) moveNum += 1;
        }
    },

    updateMoveList(index) {
        const analysis = state.moveAnalyses[index];
        if (!analysis) return;
        const items = document.querySelectorAll('.move-item');
        const item = items[index];
        if (!item) return;

        const evalSpan = item.querySelector('.move-eval');
        if (evalSpan) {
            evalSpan.textContent = analysis.quality.icon;
            evalSpan.className = `move-eval ${analysis.quality.class}`;
            evalSpan.title = `${analysis.quality.label} (CPL: ${analysis.cpl})`;
        }
    },

    updateStats(stats) {
        const whiteAcc = document.getElementById('whiteAccuracy');
        const blackAcc = document.getElementById('blackAccuracy');
        const whiteRating = document.getElementById('whiteRating');
        const blackRating = document.getElementById('blackRating');

        if (whiteAcc) whiteAcc.textContent = `${stats.white.accuracy.toFixed(1)}%`;
        if (blackAcc) blackAcc.textContent = `${stats.black.accuracy.toFixed(1)}%`;
        if (whiteRating) whiteRating.textContent = `~${stats.white.rating}`;
        if (blackRating) blackRating.textContent = `~${stats.black.rating}`;
    },

    updateEvalBar(cp, mate, turn) {
        const bar = document.getElementById('evalBarFill');
        const text = document.getElementById('evalScoreBoard');

        let score = cp;
        if (turn === 'b') {
            score = -score;
            if (mate) mate = -mate;
        }

        let barScore = Math.max(-1000, Math.min(1000, score));
        if (typeof mate === 'number') barScore = mate > 0 ? 1000 : -1000;

        const percent = 50 + barScore / 20;
        bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;

        if (barScore > 50) bar.style.background = '#4CAF50';
        else if (barScore < -50) bar.style.background = '#f44336';
        else bar.style.background = '#888';

        if (typeof mate === 'number') {
            text.textContent = `M${Math.abs(mate)}`;
        } else {
            text.textContent = (Analysis.normalizeMateScore(score) / 100).toFixed(2);
        }
    },

    updateAnalysisDisplay() {
        const display = document.getElementById('analysisDisplay');
        const analysis = state.moveAnalyses[state.moveIndex - 1];
        if (!analysis) {
            display.textContent = state.moveIndex === 0 ? 'Start of game.' : 'Analyzing...';
            return;
        }

        const score = Analysis.normalizeMateScore(analysis.score);
        display.innerHTML = `
            <div class="analysis-detail">
                <div class="analysis-header">
                    <div class="analysis-badge ${analysis.quality.class}">
                        ${analysis.quality.icon} ${analysis.quality.label}
                    </div>
                    <div class="analysis-score">
                        Eval: ${score > 0 ? '+' : ''}${(score / 100).toFixed(2)}
                    </div>
                </div>
                <div class="analysis-row">
                    <strong>Played:</strong> ${analysis.playedMove}
                </div>
                <div class="analysis-row best-line-row">
                    <strong>Best Move:</strong> ${analysis.bestMove || '--'}
                </div>
                <div class="analysis-row cpl-row">
                    <strong>Centipawn Loss:</strong> ${analysis.cpl}
                </div>
            </div>
        `;
    }
};

document.addEventListener('DOMContentLoaded', UI.init);