import { getUnit, getUnitsChunked } from './db.js';

// Resolve all dependencies for a set of entry point units
async function resolveDependencies(entryPointIds) {
    if (!entryPointIds || !entryPointIds.length) {
        throw new Error('No entry points provided');
    }
    
    // Set to track all required units
    const requiredUnits = new Set(entryPointIds);
    // Set to track processed units
    const processedUnits = new Set();
    
    // Process units until no new dependencies are found
    while (true) {
        // Get units that haven't been processed yet
        const unprocessedIds = [...requiredUnits].filter(id => !processedUnits.has(id));
        
        // If all units are processed, we're done
        if (unprocessedIds.length === 0) break;
        
        // Get the units from the database
        const units = await getUnitsChunked(unprocessedIds);
        
        // Mark these units as processed
        unprocessedIds.forEach(id => processedUnits.add(id));
        
        // Add static dependencies to the required units set
        units.forEach(unit => {
            if (unit.staticDependencies && Array.isArray(unit.staticDependencies)) {
                // For each dependency name, try to find the corresponding unit
                unit.staticDependencies.forEach(depName => {
                    // This is a simplified approach - in reality, you'd need a more robust
                    // way to map dependency names to unit IDs
                    const matchingUnit = units.find(u => u.name === depName);
                    if (matchingUnit) {
                        requiredUnits.add(matchingUnit.id);
                    }
                });
            }
            
            // Also add strong dynamic dependencies
            if (unit.dynamicRelationships && Array.isArray(unit.dynamicRelationships)) {
                unit.dynamicRelationships
                    .filter(rel => rel.frequency > 5) // Only include frequently used dependencies
                    .forEach(rel => {
                        if (rel.targetId) {
                            requiredUnits.add(rel.targetId);
                        }
                    });
            }
        });
    }
    
    return [...requiredUnits];
}

// Perform a topological sort of the units
async function topologicalSort(unitIds) {
    // Get all units
    const units = await getUnitsChunked(unitIds);
    
    // Build a dependency graph
    const graph = {};
    units.forEach(unit => {
        graph[unit.id] = {
            unit,
            dependencies: []
        };
    });
    
    // Fill in dependencies
    units.forEach(unit => {
        if (unit.staticDependencies && Array.isArray(unit.staticDependencies)) {
            unit.staticDependencies.forEach(depName => {
                const targetUnit = units.find(u => u.name === depName);
                if (targetUnit && graph[targetUnit.id]) {
                    graph[unit.id].dependencies.push(targetUnit.id);
                }
            });
        }
    });
    
    // Helper for topological sort
    const visit = (nodeId, temp, perm, result) => {
        if (temp.has(nodeId)) {
            // Circular dependency detected
            console.warn(`Circular dependency detected involving ${nodeId}`);
            return;
        }
        if (perm.has(nodeId)) {
            return;
        }
        
        temp.add(nodeId);
        
        const node = graph[nodeId];
        if (node) {
            node.dependencies.forEach(depId => {
                visit(depId, temp, perm, result);
            });
        }
        
        temp.delete(nodeId);
        perm.add(nodeId);
        result.unshift(nodeId);
    };
    
    // Perform topological sort
    const result = [];
    const temp = new Set();
    const perm = new Set();
    
    unitIds.forEach(id => {
        if (!perm.has(id)) {
            visit(id, temp, perm, result);
        }
    });
    
    return result;
}

// Concatenate code units in the correct order
async function concatenateCode(unitIdsInOrder) {
    const units = await getUnitsChunked(unitIdsInOrder);
    
    // Create a map for quick lookup
    const unitsMap = {};
    units.forEach(unit => {
        unitsMap[unit.id] = unit;
    });
    
    // Concatenate code in order
    let combinedCode = '';
    
    unitIdsInOrder.forEach(id => {
        const unit = unitsMap[id];
        if (unit && unit.code) {
            combinedCode += `\n\n// ${unit.name} (${unit.id}) from ${unit.originalSource}\n`;
            combinedCode += unit.code;
        }
    });
    
    return combinedCode;
}

// Execute the concatenated code
function executeCode(codeString, context = {}) {
    try {
        // Create a function with the provided context as parameters
        const contextKeys = Object.keys(context);
        const contextValues = contextKeys.map(key => context[key]);
        
        // Wrap in IIFE to provide a clean scope
        const wrappedCode = `
            (function() {
                ${codeString}
            })();
        `;
        
        // Create and execute the function
        const fn = new Function(...contextKeys, wrappedCode);
        return fn(...contextValues);
    } catch (error) {
        console.error('Error executing code:', error);
        throw error;
    }
}

// Main function to load and execute code units
async function loadAndExecute(entryPointIds, context = {}) {
    try {
        // Resolve dependencies
        const allRequiredIds = await resolveDependencies(entryPointIds);
        
        // Sort units in dependency order
        const sortedIds = await topologicalSort(allRequiredIds);
        
        // Concatenate code
        const code = await concatenateCode(sortedIds);
        
        // Execute the code
        return executeCode(code, context);
    } catch (error) {
        console.error('Error in loading and executing code:', error);
        throw error;
    }
}

export { 
    resolveDependencies, 
    topologicalSort, 
    concatenateCode, 
    executeCode, 
    loadAndExecute 
};