import { getUnit, getUnitsChunked, getUnitsByCluster, putUnitsChunked } from './db.js';
import { loadAndExecute } from './codeLoader.js';
import { runTests, addTestToUnit } from './unitTester.js';
import { openDB } from './db.js';

// Map of pending updates
const pendingUpdates = new Map();

// Handler for AI requests
async function handleAIRequest(request) {
    try {
        switch (request.command) {
            case 'getUnit':
                return await handleGetUnit(request);
            
            case 'getCluster':
                return await handleGetCluster(request);
            
            case 'findUnits':
                return await handleFindUnits(request);
            
            case 'getDependencies':
                return await handleGetDependencies(request);
            
            case 'proposeUpdate':
                return await handleProposeUpdate(request);
            
            case 'runTests':
                return await handleRunTests(request);
            
            case 'previewExecution':
                return await handlePreviewExecution(request);
            
            case 'applyUpdate':
                return await handleApplyUpdate(request);
            
            default:
                return {
                    success: false,
                    error: `Unknown command: ${request.command}`
                };
        }
    } catch (error) {
        console.error('Error handling AI request:', error);
        return {
            success: false,
            error: error.message,
            stack: error.stack
        };
    }
}

// Get a single unit
async function handleGetUnit(request) {
    const { id } = request;
    if (!id) {
        return { success: false, error: 'Unit ID is required' };
    }
    
    const unit = await getUnit(id);
    if (!unit) {
        return { success: false, error: `Unit not found: ${id}` };
    }
    
    return { success: true, unit };
}

// Get all units in a cluster
async function handleGetCluster(request) {
    const { id } = request;
    if (!id) {
        return { success: false, error: 'Cluster ID is required' };
    }
    
    const units = await getUnitsByCluster(id);
    if (!units || units.length === 0) {
        return { success: false, error: `No units found in cluster: ${id}` };
    }
    
    return { success: true, units };
}

// Find units by query
async function handleFindUnits(request) {
    const { query } = request;
    if (!query) {
        return { success: false, error: 'Search query is required' };
    }
    
    // Simple search implementation - in a real system, you'd want indexing
    const allUnits = await getAllUnits();
    
    const results = allUnits.filter(unit => {
        // Search in name
        if (unit.name && unit.name.includes(query)) {
            return true;
        }
        
        // Search in code
        if (unit.code && unit.code.includes(query)) {
            return true;
        }
        
        // Search in metadata description if available
        if (unit.metadata && unit.metadata.description &&
            unit.metadata.description.includes(query)) {
            return true;
        }
        
        return false;
    });
    
    return { 
        success: true, 
        units: results,
        count: results.length
    };
}

// Get dependencies of a unit
async function handleGetDependencies(request) {
    const { id, type = 'both' } = request;
    if (!id) {
        return { success: false, error: 'Unit ID is required' };
    }
    
    const unit = await getUnit(id);
    if (!unit) {
        return { success: false, error: `Unit not found: ${id}` };
    }
    
    const dependencies = {
        static: [],
        dynamic: []
    };
    
    // Get static dependencies
    if (type === 'both' || type === 'static') {
        if (unit.staticDependencies && Array.isArray(unit.staticDependencies)) {
            // Map dependency names to units
            const allUnits = await getAllUnits();
            const staticDeps = unit.staticDependencies
                .map(depName => allUnits.find(u => u.name === depName))
                .filter(Boolean);
            
            dependencies.static = staticDeps;
        }
    }
    
    // Get dynamic dependencies
    if (type === 'both' || type === 'dynamic') {
        if (unit.dynamicRelationships && Array.isArray(unit.dynamicRelationships)) {
            const dynamicDepIds = unit.dynamicRelationships.map(rel => rel.targetId);
            const dynamicDeps = await getUnitsChunked(dynamicDepIds);
            
            // Add frequency information
            dependencies.dynamic = dynamicDeps.map(dep => {
                const rel = unit.dynamicRelationships.find(r => r.targetId === dep.id);
                return {
                    ...dep,
                    frequency: rel ? rel.frequency : 0
                };
            });
        }
    }
    
    return { success: true, dependencies };
}

