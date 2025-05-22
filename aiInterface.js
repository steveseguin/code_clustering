import { getUnit, getUnitsChunked, getUnitsByCluster, putUnitsChunked } from './db.js';
import { loadAndExecute } from './codeLoader.js';
import { runTests } from './unitTester.js'; // Assuming addTestToUnit was part of original, if not, omit. Omitted as per plan.
import { openDB } from './db.js';
import { ingestCode } from './codeIngester.js'; // Added import

// Map of pending updates
export const pendingUpdates = new Map();

// Handler for AI requests
export async function handleAIRequest(request) {
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
            case 'proposePlan':
                return await handleProposePlan(request);
            case 'importFromGithub':
                return await handleImportFromGithub(request);
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

// Find units by query (supports structured queries)
async function handleFindUnits(request) {
    const { query } = request;
    const allUnits = await getAllUnits();

    if (!query) {
        return { success: true, units: allUnits, count: allUnits.length };
    }

    let filteredUnits = [...allUnits];

    if (typeof query === 'string') {
        // Backward compatibility: simple string query searches name and code (case-insensitive for name)
        const lowerCaseQuery = query.toLowerCase();
        filteredUnits = allUnits.filter(unit =>
            (unit.name && unit.name.toLowerCase().includes(lowerCaseQuery)) ||
            (unit.code && unit.code.includes(query)) // code contains can be case sensitive or configured
        );
        return { success: true, units: filteredUnits, count: filteredUnits.length };
    }

    if (typeof query === 'object') {
        // Helper to get unit IDs if a name is provided for dependency checks
        const getUnitIdsByName = (name) => {
            return allUnits.filter(u => u.name === name).map(u => u.id);
        };

        for (const key in query) {
            const value = query[key];
            if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                continue; // Skip empty or undefined filters
            }

            switch (key) {
                case 'id':
                    filteredUnits = filteredUnits.filter(unit => unit.id === value);
                    break;
                case 'nameContains':
                    const lowerCaseNameQuery = String(value).toLowerCase();
                    filteredUnits = filteredUnits.filter(unit => unit.name && unit.name.toLowerCase().includes(lowerCaseNameQuery));
                    break;
                case 'codeContains':
                    filteredUnits = filteredUnits.filter(unit => unit.code && unit.code.includes(String(value)));
                    break;
                case 'descriptionContains':
                    const lowerCaseDescQuery = String(value).toLowerCase();
                    filteredUnits = filteredUnits.filter(unit => unit.metadata && unit.metadata.description && unit.metadata.description.toLowerCase().includes(lowerCaseDescQuery));
                    break;
                case 'ofType':
                    filteredUnits = filteredUnits.filter(unit => unit.type === value);
                    break;
                case 'memberOfCluster':
                    filteredUnits = filteredUnits.filter(unit => unit.clusterId === value);
                    break;
                case 'hasTests':
                    filteredUnits = filteredUnits.filter(unit => {
                        const has = unit.metadata && unit.metadata.tests && unit.metadata.tests.length > 0;
                        return value ? has : !has;
                    });
                    break;
                case 'originalSource':
                    filteredUnits = filteredUnits.filter(unit => unit.originalSource === value);
                    break;
                case 'dependsOn': {
                    let targetIds = [];
                    // Check if 'value' is an ID or a name
                    if (allUnits.some(u => u.id === value)) { // It's an ID
                        targetIds = [value];
                    } else { // Assume it's a name
                        targetIds = getUnitIdsByName(value);
                    }
                    if (targetIds.length === 0) { // No such unit name found
                        filteredUnits = []; // No unit can depend on a non-existent unit
                        break;
                    }
                    
                    // Get names of target units for static dependency check
                    const targetNames = allUnits.filter(u => targetIds.includes(u.id)).map(u => u.name);

                    filteredUnits = filteredUnits.filter(unit => {
                        // Check static dependencies (array of names)
                        if (unit.staticDependencies && unit.staticDependencies.some(depName => targetNames.includes(depName))) {
                            return true;
                        }
                        // Check dynamic relationships (array of objects with targetId)
                        if (unit.dynamicRelationships && unit.dynamicRelationships.some(rel => targetIds.includes(rel.targetId))) {
                            return true;
                        }
                        return false;
                    });
                    break;
                }
                case 'dependencyOf': {
                    let sourceIds = [];
                     if (allUnits.some(u => u.id === value)) { // It's an ID
                        sourceIds = [value];
                    } else { // Assume it's a name
                        sourceIds = getUnitIdsByName(value);
                    }

                    if (sourceIds.length === 0) {
                        filteredUnits = [];
                        break;
                    }
                    
                    // Get names of source units for static dependency check by others
                    const sourceNames = allUnits.filter(u => sourceIds.includes(u.id)).map(u => u.name);

                    // A unit U is a dependencyOf X if X dependsOn U.
                    // So, for each unit 'currentUnit' in filteredUnits, we check if any of the 'sourceIds' units depend on 'currentUnit'.
                    filteredUnits = filteredUnits.filter(currentUnit => {
                        return sourceIds.some(sourceId => {
                            const sourceUnit = allUnits.find(u => u.id === sourceId);
                            if (!sourceUnit) return false;

                            // Check if sourceUnit's staticDependencies (by name) includes currentUnit's name
                            if (sourceUnit.staticDependencies && sourceUnit.staticDependencies.includes(currentUnit.name)) {
                                return true;
                            }
                            // Check if sourceUnit's dynamicRelationships (by targetId) includes currentUnit's id
                            if (sourceUnit.dynamicRelationships && sourceUnit.dynamicRelationships.some(rel => rel.targetId === currentUnit.id)) {
                                return true;
                            }
                            return false;
                        });
                    });
                    break;
                }
                default:
                    // Optional: log unknown filter keys or return an error
                    console.warn(`Unknown filter key: ${key}`);
            }
        }
        return { success: true, units: filteredUnits, count: filteredUnits.length };
    }

    return { success: false, error: 'Invalid query type. Query must be a string or an object.' };
}

