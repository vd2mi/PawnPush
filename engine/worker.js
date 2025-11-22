import Stockfish from './stockfish.js';

let engine = null;

async function init() {
    try {
        console.log('Worker: Initializing Stockfish...');
        engine = await Stockfish({
            locateFile: (path) => {
                if (path.endsWith('.wasm')) return '/engine/stockfish.wasm';
                return path;
            },
            print: (line) => {
                // Forward standard output as messages
                postMessage(line);
            },
            printErr: (line) => {
                console.warn('Stockfish stderr:', line);
            }
        });

        console.log('Worker: Stockfish initialized');
        
        // Some versions of stockfish.js don't use addMessageListener but expect a callback or rely on print
        // We already hooked print above. Let's check if addMessageListener exists just in case.
        if (engine.addMessageListener) {
            engine.addMessageListener((line) => {
                postMessage(line);
            });
        }

        // IMPORTANT: Emscripten might not await the runtime init if not structured specifically.
        // If engine is just the module object, we might need to check if it's ready.
        
        postMessage('worker_ready');
    } catch (error) {
        console.error('Worker: Stockfish initialization failed', error);
    }
}

init();

onmessage = (e) => {
    if (!engine) {
        console.warn('Worker: Engine not ready, received command:', e.data);
        return;
    }
    
    // console.log('Worker sending to engine:', e.data);
    if (engine.postMessage) {
        engine.postMessage(e.data);
    } else if (engine.uci) {
        // Fallback for some emscripten ports
        engine.uci(e.data); 
    } else if (typeof engine === 'function') {
        engine(e.data);
    } else {
        // Try ccall if postMessage isn't there
        try {
             engine.ccall('uci_command', 'number', ['string'], [e.data]);
        } catch (err) {
            console.error('Worker: Failed to send command', err);
        }
    }
};
