(() => {
    /* ============================
     * Configuration & Constants
     * ============================ */
const CONFIG = {
        TIER1_DEPTH: 12,
        TIER2_DEPTH: 22,
        CF_TIMEOUT: 1800,
    HF_TIMEOUT: 22000,
        SIGNIFICANT_CPL: 60,
        TURNING_POINT_SWING: 180,
        MAX_MULTIPV: 5,
        PREVIEW_MAX_PLIES: 8,
        MAX_SCORE: 10000,
        MAX_PARALLEL_REQUESTS: 1
    };

    const LINE_COLORS = ['#00d47e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];

    /* ============================
     * Global State
     * ============================ */
    const State = {
    chess: new Chess(),
        scratch: new Chess(),
    board: null,
    history: [],
        headers: {},
    moveIndex: 0,
    moveAnalyses: [],
        stats: {
            white: { accuracy: 0, acpl: 0, rating: 0 },
            black: { accuracy: 0, acpl: 0, rating: 0 }
        },
        summary: null,
        preview: null,
        previewTimeout: null,
        linesExpanded: false,
        activeLine: 0,
        evaluations: new Map(),
        isAnalyzing: false,
        analysisAbort: null,
        hfWarned: false
    };

    const Runtime = {
        allowProxy: (() => {
            if (typeof window === 'undefined') return true;
            const { protocol, hostname, port } = window.location;
            if (protocol === 'file:') return false;
            if ((hostname === '127.0.0.1' || hostname === 'localhost') && port === '5500') return false;
            return true;
        })()
    };

    /* ============================
     * Utility Helpers
     * ============================ */
    const Utils = {
        fenKey(fen) {
            return fen.split(' ').slice(0, 4).join(' ');
        },
        turnLabel(fen) {
            return (fen.split(' ')[1] || 'w') === 'w' ? 'White' : 'Black';
        },
        parsePgn(text) {
            const headers = {};
            text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, key, value) => {
                headers[key] = value;
                return '';
            });
            
            // Remove header section completely
            let body = text.replace(/\[.*?\]\s*/g, '');
            
            // Remove all annotations and comments
            body = body
                .replace(/\{[^}]*\}/g, ' ')  // Remove {comments} and {[%clk ...]}
                .replace(/\([^)]*\)/g, ' ')   // Remove (variations)
                .replace(/\$[0-9]+/g, ' ')    // Remove $NAGs
                .replace(/;[^\n]*/g, ' ')     // Remove ; comments
                .replace(/\s+/g, ' ')         // Normalize whitespace
                .trim();
            
            return { headers, body };
        },
        loadPgn(body) {
            const temp = new Chess();
            
            // Try loading as PGN first
            let success = false;
            try {
                success = temp.load_pgn(body, { sloppy: true });
            } catch (e) {
                success = false;
            }
            
            // If PGN loading failed, try parsing as move list
            if (!success) {
                temp.reset();
                const tokens = body.trim().split(/\s+/);
                const failedMoves = [];
                
                for (const token of tokens) {
                    if (!token) continue;
                    if (/^\d+\.+$/.test(token)) continue;
                    if (['1-0', '0-1', '1/2-1/2', '*'].includes(token)) continue;
                    
                    try {
                        const result = temp.move(token, { sloppy: true });
                        if (!result) {
                            failedMoves.push(token);
                        }
                    } catch (e) {
                        failedMoves.push(token);
                    }
                }
                
                if (temp.history().length === 0) {
                    throw new Error('Unable to parse PGN - no valid moves found.');
                }
                
                // Warn if moves were skipped
                if (failedMoves.length > 0) {
                    console.warn(`Skipped ${failedMoves.length} invalid moves:`, failedMoves.slice(0, 5).join(', '));
                }
            }
            
            const verbose = temp.history({ verbose: true });
            const replay = new Chess();
            const history = [replay.fen()];
            for (const move of verbose) {
                replay.move(move);
                history.push(replay.fen());
            }
            return history;
        },
        san(fromFen, toFen) {
            State.scratch.load(fromFen);
            const found = State.scratch.moves({ verbose: true }).find((mv) => {
                State.scratch.load(fromFen);
                State.scratch.move(mv);
                return State.scratch.fen() === toFen;
            });
            return found ? found.san : '--';
        },
        uciToSan(fen, uciLine, limit = 6) {
            if (!uciLine) return '';
            const tmp = new Chess(fen);
            const steps = uciLine.trim().split(/\s+/).filter(Boolean);
            const san = [];
            for (let i = 0; i < Math.min(steps.length, limit); i++) {
                const move = steps[i];
                const played = tmp.move({
                    from: move.slice(0, 2),
                    to: move.slice(2, 4),
                    promotion: move[4]
                });
                if (!played) break;
                san.push(played.san);
            }
            return san.join(' ');
        },
        previewLine(fen, uciLine) {
            const tmp = new Chess(fen);
            const steps = uciLine.trim().split(/\s+/).filter(Boolean).slice(0, CONFIG.PREVIEW_MAX_PLIES);
            const san = [];
            const arrows = [];
            steps.forEach((move) => {
                const from = move.slice(0, 2);
                const to = move.slice(2, 4);
                const played = tmp.move({ from, to, promotion: move[4] });
                if (played) {
                    san.push(played.san);
                    arrows.push({ from, to });
                }
            });
            return { fen: tmp.fen(), san, arrows };
        }
    };

    /* ============================
     * Evaluation Cache
     * ============================ */
    const EvalCache = (() => {
        const store = new Map();
        const bySource = new Map();

        function save(key, source, depth, result) {
            store.set(`${key}|${source}|${depth}`, result);
            if (!bySource.has(key)) bySource.set(key, {});
            const bucket = bySource.get(key);
            if (!bucket[source]) bucket[source] = new Map();
            bucket[source].set(depth, result);
        }

        function lookup(key, source, minDepth) {
            const bucket = bySource.get(key);
            if (!bucket || !bucket[source]) return null;
            let best = null;
            bucket[source].forEach((value, depth) => {
                if (depth >= minDepth && (!best || depth > best.depth)) {
                    best = value;
                }
            });
            return best;
        }

        function best(key) {
            const bucket = bySource.get(key);
            if (!bucket) return null;
            let best = null;
            ['hf', 'cloudflare'].forEach((source) => {
                if (!bucket[source]) return;
                bucket[source].forEach((value) => {
                    if (!best || value.depth > best.depth) {
                        best = value;
                    }
                });
            });
            return best;
        }

        return { save, lookup, best };
    })();

    /* ============================
     * Analysis Helpers
     * ============================ */
    const Analysis = {
        normalize({ cp, mate, turn }) {
            if (typeof mate === 'number') {
                const signed = turn === 'w' ? mate : -mate;
                return { cp: signed > 0 ? CONFIG.MAX_SCORE : -CONFIG.MAX_SCORE, mate: signed };
            }
            const score = typeof cp === 'number' ? cp : 0;
            return { cp: turn === 'w' ? score : -score, mate: null };
        },
        perspective(cpWhite, mate, player) {
            if (mate !== null) return mate > 0 ? CONFIG.MAX_SCORE : -CONFIG.MAX_SCORE;
            return player === 'White' ? cpWhite : -cpWhite;
        },
        cpl(before, after) {
            return Math.max(0, Math.round(before - after));
        },
        classify(cpl) {
            if (cpl <= 10) return { label: 'Best', icon: '🌟', className: 'move-best' };
            if (cpl <= 25) return { label: 'Excellent', icon: '👍', className: 'move-excellent' };
            if (cpl <= 60) return { label: 'Good', icon: '✓', className: 'move-good' };
            if (cpl <= 150) return { label: 'Inaccuracy', icon: '?!', className: 'move-inaccuracy' };
            if (cpl <= 300) return { label: 'Mistake', icon: '?', className: 'move-mistake' };
            return { label: 'Blunder', icon: '??', className: 'move-blunder' };
        },
        accuracy(acpl) {
            // Use exponential decay formula (consistent with server)
            return Math.min(100, Math.round(100 * Math.exp(-0.002 * acpl)));
        },
        rating(acpl) {
            return Math.round(Math.max(100, Math.min(3000, 2900 - 250 * Math.log10(acpl + 12))));
        }
    };

    /* ============================
     * Request Queue
     * ============================ */
    const RequestQueue = (() => {
        const queue = [];
        const inflight = new Map();
        let active = 0;

        function pump() {
            if (active >= CONFIG.MAX_PARALLEL_REQUESTS) return;
            const job = queue.shift();
            if (!job) return;
            if (job.signal?.aborted) {
                job.reject(new DOMException('Aborted', 'AbortError'));
                pump();
                return;
            }
            active += 1;
            job
                .task()
                .then(job.resolve)
                .catch(job.reject)
                .finally(() => {
                    active -= 1;
                    inflight.delete(job.key);
                    pump();
                });
        }

        function enqueue(key, task, signal) {
            if (inflight.has(key)) return inflight.get(key);
            const promise = new Promise((resolve, reject) => {
                queue.push({ key, task, resolve, reject, signal });
                pump();
            });
            inflight.set(key, promise);
            return promise;
        }

        return { enqueue };
    })();

    function timeoutSignal(parent, ms) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        if (parent) {
            if (parent.aborted) controller.abort();
            else parent.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return {
            signal: controller.signal,
            clear: () => clearTimeout(timer)
        };
    }

    async function fetchCloudflare(fen, externalSignal) {
            const params = new URLSearchParams({
                fen,
            depth: String(CONFIG.TIER1_DEPTH),
                mode: 'bestmove'
            }).toString();
        const { signal, clear } = timeoutSignal(externalSignal, CONFIG.CF_TIMEOUT);
        try {
            const res = await fetch(`https://stockfish.online/api/s/v2.php?${params}`, {
                method: 'GET',
                signal: signal.signal
            });
            clear();
            if (!res.ok) return null;
            const json = await res.json();
            
            // Parse the Cloudflare response
            // The API returns evaluation from White's perspective already
            let cpWhite = 0;
            let mate = null;

            // Check if there's a mate score
            if (json.mate !== null && json.mate !== undefined) {
                mate = parseInt(json.mate, 10);
            }
            
            // Parse centipawn evaluation (already from White's perspective)
            // Cloudflare API can return evaluation as string in pawns or centipawns
            if (json.evaluation !== undefined && json.evaluation !== null) {
                const evalStr = String(json.evaluation);
                
                // If contains decimal point, it's in pawns - multiply by 100
                if (evalStr.indexOf('.') !== -1) {
                    cpWhite = Math.round(parseFloat(evalStr) * 100);
                } else {
                    const intVal = parseInt(evalStr, 10);
                    // If integer is small (≤20), treat as pawns
                    if (Math.abs(intVal) <= 20) {
                        cpWhite = intVal * 100;
                    } else {
                        // Otherwise assume centipawns
                        cpWhite = intVal;
                    }
                }
            } else if (json.eval !== undefined && json.eval !== null) {
                const evalStr = String(json.eval);
                if (evalStr.indexOf('.') !== -1) {
                    cpWhite = Math.round(parseFloat(evalStr) * 100);
                } else {
                    const intVal = parseInt(evalStr, 10);
                    cpWhite = Math.abs(intVal) <= 20 ? intVal * 100 : intVal;
                }
            }

            return {
                cpWhite,
                mate,
                depth: json.depth || CONFIG.TIER1_DEPTH,
                bestMove: json.bestmove || '',
                multiPV: []
            };
        } catch (err) {
            clear();
            if (err.name === 'AbortError' && externalSignal?.aborted) throw err;
            return null;
        }
    }

    async function fetchHF(fen, externalSignal) {
        if (!Runtime.allowProxy) {
            if (!State.hfWarned) {
                console.warn('[HF] Proxy disabled in local static environment.');
                State.hfWarned = true;
            }
            return null;
        }
        const { signal, clear } = timeoutSignal(externalSignal, CONFIG.HF_TIMEOUT);
        try {
            const res = await fetch('/api/analyzePosition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fen,
                    depth: CONFIG.TIER2_DEPTH,
                    multipv: CONFIG.MAX_MULTIPV
                }),
                signal: signal.signal
            });
            clear();
            if (!res.ok) return null;
            const json = await res.json();
            return {
                cpWhite: json.eval || 0,
                mate: json.mate || null,
                depth: json.depth || CONFIG.TIER2_DEPTH,
                bestMove: json.bestmove || '',
                multiPV: json.pvs || []
            };
        } catch (err) {
            clear();
            if (err.name === 'AbortError' && externalSignal?.aborted) throw err;
            return null;
        }
    }

    /* ============================
     * Engine Interface
     * ============================ */
    const Engine = {
        async evaluate(fen, tier = 1, signal = null) {
            const key = Utils.fenKey(fen);
            const cached = tier === 1 
                ? EvalCache.lookup(key, 'cloudflare', CONFIG.TIER1_DEPTH)
                : EvalCache.lookup(key, 'hf', CONFIG.TIER2_DEPTH);
            
            if (cached) return cached;

            const task = async () => {
                if (tier === 1) {
                    const result = await fetchCloudflare(fen, signal);
                    if (result) {
                        EvalCache.save(key, 'cloudflare', result.depth, result);
                        return result;
                    }
                }
                const result = await fetchHF(fen, signal);
                if (result) {
                    EvalCache.save(key, 'hf', result.depth, result);
                }
                return result;
            };

            return RequestQueue.enqueue(`${key}|${tier}`, task, signal);
        }
    };

    /* ============================
     * Arrow Layer (Canvas)
     * ============================ */
    const ArrowLayer = {
        canvas: null,
        ctx: null,

        init() {
            this.canvas = document.getElementById('arrowLayer');
            if (!this.canvas) {
                console.error('Arrow canvas not found!');
                return;
            }
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            window.addEventListener('resize', () => this.resize());
        },

        resize() {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = rect.width;
            this.canvas.height = rect.height;
        },

        clear() {
            if (!this.ctx) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        },

        drawArrow(from, to, color = '#00d47e', lineWidth = 4) {
            if (!this.ctx || !this.canvas.width || !this.canvas.height) return;
            
            const squareSize = this.canvas.width / 8;
            const files = 'abcdefgh';
            const ranks = '87654321';
            
            const fromFile = files.indexOf(from[0]);
            const fromRank = ranks.indexOf(from[1]);
            const toFile = files.indexOf(to[0]);
            const toRank = ranks.indexOf(to[1]);
            
            if (fromFile === -1 || fromRank === -1 || toFile === -1 || toRank === -1) return;
            
            const x1 = (fromFile + 0.5) * squareSize;
            const y1 = (fromRank + 0.5) * squareSize;
            const x2 = (toFile + 0.5) * squareSize;
            const y2 = (toRank + 0.5) * squareSize;
            
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLength = squareSize * 0.3;
            
            this.ctx.strokeStyle = color;
            this.ctx.fillStyle = color;
            this.ctx.lineWidth = lineWidth;
            this.ctx.lineCap = 'round';
            this.ctx.globalAlpha = 0.8;
            
            // Draw line
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
            
            // Draw arrowhead
            this.ctx.beginPath();
            this.ctx.moveTo(x2, y2);
            this.ctx.lineTo(
                x2 - headLength * Math.cos(angle - Math.PI / 6),
                y2 - headLength * Math.sin(angle - Math.PI / 6)
            );
            this.ctx.lineTo(
                x2 - headLength * Math.cos(angle + Math.PI / 6),
                y2 - headLength * Math.sin(angle + Math.PI / 6)
            );
            this.ctx.closePath();
            this.ctx.fill();
            
            this.ctx.globalAlpha = 1.0;
        },

        drawMultipleArrows(arrows) {
            this.clear();
            arrows.forEach((arrow, index) => {
                const color = LINE_COLORS[index] || LINE_COLORS[0];
                this.drawArrow(arrow.from, arrow.to, color);
            });
        }
    };

    /* ============================
     * UI Components
     * ============================ */
    const EvalBar = {
        update(cpWhite, mate) {
            const fill = document.getElementById('evalBarFill');
            const text = document.getElementById('evalScoreBoard');
            if (!fill || !text) return;

            let displayText = '+0.00';
            let percent = 50;

            if (mate !== null) {
                displayText = mate > 0 ? `M${mate}` : `M${Math.abs(mate)}`;
                percent = mate > 0 ? 100 : 0;
            } else {
                const pawns = cpWhite / 100;
                displayText = pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
                const clamped = Math.max(-500, Math.min(500, cpWhite));
                percent = 50 + (clamped / 10);
            }

            fill.style.width = `${percent}%`;
            fill.style.background = percent > 50 ? '#4caf50' : '#e74c3c';
            text.textContent = displayText;
        }
    };

    const MoveList = {
        render() {
            const container = document.getElementById('moveList');
            if (!container) return;
            container.innerHTML = '';

            for (let i = 1; i < State.history.length; i++) {
                const analysis = State.moveAnalyses[i - 1];
                const moveNum = Math.ceil(i / 2);
                const isWhite = i % 2 === 1;
                const san = Utils.san(State.history[i - 1], State.history[i]);

                const item = document.createElement('div');
                item.className = `move-item ${State.moveIndex === i ? 'active' : ''}`;
                item.onclick = () => UI.goToMove(i);

                const core = document.createElement('div');
                core.className = 'move-core';
                core.innerHTML = `
                    <span class="move-num">${moveNum}${isWhite ? '.' : '...'}</span>
                    <span>${san}</span>
                    ${analysis ? `<span class="${analysis.className}">${analysis.icon}</span>` : ''}
                `;

                if (analysis) {
                    const meta = document.createElement('div');
                    meta.className = 'move-meta';
                    meta.innerHTML = `
                        <span>CPL: ${analysis.cpl}</span>
                        <span class="${analysis.className}">${analysis.label}</span>
                    `;
                    item.appendChild(core);
                    item.appendChild(meta);
                } else {
                    item.appendChild(core);
                }

                container.appendChild(item);
            }
        }
    };

    const SummaryPanel = {
        render() {
            const panel = document.getElementById('gameSummaryPanel');
            if (!panel) return;

            if (!State.summary) {
                panel.innerHTML = '<div class="summary-placeholder">Insights will appear here after analysis.</div>';
                return;
            }

            const { white, black, moments, narrative } = State.summary;

            let html = '<div class="summary-title">Game Summary</div>';
            
            if (State.headers.Event || State.headers.Opening) {
                html += `<div class="summary-subtitle">${State.headers.Opening || State.headers.Event || 'Unknown Opening'}</div>`;
            }

            if (moments && moments.length > 0) {
                html += '<div class="key-moments">';
                moments.forEach(m => {
                    const typeClass = m.type === 'blunder' ? 'moment-blunder' : 
                                     m.type === 'mistake' ? 'moment-mistake' : 
                                     m.type === 'swing' ? 'moment-swing' : 'moment-info';
                    html += `<div class="moment-row ${typeClass}">${m.text}</div>`;
                });
                html += '</div>';
            }

            if (narrative) {
                html += `<div class="summary-narrative">${narrative}</div>`;
            }

            panel.innerHTML = html;

            // Update stats
            document.getElementById('whiteAccuracy').textContent = `${white.accuracy}%`;
            document.getElementById('whiteAcpl').textContent = white.acpl;
            document.getElementById('whiteRating').textContent = white.rating;
            document.getElementById('blackAccuracy').textContent = `${black.accuracy}%`;
            document.getElementById('blackAcpl').textContent = black.acpl;
            document.getElementById('blackRating').textContent = black.rating;
        }
    };

    const TopLinesPanel = {
        update() {
            const panel = document.getElementById('topLinesPanel');
            if (!panel) return;

            const fen = State.history[State.moveIndex];
            if (!fen) {
                panel.style.display = 'none';
                return;
            }

            const eval = EvalCache.best(Utils.fenKey(fen));
            if (!eval) {
                panel.style.display = 'none';
                return;
            }

            // Show panel if we have evaluation data
            panel.style.display = 'block';
            let html = '';
            
            // If we have multiPV lines, show them
            if (eval.multiPV && eval.multiPV.length > 0) {
                eval.multiPV.slice(0, 3).forEach((line, index) => {
                    const score = line.mate !== null 
                        ? `M${Math.abs(line.mate)}` 
                        : (line.cp / 100).toFixed(2);
                    const moves = line.moves ? line.moves.join(' ') : '';
                    const color = LINE_COLORS[index];
                    
                    html += `
                        <div class="top-line-row" data-line-index="${index}">
                            <div class="line-info">
                                <div class="line-score" style="color:${color};">${score}</div>
                                <div class="line-move">${moves}</div>
                            </div>
                            <button class="line-preview-btn" onclick="window.previewLine(${index})">Preview</button>
                        </div>
                    `;
                });
            } else {
                // Show just the best move from single-line evaluation
                const score = eval.mate !== null 
                    ? `M${Math.abs(eval.mate)}` 
                    : (eval.cpWhite / 100).toFixed(2);
                const bestMoveUci = eval.bestMove || '';
                let bestMoveSan = '';
                
                if (bestMoveUci && bestMoveUci.length >= 4) {
                    const temp = new Chess(fen);
                    const move = temp.move({
                        from: bestMoveUci.slice(0, 2),
                        to: bestMoveUci.slice(2, 4),
                        promotion: bestMoveUci[4]
                    });
                    if (move) bestMoveSan = move.san;
                }
                
                html = `
                    <div class="top-line-row">
                        <div class="line-info">
                            <div class="line-score" style="color:${LINE_COLORS[0]};">${score}</div>
                            <div class="line-move">${bestMoveSan || bestMoveUci}</div>
                        </div>
                    </div>
                `;
            }

            panel.innerHTML = html;
        }
    };

    const AnalysisDisplay = {
        update() {
            const display = document.getElementById('analysisDisplay');
            if (!display) return;

            if (State.moveIndex === 0) {
                display.innerHTML = '<div class="analysis-empty">Starting position</div>';
                return;
            }

            const analysis = State.moveAnalyses[State.moveIndex - 1];
            if (!analysis) {
                display.innerHTML = '<div class="analysis-empty">No analysis available</div>';
                return;
            }

            const moveNum = Math.ceil(State.moveIndex / 2);
            const isWhite = State.moveIndex % 2 === 1;
            const playedMove = Utils.san(State.history[State.moveIndex - 1], State.history[State.moveIndex]);

            // Get best move from previous position
            const prevFen = State.history[State.moveIndex - 1];
            const prevEval = EvalCache.best(Utils.fenKey(prevFen));
            let bestMoveSan = '';
            
            if (prevEval && prevEval.bestMove && prevEval.bestMove.length >= 4) {
                const temp = new Chess(prevFen);
                const move = temp.move({
                    from: prevEval.bestMove.slice(0, 2),
                    to: prevEval.bestMove.slice(2, 4),
                    promotion: prevEval.bestMove[4]
                });
                if (move) bestMoveSan = move.san;
            }

            let html = `
                <div class="analysis-header">
                    <span style="font-weight:bold;">${moveNum}${isWhite ? '.' : '...'} ${playedMove}</span>
                    <span class="analysis-badge ${analysis.className}">${analysis.label}</span>
                </div>
                <div class="analysis-row">CPL: <span class="analysis-score">${analysis.cpl}</span></div>
            `;

            if (bestMoveSan && analysis.cpl > 10) {
                html += `<div class="analysis-row">Best: <span class="analysis-score">${bestMoveSan}</span></div>`;
            }

            if (analysis.insight) {
                html += `<div class="insight-row">${analysis.insight}</div>`;
            }

            display.innerHTML = html;
        }
    };

    /* ============================
     * Board Management
     * ============================ */
    const UIBoard = {
        init() {
            State.board = Chessboard('board', {
                position: 'start',
                draggable: false,
                pieceTheme: function(piece) {
                    return 'https://assets-themes.chess.com/image/ejgfv/150/' + piece.toLowerCase() + '.png';
                }
            });
            window.addEventListener('resize', () => {
                State.board.resize();
                ArrowLayer.resize();
            });
        },
        update() {
            if (!State.board) return;
            const fen = State.history[State.moveIndex];
            if (fen) {
                State.board.position(fen);
                State.chess.load(fen);
                
                // Update eval bar
                const eval = EvalCache.best(Utils.fenKey(fen));
                if (eval) {
                    EvalBar.update(eval.cpWhite, eval.mate);
                }
                
                // Show best move arrow if we have analysis
                if (State.moveAnalyses.length > 0 && State.moveIndex > 0) {
                    const prevFen = State.history[State.moveIndex - 1];
                    const prevEval = EvalCache.best(Utils.fenKey(prevFen));
                    if (prevEval && prevEval.bestMove) {
                        this.showBestMoveArrow(prevEval);
                    } else {
                        ArrowLayer.clear();
                    }
                } else {
                    ArrowLayer.clear();
                }
            }
        },
        showBestMoveArrow(evaluation) {
            if (!evaluation.bestMove || evaluation.bestMove.length < 4) {
                ArrowLayer.clear();
                return;
            }
            const from = evaluation.bestMove.slice(0, 2);
            const to = evaluation.bestMove.slice(2, 4);
            ArrowLayer.clear();
            ArrowLayer.drawArrow(from, to, LINE_COLORS[0], 6);
        }
    };

    /* ============================
     * Main UI Controller
     * ============================ */
    const UI = {
        init() {
            UIBoard.init();
            ArrowLayer.init();
            
            document.getElementById('loadGameBtn').onclick = () => UI.loadGame();
            document.getElementById('clearBtn').onclick = () => UI.clearGame();
            document.getElementById('analyzeBtn').onclick = () => UI.analyzeGame();
            document.getElementById('chesscomBtn').onclick = () => UI.importChessCom();
            
            document.getElementById('firstBtn').onclick = () => UI.goToMove(0);
            document.getElementById('prevBtn').onclick = () => UI.goToMove(Math.max(0, State.moveIndex - 1));
            document.getElementById('nextBtn').onclick = () => UI.goToMove(Math.min(State.history.length - 1, State.moveIndex + 1));
            document.getElementById('lastBtn').onclick = () => UI.goToMove(State.history.length - 1);

            document.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') UI.goToMove(Math.max(0, State.moveIndex - 1));
                if (e.key === 'ArrowRight') UI.goToMove(Math.min(State.history.length - 1, State.moveIndex + 1));
            });
    },

    loadGame() {
            const pgnText = document.getElementById('pgnInput').value.trim();
            const fenText = document.getElementById('fenInput').value.trim();

            try {
                if (fenText) {
                    State.chess.load(fenText);
                    State.history = [fenText];
                    State.headers = {};
                } else if (pgnText) {
                    const { headers, body } = Utils.parsePgn(pgnText);
                    State.history = Utils.loadPgn(body);
                    State.headers = headers;
                } else {
                    UI.toast('Please enter PGN or FEN', 'error');
                return;
                }

                State.moveIndex = 0;
                State.moveAnalyses = [];
                State.summary = null;
                UIBoard.update();
                MoveList.render();
                SummaryPanel.render();
                AnalysisDisplay.update();
                UI.toast('Game loaded successfully', 'success');
            } catch (err) {
                UI.toast('Failed to load game: ' + err.message, 'error');
            }
    },

    clearGame() {
            State.chess.reset();
            State.history = [State.chess.fen()];
            State.moveIndex = 0;
            State.moveAnalyses = [];
            State.summary = null;
            State.headers = {};
        document.getElementById('pgnInput').value = '';
        document.getElementById('fenInput').value = '';
            UIBoard.update();
            MoveList.render();
            SummaryPanel.render();
            AnalysisDisplay.update();
    },

        goToMove(index) {
            // Clear any active preview
            if (State.previewTimeout) {
                clearTimeout(State.previewTimeout);
                State.previewTimeout = null;
            }
            if (State.preview) {
                State.preview = null;
                const badge = document.getElementById('previewBadge');
                if (badge) badge.style.display = 'none';
            }
            
            State.moveIndex = index;
            UIBoard.update();
            MoveList.render();
            AnalysisDisplay.update();
            TopLinesPanel.update();
        },

        async analyzeGame() {
            if (State.history.length <= 1) {
                UI.toast('Load a game first', 'error');
                return;
            }

            if (State.isAnalyzing) {
                State.analysisAbort?.abort();
                State.isAnalyzing = false;
                document.querySelector('#analyzeBtn .btn-text').textContent = 'Analyze';
                UI.hideLoading();
                return;
            }

            State.isAnalyzing = true;
            State.analysisAbort = new AbortController();
            document.querySelector('#analyzeBtn .btn-text').textContent = 'Stop';
            UI.showLoading('Analyzing game...');

            try {
                State.moveAnalyses = [];
                const totalMoves = State.history.length;
                
                for (let i = 0; i < totalMoves; i++) {
                    if (State.analysisAbort.signal.aborted) break;
                    
                    // Update progress
                    UI.showLoading(`Analyzing move ${i}/${totalMoves}...`);
                    
                    const fen = State.history[i];
                    const eval1 = await Engine.evaluate(fen, 1, State.analysisAbort.signal);
                    
                    if (i > 0) {
                        const prevFen = State.history[i - 1];
                        const prevEval = EvalCache.best(Utils.fenKey(prevFen));
                        
                        if (prevEval && eval1) {
                            // The player who MADE the move is the one whose turn it was BEFORE the move
                            const player = Utils.turnLabel(prevFen);
                            
                            // Get evaluations from the player's perspective
                            // before = position before the move (from player's perspective)
                            // after = position after the move (from player's perspective)
                            const before = Analysis.perspective(prevEval.cpWhite, prevEval.mate, player);
                            const after = Analysis.perspective(eval1.cpWhite, eval1.mate, player);
                            
                            // CPL = how much the position got worse for the player who moved
                            const cpl = Analysis.cpl(before, after);
                            const classification = Analysis.classify(cpl);
                            
                            State.moveAnalyses.push({
                                cpl,
                                ...classification,
                                insight: cpl > 100 ? 'Consider reviewing this move' : null
                            });
                        }
                    }
                    
                    // Yield to UI every 5 moves to prevent freezing
                    if (i % 5 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                        // Update move list progressively
                        MoveList.render();
                    }
                }

                // Calculate stats
                let whiteTotal = 0, blackTotal = 0, whiteCount = 0, blackCount = 0;
                State.moveAnalyses.forEach((analysis, idx) => {
                    if (idx % 2 === 0) {
                        whiteTotal += analysis.cpl;
                        whiteCount++;
                    } else {
                        blackTotal += analysis.cpl;
                        blackCount++;
                    }
                });

                const whiteAcpl = whiteCount ? Math.round(whiteTotal / whiteCount) : 0;
                const blackAcpl = blackCount ? Math.round(blackTotal / blackCount) : 0;

                State.stats = {
                    white: {
                        accuracy: Math.round(Analysis.accuracy(whiteAcpl)),
                        acpl: whiteAcpl,
                        rating: Analysis.rating(whiteAcpl)
                    },
                    black: {
                        accuracy: Math.round(Analysis.accuracy(blackAcpl)),
                        acpl: blackAcpl,
                        rating: Analysis.rating(blackAcpl)
                    }
                };

                // Generate summary
                const moments = State.moveAnalyses
                    .map((a, i) => ({ ...a, index: i }))
                    .filter(a => a.className === 'move-blunder' || a.className === 'move-mistake')
                    .slice(0, 5)
                    .map(a => ({
                        type: a.className === 'move-blunder' ? 'blunder' : 'mistake',
                        text: `Move ${Math.ceil((a.index + 1) / 2)}: ${a.label} (CPL: ${a.cpl})`
                    }));

                if (moments.length === 0) {
                    moments.push({ type: 'info', text: 'Clean game with no major mistakes!' });
                }

                State.summary = {
                    white: State.stats.white,
                    black: State.stats.black,
                    moments,
                    narrative: `Analysis complete. White ACPL: ${whiteAcpl}, Black ACPL: ${blackAcpl}.`
                };

                MoveList.render();
                SummaryPanel.render();
                AnalysisDisplay.update();
                TopLinesPanel.update();
                UI.toast('Analysis complete!', 'success');
            } catch (err) {
                if (err.name !== 'AbortError') {
                    UI.toast('Analysis failed: ' + err.message, 'error');
                }
            } finally {
                State.isAnalyzing = false;
                State.analysisAbort = null;
                document.querySelector('#analyzeBtn .btn-text').textContent = 'Analyze';
                UI.hideLoading();
            }
        },

        async importChessCom() {
            const { value: username } = await Swal.fire({
                title: 'Import from Chess.com',
                input: 'text',
                inputLabel: 'Enter your Chess.com username',
                inputPlaceholder: 'username',
                showCancelButton: true
            });

            if (!username) return;

            UI.showLoading('Fetching archives...');
            try {
                const response = await fetch(`https://api.chess.com/pub/player/${username}/games/archives`);
                if (!response.ok) throw new Error('Failed to fetch games');
                
                const data = await response.json();
                
                // Let user pick archive (month)
                const archiveOptions = data.archives.slice(-6).reverse().reduce((acc, url, i) => {
                    const match = url.match(/(\d{4})\/(\d{2})$/);
                    const label = match ? `${match[1]}-${match[2]}` : `Archive ${i + 1}`;
                    return { ...acc, [url]: label };
                }, {});

                UI.hideLoading();

                const { value: selectedArchive } = await Swal.fire({
                    title: 'Select month',
                    input: 'select',
                    inputOptions: archiveOptions,
                    showCancelButton: true
                });

                if (!selectedArchive) return;

                UI.showLoading('Fetching games...');
                const gamesResponse = await fetch(selectedArchive);
                const gamesData = await gamesResponse.json();
                
                // Group by time control
                const gamesByType = {};
                gamesData.games.forEach(g => {
                    const tc = g.time_class || 'unknown';
                    if (!gamesByType[tc]) gamesByType[tc] = [];
                    gamesByType[tc].push(g);
                });

                // Create game list with type labels
                const games = [];
                Object.keys(gamesByType).forEach(type => {
                    gamesByType[type].slice(-10).forEach((g, i) => {
                        const result = g.white.username === username 
                            ? (g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : '½-½')
                            : (g.black.result === 'win' ? '1-0' : g.white.result === 'win' ? '0-1' : '½-½');
                        games.push({
                            pgn: g.pgn,
                            label: `[${type}] ${g.white.username} vs ${g.black.username} (${result})`
                        });
                    });
                });

                UI.hideLoading();

                const { value: selectedIndex } = await Swal.fire({
                    title: 'Select a game',
                    input: 'select',
                    inputOptions: games.reduce((acc, g, i) => ({ ...acc, [i]: g.label }), {}),
                    showCancelButton: true
                });

                if (selectedIndex !== undefined) {
                    document.getElementById('pgnInput').value = games[selectedIndex].pgn;
                    UI.loadGame();
                }
            } catch (err) {
                UI.hideLoading();
                UI.toast('Failed to import: ' + err.message, 'error');
            }
        },

        showLoading(message) {
            let overlay = document.querySelector('.loading-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'loading-overlay';
                overlay.innerHTML = `
                    <div class="spinner"></div>
                    <div style="color:#fff;font-size:1.1rem;">${message}</div>
                `;
                document.body.appendChild(overlay);
            }
        },

        hideLoading() {
            const overlay = document.querySelector('.loading-overlay');
            if (overlay) overlay.remove();
        },

        toast(message, type = 'info') {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: type,
                title: message,
                showConfirmButton: false,
                timer: 3000
            });
        }
    };

    /* ============================
     * Global Functions (for inline handlers)
     * ============================ */
    window.previewLine = (lineIndex) => {
        // Clear any existing preview timeout
        if (State.previewTimeout) {
            clearTimeout(State.previewTimeout);
            State.previewTimeout = null;
        }

        const fen = State.history[State.moveIndex];
        if (!fen) return;

        const eval = EvalCache.best(Utils.fenKey(fen));
        if (!eval || !eval.multiPV || !eval.multiPV[lineIndex]) return;

        const line = eval.multiPV[lineIndex];
        if (!line.moves || line.moves.length === 0) return;

        // Convert SAN moves to arrows
        const arrows = [];
        const temp = new Chess(fen);
        
        for (let i = 0; i < Math.min(line.moves.length, 3); i++) {
            const move = line.moves[i];
            const legalMoves = temp.moves({ verbose: true });
            const found = legalMoves.find(m => m.san === move);
            
            if (found) {
                arrows.push({ from: found.from, to: found.to });
                temp.move(found);
            } else {
                break;
            }
        }

        if (arrows.length > 0) {
            State.preview = { arrows, moveIndex: State.moveIndex };
            ArrowLayer.drawMultipleArrows(arrows);
            const badge = document.getElementById('previewBadge');
            if (badge) {
                badge.textContent = `Preview: ${line.moves.slice(0, 3).join(' ')}`;
                badge.style.display = 'block';
            }
            
            State.previewTimeout = setTimeout(() => {
                // Only clear if we're still on the same move
                if (State.preview && State.preview.moveIndex === State.moveIndex) {
                    if (badge) badge.style.display = 'none';
                    State.preview = null;
                    ArrowLayer.clear();
                    UIBoard.update();
                }
                State.previewTimeout = null;
            }, 3000);
        }
    };

    /* ============================
     * Initialize on Load
     * ============================ */
    document.addEventListener('DOMContentLoaded', () => {
        UI.init();
    });
})();

