const DB_NAME = 'CodeComponentDB';
const DB_VERSION = 1;

let db = null;

async function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('codeUnits')) {
                const store = db.createObjectStore('codeUnits', { keyPath: 'id' });
                store.createIndex('clusterId', 'clusterId', { unique: false });
            }
            if (!db.objectStoreNames.contains('dependencies')) {
                const store = db.createObjectStore('dependencies', { keyPath: 'id' });
                store.createIndex('sourceId', 'sourceId', { unique: false });
                store.createIndex('targetId', 'targetId', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

// Implement chunked put operation
async function putUnitsChunked(units, storeName = 'codeUnits', chunkSize = 50) {
    const db = await openDB();
    for (let i = 0; i < units.length; i += chunkSize) {
        const chunk = units.slice(i, i + chunkSize);
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        chunk.forEach(unit => store.put(unit));
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (event) => reject(event.target.error);
        });
    }
}

// Get a single unit by ID
async function getUnit(id, storeName = 'codeUnits') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(id);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get multiple units by IDs (chunked)
async function getUnitsChunked(ids, storeName = 'codeUnits', chunkSize = 50) {
    const results = [];
    const db = await openDB();
    
    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        
        const chunkResults = await Promise.all(
            chunk.map(id => new Promise((resolve, reject) => {
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            }))
        );
        
        results.push(...chunkResults);
    }
    
    return results;
}

// Get units by cluster ID
async function getUnitsByCluster(clusterId, storeName = 'codeUnits') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index('clusterId');
        const request = index.getAll(clusterId);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get all units
async function getAllUnits(storeName = 'codeUnits') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get dependencies by source ID
async function getDependenciesBySource(sourceId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('dependencies', 'readonly');
        const store = tx.objectStore('dependencies');
        const index = store.index('sourceId');
        const request = index.getAll(sourceId);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get dependencies by target ID
async function getDependenciesByTarget(targetId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('dependencies', 'readonly');
        const store = tx.objectStore('dependencies');
        const index = store.index('targetId');
        const request = index.getAll(targetId);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Delete a unit by ID
async function deleteUnit(id, storeName = 'codeUnits') {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(id);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Clear all data from a store
async function clearStore(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export { 
    openDB, 
    putUnitsChunked, 
    getUnit, 
    getUnitsChunked, 
    getUnitsByCluster, 
    getAllUnits,
    getDependenciesBySource,
    getDependenciesByTarget,
    deleteUnit,
    clearStore
};