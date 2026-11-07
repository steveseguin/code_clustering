import { getTraceLog, clearTraceLog } from './runtimeTracer.js';
import { getUnit, putUnitsChunked } from './db.js';

// Process trace logs and update dynamic relationships
async function updateDynamicRelationships() {
    const traceLog = getTraceLog();
    if (!traceLog || traceLog.length === 0) return { updated: 0 };
    
    // Map to collect call frequencies between functions
    const callFrequencyMap = new Map();
    
    // Process call entries
    for (const entry of traceLog) {
        if (entry.type === 'callStart' && entry.parentId && entry.unitId) {
            // Find the parent call to get the caller's unitId
            const parentCall = traceLog.find(e => e.id === entry.parentId);
            if (parentCall && parentCall.unitId) {
                const key = `${parentCall.unitId}->${entry.unitId}`;
                callFrequencyMap.set(key, (callFrequencyMap.get(key) || 0) + 1);
            }
        }
    }
    
    // Process the relationships and update units
    const updatedUnits = new Map();
    
    for (const [key, frequency] of callFrequencyMap.entries()) {
        const [sourceId, targetId] = key.split('->');
        
        try {
            // Reuse one copy per source so later relationships cannot overwrite earlier ones.
            const sourceUnit = updatedUnits.get(sourceId) || await getUnit(sourceId);
            if (!sourceUnit) continue;
            
            // Check if this relationship already exists
            const existingRelIndex = sourceUnit.dynamicRelationships.findIndex(
                rel => rel.targetId === targetId
            );
            
            if (existingRelIndex >= 0) {
                // Update existing relationship
                sourceUnit.dynamicRelationships[existingRelIndex].frequency += frequency;
            } else {
                // Add new relationship
                sourceUnit.dynamicRelationships.push({
                    targetId,
                    frequency,
                    context: 'runtime call',
                    lastUpdated: new Date().toISOString()
                });
            }
            
            updatedUnits.set(sourceId, sourceUnit);
        } catch (error) {
            console.error(`Error updating relationship ${key}:`, error);
        }
    }
    
    // Store the updated units in batches
    if (updatedUnits.size > 0) {
        await putUnitsChunked([...updatedUnits.values()]);
    }
    
    // Clear the trace log after processing
    clearTraceLog();
    
    return { updated: updatedUnits.size };
}

// Start periodic updates
function startPeriodicUpdates(intervalMs = 60000) {
    // Update relationships now
    updateDynamicRelationships();
    
    // Set up interval for periodic updates
    const intervalId = setInterval(() => {
        updateDynamicRelationships().catch(err => {
            console.error('Error in periodic relationship update:', err);
        });
    }, intervalMs);
    
    return {
        stop: () => clearInterval(intervalId)
    };
}

export { updateDynamicRelationships, startPeriodicUpdates };