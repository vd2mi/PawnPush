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

        function save(fen, result, depth = ENGINE_CONFIG.DEPTH) {
            const key = `${Utils.fenKey(fen)}:${depth}`;
            store.set(key, result);
        }

        function best(fen, depth = ENGINE_CONFIG.DEPTH) {
            const key = `${Utils.fenKey(fen)}:${depth}`;
            return store.get(key) || null;
        }

        return { save, best };
    })();


    const ArrowLayer = {
        svg: null,
        defs: null,
        lastArrows: [],
        markerCache: new Map(),

        init() {
            this.svg = document.getElementById('board-arrows');
            if (!this.svg) return;
            this.defs = this.svg.querySelector('defs');
            if (!this.defs) {
                this.defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                this.svg.appendChild(this.defs);
            }
            window.addEventListener('resize', () => this.redraw());
        },

        squareCenter(square) {
            if (!this.svg || typeof square !== 'string' || square.length < 2) return { x: 0, y: 0 };
            const normalized = square.toLowerCase();
            const width = this.svg.clientWidth;
            const height = this.svg.clientHeight;
            if (!width || !height) return { x: 0, y: 0 };
            const squareWidth = width / 8;
            const squareHeight = height / 8;
            const file = normalized.charCodeAt(0) - 97;
            const rank = parseInt(normalized[1], 10) - 1;
            if (!Number.isFinite(file) || !Number.isFinite(rank)) return { x: 0, y: 0 };
            if (file < 0 || file > 7 || rank < 0 || rank > 7) return { x: 0, y: 0 };
            const orientation = State.board && typeof State.board.orientation === 'function'
                ? State.board.orientation()
                : 'white';
            const filePos = orientation === 'white' ? file : 7 - file;
            const rankPos = orientation === 'white' ? 7 - rank : rank;
            return {
                x: filePos * squareWidth + squareWidth / 2,
                y: rankPos * squareHeight + squareHeight / 2
            };
        },

        ensureMarker(color) {
            if (!this.defs || !color) return null;
            const key = color.replace(/[^a-z0-9]/gi, '') || 'default';
            const id = `arrowhead-${key}`;
            if (this.markerCache.has(id)) return id;
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', id);
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '10');
            marker.setAttribute('refX', '5');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'strokeWidth');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 6 3, 0 6');
            polygon.setAttribute('fill', color);
            marker.appendChild(polygon);
            this.defs.appendChild(marker);
            this.markerCache.set(id, true);
            return id;
        },

        removeRenderedLines() {
            if (!this.svg) return;
            this.svg.querySelectorAll('line').forEach(line => line.remove());
        },

        clear() {
            this.removeRenderedLines();
            this.lastArrows = [];
        },

        drawArrowElement(arrow) {
            if (!this.svg || !arrow?.from || !arrow?.to) return;
            const { color = '#00d47e', width = 8 } = arrow;
            const start = this.squareCenter(arrow.from);
            const end = this.squareCenter(arrow.to);
            if (!Number.isFinite(start.x) || !Number.isFinite(end.x)) return;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', start.x);
            line.setAttribute('y1', start.y);
            line.setAttribute('x2', end.x);
            line.setAttribute('y2', end.y);
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', width);
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('opacity', '0.85');

            const markerId = this.ensureMarker(color) || 'arrowhead';
            line.setAttribute('marker-end', `url(#${markerId})`);

            this.svg.appendChild(line);
        },

        applyArrows(arrows) {
            if (!this.svg) return;
            this.removeRenderedLines();
            this.lastArrows = arrows;
            arrows.forEach(arrow => this.drawArrowElement(arrow));
        },

        drawArrow(from, to, color = LINE_COLORS[0], width = 8) {
            if (!from || !to) {
                this.clear();
                return;
            }
            this.applyArrows([{ from, to, color, width }]);
        },

        drawMultipleArrows(arrows) {
            if (!arrows || arrows.length === 0) {
                this.clear();
                return;
            }
            const normalized = arrows.map((arrow, idx) => ({
                from: arrow.from,
                to: arrow.to,
                color: arrow.color || LINE_COLORS[idx] || LINE_COLORS[0],
                width: arrow.width || 8
            }));
            this.applyArrows(normalized);
        },

        redraw() {
            if (!this.lastArrows.length) {
                this.clear();
                return;
            }
            // Recalculate positions with current board state
            const updatedArrows = this.lastArrows.map(arrow => ({ ...arrow }));
            this.applyArrows(updatedArrows);
        }
    };

    const Charts = {
        accuracyChart: null,
        acplChart: null,

        displayOpeningName() {
            const display = document.getElementById('openingNameDisplay');
            const ecoEl = document.getElementById('openingEco');
            const nameEl = document.getElementById('openingName');
            
            if (State.summary?.openingInfo) {
                display.style.display = 'block';
                ecoEl.textContent = State.summary.openingInfo.eco || '';
                nameEl.textContent = State.summary.openingInfo.name || '';
            } else {
                display.style.display = 'none';
            }
        },

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
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#0f172a');
            gradient.addColorStop(1, '#1e293b');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            const whiteData = [];
            const blackData = [];
            let whiteSum = 0, blackSum = 0;
            let whiteCount = 0, blackCount = 0;

            State.moveAnalyses.forEach((move, idx) => {
                const cpLoss = move.cpLoss ?? 0;
                if (idx % 2 === 0) {
                    whiteSum += cpLoss;
                    whiteCount++;
                    const acpl = whiteSum / whiteCount;
                    const acc = Math.round(100 - (100 * Math.pow(acpl / 130, 0.65)));
                    whiteData.push(acc);
                } else {
                    blackSum += cpLoss;
                    blackCount++;
                    const acpl = blackSum / blackCount;
                    const acc = Math.round(100 - (100 * Math.pow(acpl / 130, 0.65)));
                    blackData.push(acc);
                }
            });

            const maxMoves = Math.max(whiteData.length, blackData.length);
            const stepX = width / maxMoves;

            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 2;
            ctx.beginPath();
            whiteData.forEach((acc, idx) => {
                const x = idx * stepX;
                const y = height - (acc / 100) * height;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            blackData.forEach((acc, idx) => {
                const x = idx * stepX;
                const y = height - (acc / 100) * height;
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();

            ctx.fillStyle = '#e2e8f0';
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
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#0f172a');
            gradient.addColorStop(1, '#1e293b');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            const barWidth = width / State.moveAnalyses.length;
            const maxCpl = Math.max(...State.moveAnalyses.map(m => m.cpLoss ?? 0), 100);

            State.moveAnalyses.forEach((move, idx) => {
                const cpLoss = move.cpLoss ?? 0;
                const x = idx * barWidth;
                const barHeight = (cpLoss / maxCpl) * height;
                const y = height - barHeight;

                let color = '#4caf50';
                if (cpLoss > 200) color = '#e74c3c';
                else if (cpLoss > 80) color = '#f39c12';
                else if (cpLoss > 40) color = '#f1c40f';

                ctx.fillStyle = color;
                ctx.fillRect(x, y, barWidth - 1, barHeight);
            });
        }
    };

    const EvalBar = {
        lastMate: null,

        update(cpWhite, mate) {
            const fill = document.getElementById('evalBarFill');
            const text = document.getElementById('evalScoreBoard');
            if (!fill || !text) return;

            let displayText = '+0.00';
            let percent = 50;
            const previousMate = this.lastMate;

            if (mate !== null) {
                displayText = mate > 0 ? `M${mate}` : `M${Math.abs(mate)}`;
                percent = mate > 0 ? 100 : 0;
            } else {
                const pawns = cpWhite / 100;
                displayText = pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
                const clamped = Math.max(-500, Math.min(500, cpWhite));
                percent = 50 + (clamped / 10);
            }

            if (previousMate !== null && mate !== null) {
                percent = mate > 0 ? 100 : 0;
            }

            this.lastMate = mate;

            fill.style.width = `${percent}%`;
            if (percent > 50) {
                const whiteIntensity = Math.min(100, (percent - 50) * 2);
                fill.style.background = `linear-gradient(90deg, #666666 0%, #ffffff ${whiteIntensity}%)`;
                text.style.color = whiteIntensity > 60 ? '#000' : '#fff';
            } else {
                const blackIntensity = 100 - Math.max(0, percent * 2);
                fill.style.background = `linear-gradient(90deg, #000000 ${blackIntensity}%, #666666 100%)`;
                text.style.color = blackIntensity > 60 ? '#fff' : '#000';
            }
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
                const san = analysis?.san || Utils.san(State.history[i - 1], State.history[i]);

                const item = document.createElement('div');
                item.className = `move-item ${State.moveIndex === i ? 'active' : ''}`;
                item.onclick = () => UI.goToMove(i);

                let badges = '';
                if (analysis) {
                    if (analysis.isBrilliant) badges += '<span class="badge brilliant">⚡ Brilliant!</span>';
                    else if (analysis.isGreat) badges += '<span class="badge great">⭐ Great!</span>';
                    else if (analysis.isOnlyMove) badges += '<span class="badge only">Only Move</span>';
                }

                const hasOpeningInfo = State.summary?.openingInfo && i < 20;
                const isBookMove = (analysis?.opening || (hasOpeningInfo && (analysis?.cpLoss === undefined || analysis?.cpLoss === 0)));
                const displayLabel = isBookMove ? 'Book' : (analysis?.label || '');
                const displayCategory = isBookMove ? 'move-book' : (analysis?.category || '');
                
                const core = document.createElement('div');
                core.className = 'move-core';
                core.innerHTML = `
                    <span class="move-num">${moveNum}${isWhite ? '.' : '...'}</span>
                    <span>${san}</span>
                    ${analysis ? `<span class="${displayCategory}">${displayLabel}</span>` : ''}
                    ${badges}
                `;

                if (analysis) {
                    const meta = document.createElement('div');
                    meta.className = 'move-meta';
                    
                    const bestSan = analysis.bestSan || '';
                    const motifs = analysis.motifs?.join(', ') || '';
                    const hasOpeningInfo = State.summary?.openingInfo && i < 20;
                    const isBookMove = (analysis.opening || (hasOpeningInfo && (analysis.cpLoss === undefined || analysis.cpLoss === 0)));
                    
                    meta.innerHTML = `
                        ${isBookMove ? '<span style="color:#10b981;">📖 Book Move</span>' : `<span>CPL: ${analysis.cpLoss ?? 0}</span>`}
                        ${bestSan && analysis.cpLoss > 15 && !isBookMove ? `<span>Best: ${bestSan}</span>` : ''}
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

            const { white, black, moments, narrative, opening, middlegame, endgame, brilliants, blunders, swings, openingInfo } = State.summary;

            let html = '<div class="summary-title">Game Summary</div>';
            
            if (openingInfo) {
                html += `<div class="summary-subtitle">${openingInfo.eco}: ${openingInfo.name}</div>`;
            } else if (State.headers.Event || State.headers.Opening) {
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

            const evaluation = EvalCache.best(fen, ENGINE_CONFIG.DEPTH);
            if (!evaluation || !evaluation.pvs || evaluation.pvs.length === 0) {
                panel.style.display = 'none';
                return;
            }

            panel.style.display = 'block';
            const lines = evaluation.pvs
                .filter(pv => Array.isArray(pv.uci) && pv.uci.length > 0)
                .slice(0, 3);

            if (lines.length === 0) {
                panel.innerHTML = '<div class="top-line-row empty">Engine did not return principal variations for this move.</div>';
                return;
            }

            let html = '';
            
            lines.forEach((pv, index) => {
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

            const hasOpeningInfo = State.summary?.openingInfo && State.moveIndex < 20;
            const isBookMove = (analysis.opening || (hasOpeningInfo && (analysis.cpLoss === undefined || analysis.cpLoss === 0)));
            const displayLabel = isBookMove ? 'Book Move' : analysis.label;
            const displayCategory = isBookMove ? 'move-book' : analysis.category;
            
            let html = `<div class="analysis-header"><span style="font-weight:bold;">${moveNum}${isWhite ? '.' : '...'} ${playedMove}</span><span class="analysis-badge ${displayCategory}">${displayLabel}</span>${badges}</div>${isBookMove ? '<div class="analysis-row">📖 <span style="color:#10b981;">Book Move</span></div>' : `<div class="analysis-row">CPL: <span class="analysis-score">${analysis.cpLoss ?? 0}</span></div>`}<div class="analysis-row">Trend: <span>${analysis.engineTrend}</span></div>`;

            if (bestSan && analysis.cpLoss > 15) {
                html += `<div class="analysis-row">Best: <span class="analysis-score">${bestSan}</span></div>`;
            }
            if (secondBestSan && analysis.cpLoss > 15) {
                html += `<div class="analysis-row">2nd Best: <span class="analysis-score">${secondBestSan}</span></div>`;
            }

            if (analysis.motifs && analysis.motifs.length > 0) {
                html += `<div class="analysis-row">Motifs: <span>${analysis.motifs.join(', ')}</span></div>`;
            }

            if (analysis.opening) {
                html += `<div class="analysis-row">Opening: <span style="color:#10b981;">${analysis.opening.eco} - ${analysis.opening.name}</span></div>`;
            } else if (State.summary?.openingInfo && State.moveIndex < 20) {
                html += `<div class="analysis-row">Opening: <span style="color:#10b981;">${State.summary.openingInfo.eco} - ${State.summary.openingInfo.name}</span></div>`;
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
                ArrowLayer.redraw();
            });
        },
        update() {
            if (!State.board) return;
            const fen = State.history[State.moveIndex];
            if (fen) {
                State.board.position(fen);
                State.chess.load(fen);
                
                const evaluation = EvalCache.best(fen, ENGINE_CONFIG.DEPTH);
                if (evaluation) {
                    EvalBar.update(evaluation.cpWhite, evaluation.mate);
                    this.showBestMoveArrow(evaluation);
                } else {
                    ArrowLayer.clear();
                }
            }
        },
        showBestMoveArrow(evaluation) {
            if (!evaluation.pvs || evaluation.pvs.length === 0) {
                ArrowLayer.clear();
                return;
            }
            
            const arrows = evaluation.pvs
                .filter(pv => pv.uci && pv.uci.length > 0 && pv.uci[0].length >= 4)
                .slice(0, 3)
                .map((pv, index) => ({
                    from: pv.uci[0].slice(0, 2),
                    to: pv.uci[0].slice(2, 4),
                    color: LINE_COLORS[index],
                    width: 6 - index
                }));
            
            if (arrows.length > 0) {
                ArrowLayer.drawMultipleArrows(arrows);
            } else {
                ArrowLayer.clear();
            }
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
            document.getElementById('analyzePositionBtn').onclick = () => UI.analyzePosition();
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
                    data.evaluations.forEach((evaluation, idx) => {
                        if (evaluation && State.history[idx]) {
                            EvalCache.save(State.history[idx], evaluation, ENGINE_CONFIG.DEPTH);
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
                Charts.initAccuracyChart();
                Charts.initAcplChart();
                Charts.displayOpeningName();
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

        async analyzePosition() {
            const fenText = document.getElementById('fenInput').value.trim();

            // Prefer a freshly typed FEN; otherwise analyse the position on the board.
            if (fenText) {
                if (!State.scratch.load(fenText)) {
                    UI.toast('Invalid FEN', 'error');
                    return;
                }
                State.chess.load(fenText);
                State.history = [fenText];
                State.headers = {};
                State.moveIndex = 0;
                State.moveAnalyses = [];
                State.summary = null;
                UIBoard.update();
                MoveList.render();
                SummaryPanel.render();
                AnalysisDisplay.update();
            }

            const fen = State.history[State.moveIndex];
            if (!fen) {
                UI.toast('Enter a FEN or load a game first', 'error');
                return;
            }

            UI.showLoading('Analysing position...');
            try {
                const res = await fetch('/api/stockfish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fen,
                        depth: ENGINE_CONFIG.DEPTH,
                        multipv: ENGINE_CONFIG.MULTIPV
                    })
                });

                if (!res.ok) throw new Error('Analysis failed');
                const evaluation = await res.json();

                if (!evaluation || evaluation.cpWhite === undefined) {
                    UI.toast('No evaluation returned', 'error');
                    return;
                }

                EvalCache.save(fen, evaluation, ENGINE_CONFIG.DEPTH);
                EvalBar.update(evaluation.cpWhite, evaluation.mate);
                UIBoard.showBestMoveArrow(evaluation);
                TopLinesPanel.update();
                UI.toast('Position analysed', 'success');
            } catch (err) {
                UI.toast('Analysis failed: ' + err.message, 'error');
            } finally {
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

        const evaluation = EvalCache.best(fen);
        if (!evaluation || !evaluation.pvs || !evaluation.pvs[lineIndex]) return;

        const pv = evaluation.pvs[lineIndex];
        const pvSan = Array.isArray(pv.san) ? pv.san : [];
        const pvUci = Array.isArray(pv.uci) ? pv.uci : [];
        if (pvSan.length === 0 && pvUci.length === 0) return;
        if (pv.dummy) return;

        const arrows = [];
        const temp = new Chess(fen);

        for (let i = 0; i < ENGINE_CONFIG.PREVIEW_MAX_PLIES; i++) {
            if (!pvSan[i] && !pvUci[i]) break;

            let moveObj = null;
            const uciToken = pvUci[i];
            if (uciToken && uciToken.length >= 4 && uciToken.length <= 5) {
                const from = uciToken.slice(0, 2);
                const to = uciToken.slice(2, 4);
                const promo = uciToken.length === 5 ? uciToken[4].toLowerCase() : undefined;
                // Validate UCI format
                if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uciToken)) {
                    try {
                        moveObj = temp.move({
                            from, to, promotion: promo
                        });
                    } catch {
                        moveObj = null;
                    }
                }
            }

            if (!moveObj && pvSan[i]) {
                try {
                    moveObj = temp.move(pvSan[i], { sloppy: true });
                } catch {
                    moveObj = null;
                }
            }

            if (!moveObj) break;

            arrows.push({ from: moveObj.from, to: moveObj.to });
        }

        if (arrows.length > 0) {
            State.preview = { arrows, moveIndex: State.moveIndex };
            ArrowLayer.drawMultipleArrows(arrows);
            const badge = document.getElementById('previewBadge');
            if (badge) {
                const badgeMoves = pvSan.length ? pvSan : pvUci;
                badge.textContent = `Preview: ${badgeMoves.slice(0, 3).join(' ')}`;
                badge.style.display = 'block';
            }

            State.previewTimeout = setTimeout(() => {
                if (State.preview && State.preview.moveIndex === State.moveIndex) {
                    if (badge) badge.style.display = 'none';
                    State.preview = null;
                    ArrowLayer.clear();
                    // Redraw best move arrow if we should
                    if (State.moveIndex > 0) {
                        const prevFen = State.history[State.moveIndex - 1];
                        const prevEval = EvalCache.best(prevFen, ENGINE_CONFIG.DEPTH);
                        if (prevEval) {
                            UIBoard.showBestMoveArrow(prevEval);
                        }
                    }
                }
                State.previewTimeout = null;
            }, 3000);
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        UI.init();
    });
})();
