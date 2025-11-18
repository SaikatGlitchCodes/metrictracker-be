const { Worker } = require('worker_threads');
const path = require('path');

function spawnCommentsWorker(workerData) {
    return new Promise((resolve, reject) => {
        const workerPath = path.join(__dirname, '../workers/commentsWorker.js');
        const worker = new Worker(workerPath, { workerData });

        const messages = [];

        worker.on('message', (message) => {
            messages.push(message);

            // Log progress messages
            if (message.type === 'progress') {
                console.log(`[Worker] ${message.message}`);
            } else if (message.type === 'warning') {
                console.warn(`[Worker Warning] ${message.message}`, message.errors);
            } else if (message.type === 'success') {
                console.log(`[Worker Success] ${message.message}`);
                resolve({
                    success: true,
                    ...message
                });
            }
        });

        worker.on('error', (error) => {
            console.error('[Worker Error]', error);
            reject({
                success: false,
                message: 'Worker thread encountered an error',
                error: error.message
            });
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`[Worker] Exited with code ${code}`);
                
                // Check if there was an error message
                const errorMessage = messages.find(msg => msg.type === 'error');
                if (errorMessage) {
                    reject({
                        success: false,
                        ...errorMessage
                    });
                } else {
                    reject({
                        success: false,
                        message: `Worker stopped with exit code ${code}`
                    });
                }
            }
        });
    });
}

module.exports = { spawnCommentsWorker };