// Get dependencies of a unit
async function handleGetDependencies(request) {
    const { id, type = 'both' } = request;
    if (!id) { return { success: false, error: 'Unit ID is required' }; }
    const unit = await getUnit(id);
    if (!unit) { return { success: false, error: `Unit not found: ${id}` }; }
    // Simplified - actual implementation was more complex
    return { success: true, dependencies: { static: unit.staticDependencies || [], dynamic: unit.dynamicRelationships || [] } };
}

// Propose an update to a unit
async function handleProposeUpdate(request) {
    const { id, newCode, newTests } = request;
    if (!id || !newCode) {
        return { success: false, error: 'Unit ID and new code are required' };
    }
    const unit = await getUnit(id);
    if (!unit) { return { success: false, error: `Unit not found: ${id}` }; }
    pendingUpdates.set(id, {
        unitId: id, originalCode: unit.code, newCode, newTests,
        type: 'single_update', // Differentiate from plans
        proposedAt: new Date().toISOString()
    });
    return { success: true, message: `Update proposed for unit: ${id}`, pendingUpdatesCount: pendingUpdates.size };
}

// Run tests for a unit
async function handleRunTests(request) {
    const { id } = request;
    if (!id) { return { success: false, error: 'Unit ID is required' }; }
    const testResults = await runTests(id); // runTests should be imported
    return { success: true, testResults };
}

// Preview execution of a code path
async function handlePreviewExecution(request) {
    const { entryPointId, args } = request;
    if (!entryPointId) { return { success: false, error: 'Entry point ID is required' }; }
    const logs = [];
    const context = { console: { log: (...args) => logs.push({type: 'log', args}) }, args: args || {} };
    let result, error;
    try {
        result = await loadAndExecute([entryPointId], context); // loadAndExecute should be imported
    } catch (err) {
        error = { message: err.message, stack: err.stack };
    }
    return { success: !error, result, logs, error };
}

