(() => {
    const ENGINE_CONFIG = {
        DEPTH: 18,
        MULTIPV: 3,
        TIMEOUT: 20000,
        PREVIEW_MAX_PLIES: 8,
        MAX_PARALLEL_REQUESTS: 1,
        BATCH_SIZE: 4
    };

    const LINE_COLORS = ['#00d47e', '#3b82f6', '#a855f7', '#f97316', '#ec4899'];

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
        evaluations: new Map(),
        isAnalyzing: false,
        analysisAbort: null,
        accuracyHistory: { white: [], black: [] }
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

    const Utils = {
        fenKey(fen) {
            return fen;
        },
        turn(fen) {
            return fen.split(' ')[1] || 'w';
        },
        turnLabel(fen) {
            return Utils.turn(fen) === 'w' ? 'White' : 'Black';
        },
        parsePgn(text) {
            const headers = {};
            text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, key, value) => {
                headers[key] = value;
                return '';
            });
            
            let body = text.replace(/\[.*?\]\s*/g, '');
            body = body
                .replace(/\{[^}]*\}/g, ' ')
                .replace(/\([^)]*\)/g, ' ')
                .replace(/\$[0-9]+/g, ' ')
                .replace(/;[^\n]*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            return { headers, body };
        },
        loadPgn(body) {
            const temp = new Chess();
            let success = false;
            try {
                success = temp.load_pgn(body, { sloppy: true });
            } catch (e) {
                success = false;
            }
            
            if (!success) {
                temp.reset();
                const tokens = body.trim().split(/\s+/);
                for (const token of tokens) {
                    if (!token) continue;
                    if (/^\d+\.+$/.test(token)) continue;
                    if (['1-0', '0-1', '1/2-1/2', '*'].includes(token)) continue;
                    try {
                        temp.move(token, { sloppy: true });
                    } catch (e) {}
                }
                if (temp.history().length === 0) {
                    throw new Error('Unable to parse PGN - no valid moves found.');
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
        }
    };

    const EvalCache = (() => {
        const store = new Map();

        function save(fen, result) {
            const key = Utils.fenKey(fen);
            store.set(key, result);
        }

        function best(fen) {
            const key = Utils.fenKey(fen);
            return store.get(key) || null;
        }

        return { save, best };
    })();


    const ArrowLayer = {
        canvas: null,
        ctx: null,

        init() {
            this.canvas = document.getElementById('arrowLayer');
            if (!this.canvas) return;
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
            
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
            
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

    const Charts = {
        accuracyChart: null,
        acplChart: null,

        initAccuracyChart() {
            const canvas = document.getElementById('accuracyChart');
            if (!canvas) return;
            this.accuracyChart = canvas.getContext('2d');
            this.drawAccuracyChart();
        },

        initAcplChart() {
            const canvas = document.getElementById('acplChart');
            if (!canvas) return;
            this.acplChart = canvas.getContext('2d');
            this.drawAcplChart();
        },

        drawAccuracyChart() {
            if (!this.accuracyChart || State.moveAnalyses.length === 0) return;

            const canvas = this.accuracyChart.canvas;
            const width = canvas.width = canvas.offsetWidth;
            const height = canvas.height = 200;
            const ctx = this.accuracyChart;

            ctx.clearRect(0, 0, width, height);

            const whiteData = [];
            const blackData = [];
            let whiteSum = 0, blackSum = 0;
            let whiteCount = 0, blackCount = 0;

            State.moveAnalyses.forEach((move, idx) => {
                if (idx % 2 === 0) {
                    whiteSum += move.cpLoss;
                    whiteCount++;
                    const acpl = whiteSum / whiteCount;
                    const acc = Math.round(100 - (100 * Math.pow(acpl / 130, 0.65)));
                    whiteData.push(acc);
                } else {
                    blackSum += move.cpLoss;
                    blackCount++;
                    const acpl = blackSum / blackCount;
                    const acc = Math.round(100 - (100 * Math.pow(acpl / 130, 0.65)));
                    blackData.push(acc);
                }
            });

            const maxMoves = Math.max(whiteData.length, blackData.length);
            const stepX = width / maxMoves;

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            whiteData.forEach((acc, idx) => {
                const x = idx * stepX;
                const y = height - (acc / 100) * height;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            blackData.forEach((acc, idx) => {
                const x = idx * stepX;
                const y = height - (acc / 100) * height;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ctx.fillStyle = '#999';
            ctx.font = '12px Arial';
            ctx.fillText('White', 10, 20);
            ctx.fillText('Black', 10, 40);
        },

        drawAcplChart() {
            if (!this.acplChart || State.moveAnalyses.length === 0) return;

            const canvas = this.acplChart.canvas;
            const width = canvas.width = canvas.offsetWidth;
            const height = canvas.height = 200;
            const ctx = this.acplChart;

            ctx.clearRect(0, 0, width, height);

            const barWidth = width / State.moveAnalyses.length;
            const maxCpl = Math.max(...State.moveAnalyses.map(m => m.cpLoss), 100);

            State.moveAnalyses.forEach((move, idx) => {
                const x = idx * barWidth;
                const barHeight = (move.cpLoss / maxCpl) * height;
                const y = height - barHeight;

                let color = '#4caf50';
                if (move.cpLoss > 200) color = '#e74c3c';
                else if (move.cpLoss > 80) color = '#f39c12';
                else if (move.cpLoss > 40) color = '#f1c40f';

                ctx.fillStyle = color;
                ctx.fillRect(x, y, barWidth - 1, barHeight);
            });
        }
    };

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

                let badges = '';
                if (analysis) {
                    if (analysis.isBrilliant) badges += '<span class="badge brilliant">⚡ Brilliant!</span>';
                    else if (analysis.isGreat) badges += '<span class="badge great">⭐ Great!</span>';
                    else if (analysis.isOnlyMove) badges += '<span class="badge only">Only Move</span>';
                }

                const core = document.createElement('div');
                core.className = 'move-core';
                core.innerHTML = `
                    <span class="move-num">${moveNum}${isWhite ? '.' : '...'}</span>
                    <span>${san}</span>
                    ${analysis ? `<span class="${analysis.category}">${analysis.label}</span>` : ''}
                    ${badges}
                `;

                if (analysis) {
                    const meta = document.createElement('div');
                    meta.className = 'move-meta';
                    
                    const bestSan = analysis.bestSan || '';
                    const motifs = analysis.motifs?.join(', ') || '';
                    
                    meta.innerHTML = `
                        <span>CPL: ${analysis.cpLoss}</span>
                        ${bestSan && analysis.cpLoss > 15 ? `<span>Best: ${bestSan}</span>` : ''}
                        ${motifs ? `<span class="motifs">${motifs}</span>` : ''}
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

            const { white, black, moments, narrative, opening, middlegame, endgame, brilliants, blunders, swings } = State.summary;

            let html = '<div class="summary-title">Game Summary</div>';
            
            if (State.headers.Event || State.headers.Opening) {
                html += `<div class="summary-subtitle">${State.headers.Opening || State.headers.Event || 'Unknown Opening'}</div>`;
            }

            html += `<div class="phase-summary">
                <div><strong>Opening:</strong> ${opening}</div>
                <div><strong>Middlegame:</strong> ${middlegame}</div>
                <div><strong>Endgame:</strong> ${endgame}</div>
            </div>`;

            html += `<div class="stats-summary">
                <div>⚡ Brilliant Moves: ${brilliants}</div>
                <div>?? Blunders: ${blunders}</div>
                <div>🔄 Swings: ${swings}</div>
            </div>`;

            if (moments && moments.length > 0) {
                html += '<div class="key-moments">';
                moments.slice(0, 10).forEach(m => {
                    const typeClass = m.type === 'blunder' ? 'moment-blunder' : 
                                     m.type === 'mistake' ? 'moment-mistake' : 
                                     m.type === 'swing' ? 'moment-swing' : 
                                     m.type === 'brilliant' ? 'moment-brilliant' :
                                     m.type === 'great' ? 'moment-great' : 'moment-info';
                    html += `<div class="moment-row ${typeClass}">${m.text}</div>`;
                });
                html += '</div>';
            }

            if (narrative) {
                html += `<div class="summary-narrative">${narrative}</div>`;
            }

            panel.innerHTML = html;

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

            const eval = EvalCache.best(fen);
            if (!eval || !eval.pvs || eval.pvs.length === 0) {
                panel.style.display = 'none';
                return;
            }

            panel.style.display = 'block';
            let html = '';
            
            eval.pvs.slice(0, 3).forEach((pv, index) => {
                const score = pv.mate !== null 
                    ? `M${Math.abs(pv.mate)}` 
                    : ((pv.cp || 0) / 100).toFixed(2);
                const moves = pv.san ? pv.san.slice(0, 6).join(' ') : '';
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

            const bestSan = analysis.bestSan || '';
            const secondBestSan = analysis.secondBestSan || '';

            let badges = '';
            if (analysis.isBrilliant) badges += '<span class="badge brilliant">⚡ Brilliant!</span>';
            else if (analysis.isGreat) badges += '<span class="badge great">⭐ Great!</span>';
            else if (analysis.isOnlyMove) badges += '<span class="badge only">Only Move</span>';

            let html = `
                <div class="analysis-header">
                    <span style="font-weight:bold;">${moveNum}${isWhite ? '.' : '...'} ${playedMove}</span>
                    <span class="analysis-badge ${analysis.category}">${analysis.label}</span>
                    ${badges}
                </div>
                <div class="analysis-row">CPL: <span class="analysis-score">${analysis.cpLoss}</span></div>
                <div class="analysis-row">Trend: <span>${analysis.engineTrend}</span></div>
            `;

            if (bestSan && analysis.cpLoss > 15) {
                html += `<div class="analysis-row">Best: <span class="analysis-score">${bestSan}</span></div>`;
            }
            if (secondBestSan && analysis.cpLoss > 15) {
                html += `<div class="analysis-row">2nd Best: <span class="analysis-score">${secondBestSan}</span></div>`;
            }

            if (analysis.motifs && analysis.motifs.length > 0) {
                html += `<div class="analysis-row">Motifs: <span>${analysis.motifs.join(', ')}</span></div>`;
            }

            if (analysis.brilliantReason) {
                html += `<div class="insight-row">${analysis.brilliantReason}</div>`;
            }

            display.innerHTML = html;
        }
    };

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
                
                const eval = EvalCache.best(fen);
                if (eval) {
                    EvalBar.update(eval.cpWhite, eval.mate);
                }
                
                if (State.moveAnalyses.length > 0 && State.moveIndex > 0) {
                    const prevFen = State.history[State.moveIndex - 1];
                    const prevEval = EvalCache.best(prevFen);
                    if (prevEval && prevEval.bestMove && prevEval.bestMove.length >= 4) {
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

    const UI = {
        init() {
            UIBoard.init();
            ArrowLayer.init();
            Charts.initAccuracyChart();
            Charts.initAcplChart();
            
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
                State.evaluations.clear();

                const res = await fetch('/api/analyzePosition', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fens: State.history,
                        depth: ENGINE_CONFIG.DEPTH,
                        multipv: ENGINE_CONFIG.MULTIPV
                    }),
                    signal: State.analysisAbort.signal
                });

                if (!res.ok) throw new Error('Analysis failed');
                const data = await res.json();

                if (data.evaluations && Array.isArray(data.evaluations)) {
                    data.evaluations.forEach((eval, idx) => {
                        if (eval && State.history[idx]) {
                            EvalCache.save(State.history[idx], eval);
                        }
                    });
                }

                State.moveAnalyses = data.moves || [];
                State.summary = data.summary || null;
                State.stats = {
                    white: data.summary?.white || { accuracy: 0, acpl: 0, rating: 0 },
                    black: data.summary?.black || { accuracy: 0, acpl: 0, rating: 0 }
                };

                MoveList.render();
                SummaryPanel.render();
                AnalysisDisplay.update();
                TopLinesPanel.update();
                Charts.drawAccuracyChart();
                Charts.drawAcplChart();
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
                
                const gamesByType = {};
                gamesData.games.forEach(g => {
                    const tc = g.time_class || 'unknown';
                    if (!gamesByType[tc]) gamesByType[tc] = [];
                    gamesByType[tc].push(g);
                });

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
            } else {
                overlay.querySelector('div:last-child').textContent = message;
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

    window.previewLine = (lineIndex) => {
        if (State.previewTimeout) {
            clearTimeout(State.previewTimeout);
            State.previewTimeout = null;
        }

        const fen = State.history[State.moveIndex];
        if (!fen) return;

        const eval = EvalCache.best(fen);
        if (!eval || !eval.pvs || !eval.pvs[lineIndex]) return;

        const pv = eval.pvs[lineIndex];
        if (!pv.san || pv.san.length === 0) return;

        const arrows = [];
        const temp = new Chess(fen);

        for (let i = 0; i < Math.min(pv.san.length, ENGINE_CONFIG.PREVIEW_MAX_PLIES); i++) {
            const move = pv.san[i];
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
                badge.textContent = `Preview: ${pv.san.slice(0, 3).join(' ')}`;
                badge.style.display = 'block';
            }

            State.previewTimeout = setTimeout(() => {
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

    document.addEventListener('DOMContentLoaded', () => {
        UI.init();
    });
})();
