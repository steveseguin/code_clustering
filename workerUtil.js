function runInWorker(workerCodeString, data) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([workerCodeString], { type: 'application/javascript' });
        const worker = new Worker(URL.createObjectURL(blob));

        worker.onmessage = (event) => {
            resolve(event.data);
            worker.terminate(); // Terminate worker after use
        };

        worker.onerror = (event) => {
            reject(event.error);
            worker.terminate(); // Terminate worker on error
        };

        worker.postMessage(data); // Send data to the worker
    });
}

// Helper function to create a reusable worker from a file
function createWorkerFromFile(workerPath) {
    return {
        run: function(data) {
            return new Promise((resolve, reject) => {
                const worker = new Worker(workerPath);
                
                worker.onmessage = (event) => {
                    resolve(event.data);
                    worker.terminate();
                };
                
                worker.onerror = (event) => {
                    reject(event.error);
                    worker.terminate();
                };
                
                worker.postMessage(data);
            });
        }
    };
}

export { runInWorker, createWorkerFromFile };