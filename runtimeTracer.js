let traceLog = [];
let callStack = []; // Use an array for the call stack
let nextCallId = 0; // Simple counter for unique call IDs

// Helper to sample value for logging
function sampleValue(value) {
    if (value === null) return null;
    if (value === undefined) return undefined;
    
    const type = typeof value;
    
    if (type === 'number' || type === 'boolean' || type === 'string') {
        return value;
    } else if (type === 'function') {
        return `[Function: ${value.name || 'anonymous'}]`;
    } else if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return `[Array(${value.length})]`;
    } else if (type === 'object') {
        if (value instanceof Date) return value.toISOString();
        if (value instanceof RegExp) return value.toString();
        if (value instanceof Error) return `[${value.name}: ${value.message}]`;
        
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        return `{Object: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
    }
    
    return `[${type}]`;
}

// Helper to format error for logging
function formatError(error) {
    if (!error) return 'Unknown error';
    
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : undefined
        };
    }
    
    return String(error);
}

function generateUniqueCallId() {
    return `call_${nextCallId++}`;
}

function traceFn(fn, name, unitId) { // Add unitId parameter
    // Skip native code or functions already traced
    if (fn.__isTraced) return fn;

    const traced = function(...args) {
        const callId = generateUniqueCallId();
        const parentCallId = callStack.length > 0 ? callStack[callStack.length - 1].id : null;
        callStack.push({ id: callId, name, unitId });

        const startTime = performance.now();
        // Log call start
        traceLog.push({
            type: 'callStart',
            id: callId,
            parentId: parentCallId,
            unitId: unitId, // Store the associated unit ID
            name: name,
            timestamp: performance.now(),
            argsSample: args.map(sampleValue) // Use helper from previous AI
        });

        try {
            const result = fn.apply(this, args);

            // Handle Promises
            if (result && typeof result.then === 'function') {
                return result.then(asyncResult => {
                    const endTime = performance.now();
                    // Log async call end
                    traceLog.push({
                        type: 'callEnd',
                        id: callId,
                        timestamp: performance.now(),
                        duration: endTime - startTime,
                        returnValueSample: sampleValue(asyncResult),
                        async: true
                    });
                    callStack.pop();
                    return asyncResult;
                }).catch(error => {
                    const endTime = performance.now();
                    // Log async error
                    traceLog.push({
                        type: 'callError',
                        id: callId,
                        timestamp: performance.now(),
                        duration: endTime - startTime,
                        error: formatError(error), // Helper to format error
                        async: true
                    });
                    callStack.pop();
                    throw error;
                });
            } else {
                const endTime = performance.now();
                // Log sync call end
                traceLog.push({
                    type: 'callEnd',
                    id: callId,
                    timestamp: performance.now(),
                    duration: endTime - startTime,
                    returnValueSample: sampleValue(result),
                    async: false
                });
                callStack.pop();
                return result;
            }
        } catch (error) {
            const endTime = performance.now();
            // Log sync error
            traceLog.push({
                type: 'callError',
                id: callId,
                timestamp: performance.now(),
                duration: endTime - startTime,
                error: formatError(error),
                async: false
            });
            callStack.pop();
            throw error;
        }
    };
    traced.__isTraced = true; // Mark as traced
    return traced;
}

function traceAllGlobal(unitIdMap) { // Accept map from name to unitId
    for (const key in window) {
        try {
            const originalFn = window[key];
            if (typeof originalFn === 'function' && !originalFn.toString().includes('[native code]') && !originalFn.__isTraced) {
                const unitId = unitIdMap[key] || null; // Get unit ID if known
                window[key] = traceFn(originalFn, `window.${key}`, unitId);
            }
        } catch (e) { /* ignore errors for properties we can't access */ }
    }
}

function traceObject(obj, prefix = '', unitIdMap = {}) {
    if (!obj || typeof obj !== 'object') return;
    
    Object.getOwnPropertyNames(obj).forEach(key => {
        try {
            const propValue = obj[key];
            if (typeof propValue === 'function' && !propValue.__isTraced) {
                const fullName = prefix ? `${prefix}.${key}` : key;
                const unitId = unitIdMap[fullName] || null;
                obj[key] = traceFn(propValue, fullName, unitId);
            } else if (propValue && typeof propValue === 'object' && !Array.isArray(propValue)) {
                const newPrefix = prefix ? `${prefix}.${key}` : key;
                traceObject(propValue, newPrefix, unitIdMap);
            }
        } catch (e) { /* ignore errors for properties we can't access */ }
    });
}

function getTraceLog() {
    return traceLog;
}

function clearTraceLog() {
    traceLog = [];
    callStack = [];
    nextCallId = 0;
}

export { 
    traceFn, 
    traceAllGlobal, 
    traceObject,
    getTraceLog, 
    clearTraceLog, 
    sampleValue, 
    formatError 
};