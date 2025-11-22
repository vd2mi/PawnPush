import Stockfish from './stockfish.js';

/**
 * Creates a WebAssembly Stockfish engine instance.
 * @returns {Promise<{
 *   send: (cmd: string) => void,
 *   onMessage: (cb: (line: string) => void) => void,
 *   terminate: () => void
 * }>}
 */
export async function createEngine() {
    // Check if COOP/COEP are active for SharedArrayBuffer support (needed for threads)
    if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('SharedArrayBuffer is not available. Engine may be slow or fail if it requires threads. Ensure COOP/COEP headers are set.');
    }

    // Initialize the engine factory
    // We expect Stockfish() to return a Promise that resolves to the module instance
    const engine = await Stockfish({
        locateFile(path) {
            if (path.endsWith(".wasm")) return "/public/engine/stockfish.wasm";
            return path;
        }
    });

    // The Emscripten module (engine) usually exposes:
    // .postMessage(cmd) -> to send to internal worker/thread
    // .addMessageListener(fn) -> to receive from internal worker/thread
    // .terminate() -> to kill threads
    
    // NOTE: If the WASM build is single-threaded or runs in main thread, 
    // it might use different hooks (e.g. print/printErr or ccall).
    // However, the provided stockfish.js includes 'pre.js' logic which adds 
    // postMessage/addMessageListener.
    
    return {
        send: (cmd) => {
            if (engine.postMessage) {
                engine.postMessage(cmd);
            } else {
                // Fallback for raw modules (unlikely with this build)
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
                // Fallback: hook print
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

