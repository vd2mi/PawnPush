// engine/stockfish-local.js
// Main-thread Stockfish WASM loader (no workers, no threads)

let sf = null;
let sfReady = false;
let callbacks = [];
let messageHandlers = [];

export async function loadStockfish() {
    if (sf) return sf;

    return new Promise((resolve, reject) => {
        try {
            const instance = Stockfish({
                locateFile: (path) => {
                    if (path.endsWith(".wasm")) return "/engine/stockfish.wasm";
                    return "/engine/" + path;
                },
                print: (line) => {
                    messageHandlers.forEach(cb => cb(line));

                    if (!sfReady && line.includes("uciok")) {
                        sfReady = true;
                        callbacks.forEach(c => c());
                        callbacks = [];
                    }
                },
                printErr: (line) => console.warn("SF ERR:", line)
            });

            sf = instance;

            // Send UCI command immediately
            sendToEngine("uci");

            resolve(sf);
        } catch (err) {
            reject(err);
        }
    });
}

// Register handler for engine output
export function onEngineMessage(cb) {
    messageHandlers.push(cb);
}

// Send command to Stockfish
export function sendToEngine(cmd) {
    if (!sf) return console.warn("Engine not loaded yet:", cmd);

    if (sf.postMessage) sf.postMessage(cmd);
    else sf(cmd);
}

// Wait until engine is fully ready
export function waitUntilReady() {
    return new Promise((resolve) => {
        if (sfReady) resolve();
        else callbacks.push(resolve);
    });
}

// Analyze a FEN
export async function analyze(fen, depth = 16) {
    await loadStockfish();
    await waitUntilReady();

    return new Promise((resolve) => {
        const result = { eval: null, bestmove: null, pv: [] };

        const handler = (line) => {
            if (line.startsWith("info")) {
                const parts = line.split(" ");
                const scoreIndex = parts.indexOf("score");
                if (scoreIndex !== -1) {
                    const type = parts[scoreIndex + 1];
                    const value = parseInt(parts[scoreIndex + 2]);
                    result.eval = { type, value };
                }
                const pvIndex = parts.indexOf("pv");
                if (pvIndex !== -1) {
                    result.pv = parts.slice(pvIndex + 1);
                }
            }

            if (line.startsWith("bestmove")) {
                result.bestmove = line.split(" ")[1];
                messageHandlers = messageHandlers.filter(h => h !== handler);
                resolve(result);
            }
        };

        onEngineMessage(handler);

        sendToEngine("stop");
        sendToEngine(`position fen ${fen}`);
        sendToEngine(`go depth ${depth}`);
    });
}

console.log("Stockfish local module loaded");
