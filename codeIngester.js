import { putUnitsChunked } from './db.js';
import { runInWorker } from './workerUtil.js';

// Helper function to generate a content string for the static analyzer worker
function getStaticAnalyzerWorkerCode() {
    return `
        // Static analyzer worker code
        ${findMatchingBracket.toString()}
        ${extractFunction.toString()}
        ${analyzeCode.toString()}

        self.onmessage = (event) => {
            const { codeChunk, lineOffset, originalSource } = event.data;
            const result = analyzeCode(codeChunk, lineOffset);
            
            // Set the original source for all units
            result.units.forEach(unit => {
                unit.originalSource = originalSource || 'unknown';
            });
            
            // Report progress
            self.postMessage({ 
                type: 'progress', 
                processedLines: (codeChunk.match(/\\n/g) || []).length + 1 
            });

            // Send results back
            self.postMessage({ type: 'complete', units: result.units, dependencies: result.dependencies });
        };
    `;
}

// Process code in chunks using web workers
async function processCodeChunks(sourceCode, originalSource, chunkSize = 10000, onProgress) {
    // Split the code into manageable chunks
    const lines = sourceCode.split('\n');
    const chunks = [];
    
    for (let i = 0; i < lines.length; i += chunkSize) {
        chunks.push({
            code: lines.slice(i, i + chunkSize).join('\n'),
            lineOffset: i
        });
    }
    
    const allUnits = [];
    const allDependencies = [];
    let processedLines = 0;
    
    // Process each chunk with a worker
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        try {
            const workerCode = getStaticAnalyzerWorkerCode();
            const result = await runInWorker(workerCode, {
                codeChunk: chunk.code,
                lineOffset: chunk.lineOffset,
                originalSource
            });
            
            if (result.type === 'complete') {
                allUnits.push(...result.units);
                allDependencies.push(...result.dependencies);
            } else if (result.type === 'progress') {
                processedLines += result.processedLines;
                if (onProgress) {
                    onProgress({
                        processedLines,
                        totalLines: lines.length,
                        processedChunks: i + 1,
                        totalChunks: chunks.length
                    });
                }
            }
        } catch (error) {
            console.error(`Error processing chunk ${i}:`, error);
        }
    }
    
    return { units: allUnits, dependencies: allDependencies };
}

// Main function to ingest code
async function ingestCode(sourceCode, originalSource, onProgress) {
    try {
        // Process the code in chunks
        const { units, dependencies } = await processCodeChunks(
            sourceCode, 
            originalSource, 
            10000, 
            onProgress
        );
        
        // Store units and dependencies in the database
        if (units.length > 0) {
            await putUnitsChunked(units);
        }
        
        if (dependencies.length > 0) {
            await putUnitsChunked(dependencies, 'dependencies');
        }
        
        return { 
            success: true, 
            unitsCount: units.length, 
            dependenciesCount: dependencies.length 
        };
    } catch (error) {
        console.error('Error ingesting code:', error);
        return { success: false, error: error.message };
    }
}

export { ingestCode };