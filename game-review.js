import { createEngine } from '/engine/engine-wrapper.js';

const CONFIG = {
    DEPTH: 18,
    MOVETIME: 1000,
    TIMEOUT: 20000,
};

const state = {
    chess: new Chess(),
    board: null,
    history: [],
    moveIndex: 0,
    evaluations: new Map(),
    moveAnalyses: [],
    isAnalyzing: false,
    engineReady: false,
    useApi: false,
    stockfishWorker: null,
    engineCallbacks: new Map(),
    analysisController: null,
    bestLineArrow: null
};

const Analysis = {
    normalizeScore: (val) => {
        if (typeof val !== 'number') return 0;
        return Math.max(-10000, Math.min(10000, val));
    },
    
    normalizeMateScore: (score) => {
        if (Math.abs(score) >= 9000) {
            return score > 0 ? 1000 : -1000;
        }
        return score;
    },

    calculateAccuracy: (acpl) => {
        if (acpl < 0) acpl = 0;
        const acc = 103.1668 * Math.exp(-0.04354 * acpl);
        return Math.min(100, Math.max(0, acc));
    },

    calculateElo: (acpl) => {
        if (acpl < 0) acpl = 0;
        const elo = 2698 - 184.1 * Math.log(acpl + 7);
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

class StockfishEngine {
    constructor() {
        this.engine = null;
        this.isReady = false;
        this.pendingResolve = null;
        this.currentMultiPV = [];
    }

    async init() {
        return new Promise(async (resolve) => {
            try {
                this.engine = await createEngine();

                this.engine.onMessage((line) => {
                    // console.log('Engine:', line); // Uncomment for debug
                    this.handleMessage(line);
                });

                this.engine.send("uci");

                const check = setInterval(() => {
                    if (this.isReady) {
                        clearInterval(check);
                        resolve(true);
                    }
                }, 100);

                setTimeout(() => {
                    if (!this.isReady) {
                        clearInterval(check);
                        console.warn("WASM startup timeout, but proceeding if engine is responsive.");
                        // We don't reject/resolve false here immediately because worker might just be slow
                        // resolve(false); 
                        // Instead we let it keep running or rely on later interactions
                        resolve(true); // Optimistically resolve
                    }
                }, 15000);

            } catch (err) {
                console.error("init failed:", err);
                resolve(false);
            }
        });
    }

    handleMessage(line) {
        if (line === 'uciok') {
            this.isReady = true;
            this.engine.send('setoption name MultiPV value 3');
            this.engine.send('setoption name Threads value 4');
            this.engine.send('setoption name Use NNUE value true');
            this.engine.send('isready');
            UI.updateStatus('Stockfish WASM (Local)', true);
            return;
        }
        
        if (this.pendingResolve) {
            if (line.startsWith('info') && line.includes('score') && line.includes('multipv')) {
                const parts = line.split(' ');
                
                const getVal = (key) => {
                    const idx = parts.indexOf(key);
                    return idx !== -1 ? parts[idx + 1] : null;
                };

                const mpv = parseInt(getVal('multipv'));
                const depth = parseInt(getVal('depth'));
                const scoreType = getVal('score');
                let rawScore = parseInt(parts[parts.indexOf(scoreType) + 1]);
                
                let score = rawScore;
                let mate = null;
                
                if (scoreType === 'mate') {
                    mate = rawScore;
                    score = mate > 0 ? 10000 : -10000;
                }

                const pvIdx = parts.indexOf('pv');
                const pvMoves = pvIdx !== -1 ? parts.slice(pvIdx + 1).join(' ') : '';
                const bestMove = pvIdx !== -1 ? parts[pvIdx + 1] : null;

                this.currentMultiPV[mpv - 1] = {
                    depth,
                    score,
                    mate,
                    bestMove,
                    uciLine: pvMoves,
                    multipv: mpv
                };

                if (mpv === 1) {
                    this.pendingResolve.currentResult = {
                        score,
                        mate,
                        depth,
                        bestMove,
                        multiPV: [...this.currentMultiPV]
                    };
                } else {
                    if (this.pendingResolve.currentResult) {
                         this.pendingResolve.currentResult.multiPV = [...this.currentMultiPV];
                    }
                }
            }

            if (line.startsWith('bestmove')) {
                const bestMove = line.split(' ')[1];
                const result = this.pendingResolve.currentResult || { score: 0, depth: 0, mate: null, multiPV: [] };
                result.bestMove = bestMove;
                result.multiPV = this.currentMultiPV.filter(x => x);
                
                const resolve = this.pendingResolve.resolve;
                this.pendingResolve = null;
                resolve(result);
            }
        }
    }

    async evaluate(fen, depth = CONFIG.DEPTH) {
        const cacheKey = fen.split(' ').slice(0, 4).join(' ');
        if (state.evaluations.has(cacheKey)) {
             const cached = state.evaluations.get(cacheKey);
             if (cached.depth >= depth) return cached;
        }

        if (!this.engine) {
             return { score: 0, depth: 0, error: 'No Engine' };
        }
        
        return this.evaluateWasm(fen, depth);
    }

    async evaluateWasm(fen, depth) {
        this.currentMultiPV = [];
        
        return new Promise((resolve, reject) => {
            if (this.pendingResolve) {
                this.pendingResolve.resolve({ score: 0, depth: 0, error: 'Interrupted' });
            }

            const timer = setTimeout(() => {
                if (this.pendingResolve === pending) {
                    this.pendingResolve = null;
                    resolve({ score: 0, depth: 0, error: 'Timeout' });
                }
            }, CONFIG.TIMEOUT);

            const pending = { 
                resolve: (result) => {
                    clearTimeout(timer);
                    state.evaluations.set(fen.split(' ').slice(0, 4).join(' '), result);
                    resolve(result);
                }, 
                currentResult: null 
            };

            this.pendingResolve = pending;
            this.engine.send('position fen ' + fen);
            this.engine.send(`go depth ${depth}`);
        });
    }
    
    stop() {
        if (this.engine) {
            this.engine.send('stop');
        }
    }
}

const engine = new StockfishEngine();

const Reviewer = {
    async analyzeGame() {
        if (state.isAnalyzing) return;
        state.isAnalyzing = true;
        UI.showLoading(true);
        
        state.moveAnalyses = new Array(state.history.length).fill(null);
        
        let whiteStats = { cplSum: 0, moves: 0 };
        let blackStats = { cplSum: 0, moves: 0 };

        try {
            for (let i = 0; i < state.history.length - 1; i++) {
                if (!state.isAnalyzing) break;

                const fenBefore = state.history[i];
                const fenAfter = state.history[i + 1];
                
                UI.updateProgress(i + 1, state.history.length - 1);

                const evalBefore = await engine.evaluate(fenBefore);
                const evalAfter = await engine.evaluate(fenAfter);

                const turn = new Chess(fenBefore).turn(); 
                
                const scoreBefore = evalBefore.score; 
                const scoreAfter = -evalAfter.score; 
                
                let cpl = 0;
                if (Math.abs(scoreBefore) < 9000 && Math.abs(scoreAfter) < 9000) {
                    const diff = scoreBefore - scoreAfter;
                    cpl = Math.max(0, diff);
                } else {
                     if (Math.abs(scoreBefore) > 9000 && Math.abs(scoreAfter) < 9000) {
                         cpl = 500;
                     } else {
                         cpl = 0;
                     }
                }
                
                if (Math.abs(scoreBefore) < 9000) {
                    if (turn === 'w') {
                        whiteStats.cplSum += cpl;
                        whiteStats.moves++;
                    } else {
                        blackStats.cplSum += cpl;
                        blackStats.moves++;
                    }
                }

                const quality = Analysis.classifyMove(cpl);
                
                state.moveAnalyses[i] = {
                    moveIndex: i,
                    playedMove: findMoveSan(fenBefore, fenAfter),
                    bestMove: evalBefore.bestMove,
                    score: scoreBefore,
                    mate: evalBefore.mate,
                    cpl: cpl,
                    quality: quality,
                    fen: fenBefore,
                    multiPV: evalBefore.multiPV || []
                };
                
                UI.updateMoveList(i);
            }
            
            const whiteAcpl = whiteStats.moves > 0 ? whiteStats.cplSum / whiteStats.moves : 0;
            const blackAcpl = blackStats.moves > 0 ? blackStats.cplSum / blackStats.moves : 0;

            const stats = {
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

            UI.updateStats(stats);
            UI.showToast(`Analysis Complete!`, 'success');
        } catch (error) {
            console.error("Analysis error:", error);
            UI.showToast("Analysis failed: " + error.message, "error");
        } finally {
            UI.showLoading(false);
            state.isAnalyzing = false;
        }
    }
};

function findMoveSan(fenFrom, fenTo) {
    const tempGame = new Chess(fenFrom);
    const moves = tempGame.moves({ verbose: true });
    for (const m of moves) {
        const g = new Chess(fenFrom);
        g.move(m);
        if (g.fen() === fenTo) return m.san;
    }
    return '--';
}

const UI = {
    init: () => {
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
                last: document.getElementById('lastBtn'),
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
                if(!user) return;
                UI.showLoading(true);
                try {
                    const res = await fetch(`https://api.chess.com/pub/player/${user}/games/archives`);
                    if(!res.ok) throw new Error('User not found');
                    const archives = await res.json();
                    if (archives.archives.length === 0) throw new Error('No archives found');
                    
                    const lastArchive = archives.archives[archives.archives.length - 1];
                    const gamesRes = await fetch(lastArchive);
                    const gamesData = await gamesRes.json();
                    const games = gamesData.games.reverse().slice(0, 20);
                    
                    if (games.length > 0) {
                        UI.showGameSelector(games);
                    } else {
                        UI.showToast('No games found in this month.', 'error');
                    }
                } catch(e) {
                    UI.showToast('Error: ' + e.message, 'error');
                } finally {
                    UI.showLoading(false);
                }
            });
        }

        engine.init().then(() => {
            console.log('Engine initialized');
        });

            state.board = Chessboard('board', {
                position: 'start',
                draggable: false,
                pieceTheme: (piece) => {
                    return 'https://chessboardjs.com/img/chesspieces/wikipedia/' + piece + '.png';
                }
            });
    },

    showGameSelector: (games) => {
        const modal = document.createElement('div');
        modal.className = 'game-selector-modal';
        const content = document.createElement('div');
        content.className = 'selector-content';
        content.innerHTML = `<h3>Select a Game</h3><div class="game-list"></div><button class="close-btn">Cancel</button>`;
        const list = content.querySelector('.game-list');
        games.forEach(g => {
            const el = document.createElement('div');
            el.className = 'game-option';
            const date = new Date(g.end_time * 1000).toLocaleDateString();
            const result = g.white.result === 'win' ? '1-0' : (g.black.result === 'win' ? '0-1' : '1/2-1/2');
            el.innerHTML = `<div class="game-info"><span class="game-players">⬜ ${g.white.username} (${g.white.rating})</span><span class="game-players">⬛ ${g.black.username} (${g.black.rating})</span><span class="game-result">${date} • ${result}</span></div>`;
            el.onclick = () => {
                document.getElementById('pgnInput').value = g.pgn;
                UI.loadGame();
                modal.remove();
                setTimeout(() => { Reviewer.analyzeGame(); }, 500);
            };
            list.appendChild(el);
        });
        content.querySelector('.close-btn').onclick = () => modal.remove();
        modal.appendChild(content);
        document.body.appendChild(modal);
    },

    updateStatus: (text, ready) => {
        const el = document.getElementById('statusText');
        const dot = document.getElementById('statusDot');
        if (el) el.textContent = text;
        if (dot) dot.className = 'status-dot' + (ready ? ' ready' : '');
    },

    showToast: (msg, type = 'info') => {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = msg;
        t.style.position = 'fixed';
        t.style.bottom = '20px';
        t.style.right = '20px';
        t.style.padding = '12px 24px';
        t.style.borderRadius = '8px';
        t.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6';
        t.style.color = 'white';
        t.style.zIndex = '9999';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    },

    showLoading: (show) => {
        let overlay = document.getElementById('loadingOverlay');
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'loadingOverlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000;display:flex;justify-content:center;align-items:center;flex-direction:column;color:white;';
                overlay.innerHTML = '<div class="spinner" style="width:40px;height:40px;border:4px solid #fff;border-top:4px solid transparent;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:10px;"></div><div id="loadText">Analyzing...</div><style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>';
                document.body.appendChild(overlay);
            }
        } else {
            if (overlay) overlay.remove();
        }
    },
    
    updateProgress: (current, total) => {
        const el = document.getElementById('loadText');
        if (el) el.textContent = `Analyzing... ${current}/${total}`;
    },

    loadGame: () => {
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
                 const moves = pgn.replace(/\[.*?\]/g, '').replace(/\d+\./g, '').replace(/\s+/g, ' ').trim();
                 const temp = new Chess();
                 const moveArr = moves.split(' ');
                 for(let m of moveArr) { if(m) temp.move(m); }
                 state.chess = temp;
            }
        }
        const history = state.chess.history({ verbose: true });
        state.chess.reset();
        state.history = [state.chess.fen()];
        for (const move of history) {
            state.chess.move(move);
            state.history.push(state.chess.fen());
        }
        state.moveIndex = 0;
        state.moveAnalyses = [];
        UI.updateBoard();
        UI.generateMoveList();
        UI.showToast('Game loaded. Click Analyze to start.', 'success');
    },

    clearGame: () => {
        document.getElementById('pgnInput').value = '';
        document.getElementById('fenInput').value = '';
        state.chess = new Chess();
        state.history = [state.chess.fen()];
        state.moveIndex = 0;
        state.moveAnalyses = [];
        UI.updateBoard();
        UI.generateMoveList();
    },

    goToMove: (index) => {
        if (index < 0 || index >= state.history.length) return;
        state.moveIndex = index;
        UI.updateBoard();
    },

    updateBoard: () => {
        const fen = state.history[state.moveIndex];
        state.board.position(fen);
        
        document.querySelectorAll('.move-item').forEach((el, idx) => {
            if (idx === state.moveIndex - 1) el.classList.add('active');
            else el.classList.remove('active');
        });
        
        const cached = state.evaluations.get(fen.split(' ').slice(0,4).join(' '));
        const analysis = state.moveAnalyses[state.moveIndex - 1]; 

        const turn = new Chess(fen).turn();
        const evalData = analysis || cached;

        if (evalData && evalData.multiPV) {
            UI.drawArrows(evalData.multiPV);
            UI.updateTopLinesPanel(evalData.multiPV, turn);
        } else {
            UI.clearArrows();
            UI.hideTopLinesPanel();
        }

        if (evalData) {
             UI.updateEvalBar(evalData.score, evalData.mate, turn);
        } else {
             engine.evaluate(fen, CONFIG.DEPTH).then(res => {
                 if(state.moveIndex === state.history.indexOf(fen)) {
                     UI.updateEvalBar(res.score, res.mate, turn);
                     if (res.multiPV) {
                         UI.drawArrows(res.multiPV);
                         UI.updateTopLinesPanel(res.multiPV, turn);
                     }
                 }
             });
        }
        
        UI.updateAnalysisDisplay();
    },

    drawArrows: (lines) => {
        const svg = document.getElementById('arrowOverlay');
        svg.innerHTML = ''; 
        
        const colors = ['#2ecc71', '#3498db', '#95a5a6'];
        
        lines.forEach((line, idx) => {
            if (!line.bestMove || idx > 2) return;
            
            const from = line.bestMove.substring(0, 2);
            const to = line.bestMove.substring(2, 4);
            
            const getCoords = (sq) => {
                const file = sq.charCodeAt(0) - 97;
                const rank = 8 - parseInt(sq[1]);
                return { x: (file + 0.5) * 12.5, y: (rank + 0.5) * 12.5 };
            };

            const start = getCoords(from);
            const end = getCoords(to);
            const color = colors[idx] || '#999';
            
            const id = `arrow-${idx}`;
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
            lineEl.setAttribute('opacity', '0.8');
            
            svg.appendChild(lineEl);
        });
    },
    
    clearArrows: () => {
        document.getElementById('arrowOverlay').innerHTML = '';
    },

    updateTopLinesPanel: (lines, turn) => {
        const panel = document.getElementById('topLinesPanel');
        panel.innerHTML = '';
        panel.style.display = 'block';
        
        lines.forEach((line, idx) => {
            let score = line.score;
            let mate = line.mate;
            
            let absScore = (turn === 'w' ? score : -score);
            if (mate) absScore = (turn === 'w' ? mate : -mate); 
            
            const displayScore = Analysis.normalizeMateScore(absScore);
            
            let scoreStr = (displayScore / 100).toFixed(2);
            if (displayScore > 0) scoreStr = '+' + scoreStr;
            if (mate) scoreStr = `M${Math.abs(mate)}`;
            
            let sanLine = '';
            if (line.uciLine) {
                try {
                    const tmp = new Chess(state.chess.fen()); 
                    const fen = state.history[state.moveIndex];
                    const dummy = new Chess(fen);
                    const moves = line.uciLine.split(' ');
                    const sanMoves = [];
                    for(let i=0; i<Math.min(moves.length, 4); i++) {
                         const m = moves[i];
                         const from = m.substring(0,2);
                         const to = m.substring(2,4);
                         const prom = m.length > 4 ? m.substring(4) : undefined;
                         const moveObj = dummy.move({ from, to, promotion: prom || 'q' });
                         if(moveObj) sanMoves.push(moveObj.san);
                    }
                    sanLine = sanMoves.join(' ');
                } catch(e) {
                    sanLine = line.uciLine;
                }
            }

            const row = document.createElement('div');
            row.className = `top-line-row ${idx === 0 ? 'line-best' : ''}`;
            row.innerHTML = `
                <div class="line-score">${scoreStr}</div>
                <div class="line-move">${sanLine}</div>
            `;
            panel.appendChild(row);
        });
    },
    
    hideTopLinesPanel: () => {
        document.getElementById('topLinesPanel').style.display = 'none';
    },

    generateMoveList: () => {
        const list = document.getElementById('moveList');
        list.innerHTML = '';
        let moveNum = 1;
        for (let i = 1; i < state.history.length; i++) {
            const fenPrev = state.history[i-1];
            const fenCurr = state.history[i];
            const san = findMoveSan(fenPrev, fenCurr);
            const isWhite = (i % 2 !== 0);
            const item = document.createElement('div');
            item.className = 'move-item';
            item.dataset.index = i;
            item.onclick = () => UI.goToMove(i);
            item.innerHTML = `<span class="move-num">${isWhite ? moveNum + '.' : '...'}</span><span class="move-san">${san}</span><span class="move-eval"></span>`;
            list.appendChild(item);
            if (!isWhite) moveNum++;
        }
    },

    updateMoveList: (moveIdx) => {
        const analysis = state.moveAnalyses[moveIdx];
        if (!analysis) return;
        const items = document.querySelectorAll('.move-item');
        const item = items[moveIdx];
        if (!item) return;
        const evalSpan = item.querySelector('.move-eval');
        if (evalSpan) {
            evalSpan.textContent = analysis.quality.icon;
            evalSpan.className = `move-eval ${analysis.quality.class}`;
            evalSpan.title = `${analysis.quality.label} (CPL: ${analysis.cpl})`;
        }
    },

    updateEvalBar: (cp, mate, turn) => {
        const bar = document.getElementById('evalBarFill');
        const text = document.getElementById('evalScoreBoard');
        
        let score = cp;
        if (turn === 'b') {
            score = -score;
            if (mate) mate = -mate;
        }

        let barScore = Math.max(-1000, Math.min(1000, score));
        if (mate) barScore = mate > 0 ? 1000 : -1000;

        const percent = 50 + (barScore / 20); 
        bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        
        if (barScore > 50) bar.style.background = '#4CAF50'; 
        else if (barScore < -50) bar.style.background = '#f44336'; 
        else bar.style.background = '#888'; 

        let displayScore = Analysis.normalizeMateScore(score);
        if (mate) {
             text.textContent = `M${Math.abs(mate)}`;
        } else {
             text.textContent = (displayScore / 100).toFixed(2);
        }
    },

    updateAnalysisDisplay: () => {
        const display = document.getElementById('analysisDisplay');
        const analysis = state.moveAnalyses[state.moveIndex - 1];
        if (!analysis) {
             if (state.moveIndex === 0) display.textContent = 'Start of game.';
             else display.textContent = 'Analyzing...';
             return;
        }
        const displayScore = Analysis.normalizeMateScore(analysis.score);
        display.innerHTML = `
            <div class="analysis-detail">
                <div class="analysis-header">
                    <div class="analysis-badge ${analysis.quality.class}">
                        ${analysis.quality.icon} ${analysis.quality.label}
                    </div>
                    <div class="analysis-score">
                        Eval: ${displayScore > 0 ? '+' : ''}${(displayScore / 100).toFixed(2)}
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