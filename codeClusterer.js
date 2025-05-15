import { getAllUnits, putUnitsChunked } from './db.js';

// Simple clustering algorithm based on static dependencies and shared prefixes
async function clusterUnits(maxClusterSize = 5000) {
    try {
        // Get all units
        const units = await getAllUnits();
        if (!units || units.length === 0) {
            return { success: false, error: 'No units found' };
        }
        
        // Build a dependency graph
        const graph = {};
        
        units.forEach(unit => {
            graph[unit.id] = {
                unit,
                outgoing: unit.staticDependencies || [],
                incoming: [],
                codeSize: unit.code ? unit.code.length : 0
            };
        });
        
        // Fill in incoming dependencies
        units.forEach(unit => {
            (unit.staticDependencies || []).forEach(depName => {
                // Find the target unit by name
                const targetUnit = units.find(u => u.name === depName);
                if (targetUnit && graph[targetUnit.id]) {
                    graph[targetUnit.id].incoming.push(unit.id);
                }
            });
            
            // Also include dynamic relationships
            (unit.dynamicRelationships || []).forEach(rel => {
                if (rel.targetId && graph[rel.targetId]) {
                    graph[rel.targetId].incoming.push(unit.id);
                    
                    // Add to outgoing if not already there
                    if (!graph[unit.id].outgoing.includes(rel.targetId)) {
                        graph[unit.id].outgoing.push(rel.targetId);
                    }
                }
            });
        });
        
        // Group units by prefix as an initial clustering
        const prefixClusters = {};
        
        units.forEach(unit => {
            // Extract prefix (e.g., "utils." from "utils.formatDate")
            const dotIndex = unit.name.indexOf('.');
            const prefix = dotIndex > 0 ? unit.name.substring(0, dotIndex) : 'default';
            
            if (!prefixClusters[prefix]) {
                prefixClusters[prefix] = [];
            }
            
            prefixClusters[prefix].push(unit.id);
        });
        
        // Merge small prefix clusters and split large ones to maintain size constraint
        const finalClusters = {};
        let nextClusterId = 1;
        
        Object.entries(prefixClusters).forEach(([prefix, clusterUnits]) => {
            // Calculate total code size
            const totalSize = clusterUnits.reduce((sum, unitId) => 
                sum + (graph[unitId]?.codeSize || 0), 0);
            
            if (totalSize <= maxClusterSize) {
                // Keep small clusters as-is
                const clusterId = `cluster_${nextClusterId++}`;
                finalClusters[clusterId] = {
                    name: prefix,
                    units: clusterUnits,
                    totalSize
                };
            } else {
                // Split large clusters based on connectivity
                // Use a simple greedy algorithm:
                // 1. Start with most connected node
                // 2. Add its neighbors until size limit
                // 3. Repeat with remaining nodes
                
                const remainingUnits = [...clusterUnits];
                
                while (remainingUnits.length > 0) {
                    // Find unit with most connections to others in this cluster
                    remainingUnits.sort((a, b) => {
                        const aConnections = graph[a].outgoing.filter(id => remainingUnits.includes(id)).length +
                                            graph[a].incoming.filter(id => remainingUnits.includes(id)).length;
                        const bConnections = graph[b].outgoing.filter(id => remainingUnits.includes(id)).length +
                                            graph[b].incoming.filter(id => remainingUnits.includes(id)).length;
                        return bConnections - aConnections;
                    });
                    
                    // Start a new cluster with this unit
                    const startUnit = remainingUnits.shift();
                    const currentCluster = [startUnit];
                    let currentSize = graph[startUnit].codeSize;
                    
                    // Find connected units to add
                    const candidates = [
                        ...graph[startUnit].outgoing.filter(id => remainingUnits.includes(id)),
                        ...graph[startUnit].incoming.filter(id => remainingUnits.includes(id))
                    ];
                    
                    while (candidates.length > 0 && currentSize < maxClusterSize) {
                        const nextUnit = candidates.shift();
                        if (!nextUnit || !remainingUnits.includes(nextUnit)) continue;
                        
                        // Add unit to current cluster
                        currentCluster.push(nextUnit);
                        currentSize += graph[nextUnit].codeSize;
                        
                        // Remove from remaining units
                        const index = remainingUnits.indexOf(nextUnit);
                        if (index >= 0) {
                            remainingUnits.splice(index, 1);
                        }
                        
                        // Add its connections as candidates
                        const newConnections = [
                            ...graph[nextUnit].outgoing.filter(id => 
                                remainingUnits.includes(id) && !candidates.includes(id)),
                            ...graph[nextUnit].incoming.filter(id => 
                                remainingUnits.includes(id) && !candidates.includes(id))
                        ];
                        
                        candidates.push(...newConnections);
                    }
                    
                    // Save the cluster
                    const clusterId = `cluster_${nextClusterId++}`;
                    finalClusters[clusterId] = {
                        name: `${prefix}_${clusterId}`,
                        units: currentCluster,
                        totalSize: currentSize
                    };
                }
            }
        });
        
        // Update units with cluster IDs
        const updatedUnits = [];
        
        Object.entries(finalClusters).forEach(([clusterId, cluster]) => {
            cluster.units.forEach(unitId => {
                const unit = units.find(u => u.id === unitId);
                if (unit) {
                    unit.clusterId = clusterId;
                    updatedUnits.push(unit);
                }
            });
        });
        
        // Save updated units
        if (updatedUnits.length > 0) {
            await putUnitsChunked(updatedUnits);
        }
        
        return {
            success: true,
            clusters: Object.keys(finalClusters).length,
            unitsUpdated: updatedUnits.length
        };
    } catch (error) {
        console.error('Error in clustering units:', error);
        return { success: false, error: error.message };
    }
}

export { clusterUnits };