// Apply a proposed update
async function handleApplyUpdate(request) {
    const { id } = request;
    if (!id) { return { success: false, error: 'Unit ID is required' }; }
    if (!pendingUpdates.has(id)) { return { success: false, error: `No pending update found for unit: ${id}` }; }
    const update = pendingUpdates.get(id);
    if (update.type === 'plan') { // Cannot apply a plan with this old handler
        return { success: false, error: 'This is a plan, use applyPlan command (not yet implemented)'};
    }
    const unit = await getUnit(id);
    if (!unit) { pendingUpdates.delete(id); return { success: false, error: `Unit not found: ${id}` }; }
    unit.code = update.newCode;
    unit.metadata = unit.metadata || {};
    unit.metadata.lastUpdated = new Date().toISOString();
    if (update.newTests) {
        if (!unit.metadata.tests) unit.metadata.tests = [];
        unit.metadata.tests.push({ id: `test_${Date.now()}`, code: update.newTests, createdAt: new Date().toISOString() });
    }
    await putUnitsChunked([unit]); // putUnitsChunked should be imported
    pendingUpdates.delete(id);
    return { success: true, message: `Update applied to unit: ${id}`, pendingUpdatesCount: pendingUpdates.size };
}

async function handleProposePlan(request) {
  const { plan, planId: providedPlanId, description } = request;

  if (!plan || !Array.isArray(plan)) {
    // Use 'success: false' for consistency with other handlers
    return { success: false, error: 'Missing or invalid plan array' };
  }

  if (!description) {
    return { success: false, error: 'Missing plan description' };
  }

  for (const step of plan) {
    if (!step.action || !step.details) {
      return { success: false, error: 'Invalid step structure: missing action or details' };
    }
    if (step.action === 'createUnit') {
      if (!step.details.name || !step.details.code) {
        return { success: false, error: 'Invalid createUnit step: missing name or code' };
      }
    } else if (step.action === 'updateUnit') {
      if (!step.details.id) {
        return { success: false, error: 'Invalid updateUnit step: missing id' };
      }
    } else {
      // It's good to inform which action is unknown
      return { success: false, error: `Unknown step action: ${step.action}` };
    }
  }

  const planId = providedPlanId || `plan_${Date.now()}`;
  const proposedAt = new Date().toISOString();

  pendingUpdates.set(planId, {
    type: 'plan', // This type is crucial
    planId,
    description,
    steps: plan,
    proposedAt,
  });

  return {
    // Use 'success: true' for consistency
    success: true,
    message: `Plan ${planId} proposed successfully.`,
    planId,
    pendingUpdatesCount: pendingUpdates.size,
  };
}

