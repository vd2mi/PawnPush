export async function createEngine() {
    if (typeof SharedArrayBuffer === 'undefined') {
        console.warn('SharedArrayBuffer is not available. Performance may be limited.');
    }

    const worker = new Worker('/engine/worker.js', { type: 'module' });

    // Wait for worker to initialize
    await new Promise((resolve, reject) => {
        const handler = (e) => {
            if (e.data === 'worker_ready') {
                worker.removeEventListener('message', handler);
                resolve();
            }
        };
        worker.addEventListener('message', handler);
        
        // Timeout safety
        setTimeout(() => {
            worker.removeEventListener('message', handler);
            // We resolve anyway to avoid blocking, but log a warning
            console.warn('Engine worker init timed out or started without signal. Check console for worker errors.');
            resolve();
        }, 15000); // Increased to 15s for extremely slow initializations
    });

    return {
        send: (cmd) => {
            worker.postMessage(cmd);
        },
        onMessage: (callback) => {
            worker.addEventListener('message', (e) => {
                if (e.data !== 'worker_ready') {
                    callback(e.data);
                }
            });
        },
        terminate: () => {
            worker.terminate();
        }
    };
}