// Propose an update to a unit
async function handleProposeUpdate(request) {
    const { id, newCode, newTests } = request;
    if (!id || !newCode) {
        return { success: false, error: 'Unit ID and new code are required' };
    }
    
    const unit = await getUnit(id);
    if (!unit) {
        return { success: false, error: `Unit not found: ${id}` };
    }
    
    // Store the update proposal
    pendingUpdates.set(id, {
        unitId: id,
        originalCode: unit.code,
        newCode,
        newTests,
        proposedAt: new Date().toISOString()
    });
    
    return { 
        success: true, 
        message: `Update proposed for unit: ${id}`,
        pendingUpdatesCount: pendingUpdates.size
    };
}

// Run tests for a unit
async function handleRunTests(request) {
    const { id } = request;
    if (!id) {
        return { success: false, error: 'Unit ID is required' };
    }
    
    const testResults = await runTests(id);
    return { success: true, testResults };
}

// Preview execution of a code path
async function handlePreviewExecution(request) {
    const { entryPointId, args } = request;
    if (!entryPointId) {
        return { success: false, error: 'Entry point ID is required' };
    }
    
    // Create a safe execution context
    const context = {
        console: {
            log: function(...args) {
                logs.push({ type: 'log', args });
            },
            warn: function(...args) {
                logs.push({ type: 'warn', args });
            },
            error: function(...args) {
                logs.push({ type: 'error', args });
            }
        },
        args: args || {}
    };
    
    const logs = [];
    let result;
    let error;
    
    try {
        // Execute the code
        result = await loadAndExecute([entryPointId], context);
    } catch (err) {
        error = {
            message: err.message,
            stack: err.stack
        };
    }
    
    return {
        success: !error,
        result,
        logs,
        error
    };
}

// Apply a proposed update
async function handleApplyUpdate(request) {
    const { id } = request;
    if (!id) {
        return { success: false, error: 'Unit ID is required' };
    }
    
    // Check if update exists
    if (!pendingUpdates.has(id)) {
        return { success: false, error: `No pending update found for unit: ${id}` };
    }
    
    const update = pendingUpdates.get(id);
    const unit = await getUnit(id);
    
    if (!unit) {
        pendingUpdates.delete(id);
        return { success: false, error: `Unit not found: ${id}` };
    }
    
    // Apply the update
    unit.code = update.newCode;
    unit.metadata = unit.metadata || {};
    unit.metadata.lastUpdated = new Date().toISOString();
    
    // Add test if provided
    if (update.newTests) {
        if (!unit.metadata.tests) {
            unit.metadata.tests = [];
        }
        
        unit.metadata.tests.push({
            id: `test_${Date.now()}`,
            code: update.newTests,
            createdAt: new Date().toISOString()
        });
    }
    
    // Save the updated unit
    await putUnitsChunked([unit]);
    
    // Remove from pending updates
    pendingUpdates.delete(id);
    
    return { 
        success: true, 
        message: `Update applied to unit: ${id}`,
        pendingUpdatesCount: pendingUpdates.size
    };
}

// Helper to get all units (not exported in db.js)
async function getAllUnits() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('codeUnits', 'readonly');
        const store = tx.objectStore('codeUnits');
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Set up a message handler for postMessage
function setupMessageHandler(target = window) {
    target.addEventListener('message', async (event) => {
        const { data } = event;
        
        // Check if this is an AI request
        if (data && data.type === 'ai_request') {
            const response = await handleAIRequest(data.request);
            
            // Send response back
            target.postMessage({
                type: 'ai_response',
                requestId: data.requestId,
                response
            }, '*');
        }
    });
}

export { 
    handleAIRequest, 
    setupMessageHandler,
    pendingUpdates 
};