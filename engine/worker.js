// engine/worker.js
importScripts('/engine/stockfish.js');

let engine = null;
let isReady = false;
const pendingCommands = [];

console.log('Worker: Starting...');

async function init() {
    try {
        console.log('Worker: Initializing Stockfish...');
        
        // Stockfish is now a global function from importScripts
        engine = await Stockfish({
            locateFile: (path) => {
                if (path.endsWith('.wasm')) return '/engine/stockfish.wasm';
                return path;
            },
            print: (line) => {
                postMessage(line);
                
                if (!isReady && line.includes('uciok')) {
                    isReady = true;
                    postMessage('worker_ready');
                }
            },
            printErr: (line) => {
                console.warn('Stockfish stderr:', line);
            }
        });

        console.log('Worker: Stockfish initialized');
        
        // IMPORTANT: Initialize UCI inside worker
        if (engine.postMessage) {
            engine.postMessage("uci");
        } else if (typeof engine === 'function') {
            engine("uci");
        }

        // Process any commands that came in while initializing
        while (pendingCommands.length > 0) {
            const cmd = pendingCommands.shift();
            processCommand(cmd);
        }
        
    } catch (error) {
        console.error('Worker: Stockfish initialization failed', error);
    }
}

function processCommand(data) {
    if (engine) {
        if (engine.postMessage) {
            engine.postMessage(data);
        } else if (typeof engine === 'function') {
            engine(data);
        }
    }
}

init();

onmessage = (e) => {
    if (!isReady) {
        pendingCommands.push(e.data);
    } else {
        processCommand(e.data);
    }
};