// Helper to get all units (if not exported from db.js)
async function getAllUnits() {
    const db = await openDB(); // openDB should be imported
    return new Promise((resolve, reject) => {
        const tx = db.transaction('codeUnits', 'readonly');
        const store = tx.objectStore('codeUnits');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function handleImportFromGithub(request) {
    const { repoUrl, filePath, pat } = request;

    if (!repoUrl) {
        return { success: false, error: 'GitHub repository URL (repoUrl) is required.' };
    }

    let owner, repo;
    try {
        const url = new URL(repoUrl.replace(/\.git$/, '')); // Remove .git if present
        const pathParts = url.pathname.split('/').filter(part => part.length > 0);
        if (url.hostname === 'github.com' && pathParts.length >= 2) {
            owner = pathParts[0];
            repo = pathParts[1];
        } else {
            throw new Error('Invalid GitHub URL format.');
        }
    } catch (e) {
        return { success: false, error: `Invalid GitHub repository URL format: ${e.message}` };
    }

    if (!owner || !repo) {
         return { success: false, error: 'Could not parse owner and repo from GitHub URL.' };
    }

    const apiBaseUrl = `https://api.github.com/repos/${owner}/${repo}/contents/`;
    const fullApiUrl = filePath ? `${apiBaseUrl}${filePath}` : apiBaseUrl;

    const headers = {
        'Accept': 'application/vnd.github.v3+json',
    };
    if (pat) {
        headers['Authorization'] = `token ${pat}`;
    }

    try {
        const response = await fetch(fullApiUrl, { headers });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            const errorMessage = errorData?.message || response.statusText;
            return { success: false, error: `GitHub API error (${response.status}): ${errorMessage}` };
        }

        const data = await response.json();
        let allJsContent = '';
        let filesProcessed = 0;
        let unitsCount = 0;

        const processFile = async (fileItem) => {
            if (fileItem.name.endsWith('.js')) {
                let fileContent = '';
                if (fileItem.download_url) {
                    const fileResponse = await fetch(fileItem.download_url);
                    if (fileResponse.ok) {
                        fileContent = await fileResponse.text();
                    } else {
                        console.warn(`Failed to download ${fileItem.name} from download_url. Status: ${fileResponse.status}`);
                        // Fallback to content API if download_url fails or is null
                        if (fileItem.url) {
                             const contentResponse = await fetch(fileItem.url, { headers });
                             if(contentResponse.ok) {
                                 const contentData = await contentResponse.json();
                                 if (contentData.encoding === 'base64' && contentData.content) {
                                     fileContent = atob(contentData.content);
                                 } else if (contentData.content) { // Assuming it might be plain text
                                     fileContent = contentData.content;
                                 }
                             } else {
                                console.error(`Failed to fetch content for ${fileItem.name} from content API. Status: ${contentResponse.status}`);
                                return; // Skip this file
                             }
                        }
                    }
                } else if (fileItem.content && fileItem.encoding === 'base64') { // Should not happen if download_url is prioritized
                     fileContent = atob(fileItem.content);
                } else if (fileItem.url) { // Fallback for items that might not have download_url (e.g. submodules, though type filter should prevent this)
                    const contentResponse = await fetch(fileItem.url, { headers });
                     if(contentResponse.ok) {
                         const contentData = await contentResponse.json();
                         if (contentData.encoding === 'base64' && contentData.content) {
                             fileContent = atob(contentData.content);
                         } else if (contentData.content) {
                             fileContent = contentData.content;
                         } else if (contentData.download_url) { // Check again for download_url from this specific item content endpoint
                            const nestedFileResponse = await fetch(contentData.download_url);
                            if (nestedFileResponse.ok) fileContent = await nestedFileResponse.text();
                            else console.warn(`Failed to download ${fileItem.name} from nested download_url. Status: ${nestedFileResponse.status}`);
                         }
                     } else {
                        console.error(`Failed to fetch content for ${fileItem.name} from its content API URL. Status: ${contentResponse.status}`);
                        return; // Skip this file
                     }
                }


                if (fileContent) {
                    allJsContent += fileContent + '\n\n'; // Add separator
                    filesProcessed++;
                }
            }
        };

        if (Array.isArray(data)) { // It's a directory
            // Sequentially process files to avoid overwhelming the API or ingestCode
            for (const item of data) {
                if (item.type === 'file') {
                    await processFile(item);
                }
                // Note: No recursive directory fetching for this version as per instructions
            }
        } else if (data.type === 'file') { // It's a single file
            await processFile(data);
        } else {
            return { success: false, error: 'The path does not point to a file or directory recognizable by the GitHub API.' };
        }

        if (filesProcessed === 0) {
            return { success: false, error: 'No JavaScript files found at the specified path.' };
        }

        // Ingest all collected JS content
        // The sourceName for ingestCode could be more specific, e.g., repoUrl + (filePath || '')
        const sourceName = `github:${owner}/${repo}` + (filePath ? `/${filePath}` : '');
        const ingestResult = await ingestCode(allJsContent, sourceName);

        if (ingestResult.success) {
            unitsCount = ingestResult.unitsCount;
            return { 
                success: true, 
                message: `Imported ${unitsCount} units from ${filesProcessed} JS files from ${owner}/${repo}${filePath ? '/' + filePath : ''}.`,
                unitsCount,
                filesProcessed
            };
        } else {
            return { success: false, error: `Failed to ingest code: ${ingestResult.error}` };
        }

    } catch (e) {
        console.error('Error during GitHub import:', e);
        return { success: false, error: `An unexpected error occurred: ${e.message}` };
    }
}

// Set up a message handler for postMessage
export function setupMessageHandler(target = window) {
    target.addEventListener('message', async (event) => {
        const { data } = event;
        if (data && data.type === 'ai_request') {
            const response = await handleAIRequest(data.request);
            target.postMessage({ type: 'ai_response', requestId: data.requestId, response }, '*');
        }
    });
}
