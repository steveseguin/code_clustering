// Progress messages are notifications; only the final response settles the job.
function runWorker(worker, data, onProgress, cleanup = () => {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            settled = true;
            worker.terminate();
            cleanup();
        };

        worker.onmessage = (event) => {
            if (settled) return;
            if (event.data && event.data.type === 'progress') {
                try {
                    if (onProgress) onProgress(event.data);
                } catch (error) {
                    finish();
                    reject(error);
                }
                return;
            }
            finish();
            resolve(event.data);
        };

        worker.onerror = (event) => {
            if (settled) return;
            finish();
            reject(event.error || new Error(event.message || 'Worker failed'));
        };

        worker.onmessageerror = () => {
            if (settled) return;
            finish();
            reject(new Error('Worker response could not be decoded'));
        };

        try {
            worker.postMessage(data);
        } catch (error) {
            finish();
            reject(error);
        }
    });
}

function runInWorker(workerCodeString, data, onProgress) {
    const blob = new Blob([workerCodeString], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    let worker;
    try {
        worker = new Worker(url);
    } catch (error) {
        URL.revokeObjectURL(url);
        return Promise.reject(error);
    }
    return runWorker(worker, data, onProgress, () => URL.revokeObjectURL(url));
}

// Helper function to create a reusable worker from a file
function createWorkerFromFile(workerPath) {
    return {
        run: function(data, onProgress) {
            let worker;
            try {
                worker = new Worker(workerPath);
            } catch (error) {
                return Promise.reject(error);
            }
            return runWorker(worker, data, onProgress);
        }
    };
}

export { runInWorker, createWorkerFromFile };