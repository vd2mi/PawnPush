import Stockfish from '/engine/stockfish.js';

export async function createEngine() {
    if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('SharedArrayBuffer is not available. Engine may be slow or fail if it requires threads. Ensure COOP/COEP headers are set.');
    }

    const engine = await Stockfish({
        locateFile(path) {
            if (path.endsWith(".wasm")) return "/engine/stockfish.wasm";
            return path;
        }
    });

    return {
        send: (cmd) => {
            if (engine.postMessage) {
                engine.postMessage(cmd);
            } else {
                console.warn('Engine does not support postMessage, trying uci_command ccall');
                try {
                    engine.ccall('uci_command', 'number', ['string'], [cmd]);
                } catch(e) {
                    console.error('Failed to send command to engine', e);
                }
            }
        },
        onMessage: (callback) => {
            if (engine.addMessageListener) {
                engine.addMessageListener(callback);
            } else {
                const oldPrint = engine.print;
                engine.print = (line) => {
                    if (oldPrint) oldPrint(line);
                    callback(line);
                };
            }
        },
        terminate: () => {
            if (engine.terminate) {
                engine.terminate();
            }
        }
    };
}
