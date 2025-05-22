import { openDB, clearStore } from './db.js';
import { ingestCode } from './codeIngester.js';
import { clusterUnits } from './codeClusterer.js';
import { traceAllGlobal, traceObject } from './runtimeTracer.js';
import { startPeriodicUpdates } from './relationshipUpdater.js';
import { runTests, addTestToUnit } from './unitTester.js';
import { loadAndExecute } from './codeLoader.js';
import { handleAIRequest, setupMessageHandler, pendingUpdates } from './aiInterface.js';

// Initialize the app
async function initApp() {
    try {
        // Initialize database
        await openDB();
        
        // Set up message handler for AI interface
        setupMessageHandler();
        
        // Start periodic relationship updates
        const updater = startPeriodicUpdates(30000); // 30 seconds
        
        // Set up UI event handlers
        setupUIHandlers();
        
        // Update units in select dropdown
        await updateUnitSelect();
        
        // Update pending updates display
        updatePendingUpdatesDisplay();
        
        log('System initialized successfully.', 'success');
    } catch (error) {
        log(`Initialization error: ${error.message}`, 'error');
        console.error('Initialization error:', error);
    }
}

// Set up UI event handlers
function setupUIHandlers() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            // Add active class to clicked tab
            tab.classList.add('active');
            
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            // Show the corresponding tab content
            const tabId = tab.getAttribute('data-tab');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });
    
    // Analyze and import button
    document.getElementById('analyze-btn').addEventListener('click', async () => {
        const codeInput = document.getElementById('code-input').value;
        const sourceName = document.getElementById('source-name').value || 'unknown';
        
        if (!codeInput) {
            log('Please enter code to analyze.', 'error');
            return;
        }
        
        // Show progress bar
        const progressBar = document.getElementById('import-progress');
        const progressFill = document.getElementById('import-progress-fill');
        const progressText = document.getElementById('import-progress-text');
        progressBar.style.display = 'block';
        
        try {
            // Ingest code
            const result = await ingestCode(codeInput, sourceName, (progress) => {
                const percent = Math.round((progress.processedChunks / progress.totalChunks) * 100);
                progressFill.style.width = `${percent}%`;
                progressText.textContent = `${percent}% (${progress.processedChunks}/${progress.totalChunks} chunks)`;
            });
            
            if (result.success) {
                log(`Code imported successfully. Found ${result.unitsCount} units and ${result.dependenciesCount} dependencies.`, 'success');
                
                // Update units in select dropdown
                await updateUnitSelect();
            } else {
                log(`Error importing code: ${result.error}`, 'error');
            }
        } catch (error) {
            log(`Import error: ${error.message}`, 'error');
            console.error('Import error:', error);
        } finally {
            // Hide progress bar after delay
            setTimeout(() => {
                progressBar.style.display = 'none';
            }, 2000);
        }
    });
    
    // Clear database button
    document.getElementById('clear-db-btn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear the database? This action cannot be undone.')) {
            try {
                await clearStore('codeUnits');
                await clearStore('dependencies');
                log('Database cleared successfully.', 'success');
                
                // Update units in select dropdown
                await updateUnitSelect();
            } catch (error) {
                log(`Error clearing database: ${error.message}`, 'error');
            }
        }
    });
    
    // Run clustering button
    document.getElementById('run-clustering-btn').addEventListener('click', async () => {
        // Show progress bar
        const progressBar = document.getElementById('analysis-progress');
        const progressFill = document.getElementById('analysis-progress-fill');
        const progressText = document.getElementById('analysis-progress-text');
        progressBar.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = 'Starting...';
        
        try {
            // Run clustering algorithm
            progressFill.style.width = '50%';
            progressText.textContent = 'Clustering units...';
            
            const result = await clusterUnits();
            
            if (result.success) {
                log(`Clustering completed successfully. Created ${result.clusters} clusters for ${result.unitsUpdated} units.`, 'success');
                
                // Update units in select dropdown
                await updateUnitSelect();
            } else {
                log(`Error clustering units: ${result.error}`, 'error');
            }
            
            // Set progress to 100%
            progressFill.style.width = '100%';
            progressText.textContent = 'Complete';
        } catch (error) {
            log(`Clustering error: ${error.message}`, 'error');
            console.error('Clustering error:', error);
        } finally {
            // Hide progress bar after delay
            setTimeout(() => {
                progressBar.style.display = 'none';
            }, 2000);
        }
    });
    
    // View all units button
    document.getElementById('view-units-btn').addEventListener('click', async () => {
        try {
            const result = await handleAIRequest({ command: 'findUnits', query: '' });
            
            if (result.success) {
                // Display units
                const resultsDiv = document.getElementById('analysis-results');
                
                if (!result.units || result.units.length === 0) {
                    resultsDiv.innerHTML = '<p>No units found.</p>';
                    return;
                }
                
                let html = `<h3>All Units (${result.units.length})</h3>`;
                html += '<table style="width: 100%; border-collapse: collapse;">';
                html += '<tr><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">ID</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Name</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Type</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Cluster</th></tr>';
                
                result.units.forEach(unit => {
                    html += `<tr>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.id}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.name}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.type || 'unknown'}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.clusterId || 'unclustered'}</td>
                    </tr>`;
                });
                
                html += '</table>';
                resultsDiv.innerHTML = html;
            } else {
                log(`Error viewing units: ${result.error}`, 'error');
            }
        } catch (error) {
            log(`Error viewing units: ${error.message}`, 'error');
        }
    });
    
    // View clusters button
    document.getElementById('view-clusters-btn').addEventListener('click', async () => {
        try {
            const result = await handleAIRequest({ command: 'findUnits', query: '' });
            
            if (result.success) {
                // Group units by cluster
                const clusters = {};
                
                result.units.forEach(unit => {
                    const clusterId = unit.clusterId || 'unclustered';
                    
                    if (!clusters[clusterId]) {
                        clusters[clusterId] = [];
                    }
                    
                    clusters[clusterId].push(unit);
                });
                
                // Display clusters
                const resultsDiv = document.getElementById('analysis-results');
                
                if (Object.keys(clusters).length === 0) {
                    resultsDiv.innerHTML = '<p>No clusters found.</p>';
                    return;
                }
                
                let html = `<h3>Clusters (${Object.keys(clusters).length})</h3>`;
                
                Object.entries(clusters).forEach(([clusterId, units]) => {
                    html += `<div style="margin-bottom: 20px;">`;
                    html += `<h4>${clusterId} (${units.length} units)</h4>`;
                    html += '<table style="width: 100%; border-collapse: collapse;">';
                    html += '<tr><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">ID</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Name</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Type</th></tr>';
                    
                    units.forEach(unit => {
                        html += `<tr>
                            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.id}</td>
                            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.name}</td>
                            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${unit.type || 'unknown'}</td>
                        </tr>`;
                    });
                    
                    html += '</table>';
                    html += `</div>`;
                });
                
                resultsDiv.innerHTML = html;
            } else {
                log(`Error viewing clusters: ${result.error}`, 'error');
            }
        } catch (error) {
            log(`Error viewing clusters: ${error.message}`, 'error');
        }
    });
    
    // Run tests button
    document.getElementById('run-tests-btn').addEventListener('click', async () => {
        const unitId = document.getElementById('unit-select').value;
        
        if (!unitId) {
            log('Please select a unit to test.', 'error');
            return;
        }
        
        try {
            const result = await handleAIRequest({ command: 'runTests', id: unitId });
            
            if (result.success) {
                // Display test results
                const resultsDiv = document.getElementById('test-results');
                
                const testResults = result.testResults;
                let html = `<h3>Test Results for ${testResults.name} (${testResults.unitId})</h3>`;
                
                html += `<div style="margin-bottom: 10px; padding: 10px; background: ${testResults.summary.success ? '#e8f5e9' : '#ffebee'}; border-radius: 4px;">`;
                html += `<strong>Summary:</strong> ${testResults.summary.passed}/${testResults.summary.total} tests passed. `;
                html += `${testResults.summary.failed} failed. ${testResults.summary.errors || 0} errors.`;
                html += `</div>`;
                
                if (testResults.testResults && testResults.testResults.length > 0) {
                    testResults.testResults.forEach((test, index) => {
                        html += `<div style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px;">`;
                        html += `<h4>Test #${index + 1} (${test.testId})</h4>`;
                        
                        if (test.error) {
                            html += `<div style="color: #f44336; margin-bottom: 10px;"><strong>Error:</strong> ${test.error.message}</div>`;
                        }
                        
                        html += `<div><strong>Summary:</strong> ${test.summary.passed}/${test.summary.total} assertions passed.</div>`;
                        
                        if (test.results && test.results.length > 0) {
                            html += `<h5>Assertions:</h5>`;
                            html += `<ul>`;
                            
                            test.results.forEach(assertion => {
                                html += `<li style="color: ${assertion.passed ? '#4caf50' : '#f44336'};">`;
                                html += `<strong>${assertion.type}:</strong> ${assertion.message} `;
                                
                                if (!assertion.passed) {
                                    html += `(Expected: ${JSON.stringify(assertion.expected)}, Got: ${JSON.stringify(assertion.actual)})`;
                                }
                                
                                html += `</li>`;
                            });
                            
                            html += `</ul>`;
                        }
                        
                        html += `</div>`;
                    });
                } else {
                    html += `<p>${testResults.message || 'No test results available.'}</p>`;
                }
                
                resultsDiv.innerHTML = html;
            } else {
                log(`Error running tests: ${result.error}`, 'error');
            }
        } catch (error) {
            log(`Error running tests: ${error.message}`, 'error');
        }
    });
    
    // Add test button
    document.getElementById('add-test-btn').addEventListener('click', async () => {
        const unitId = document.getElementById('unit-select').value;
        const testCode = document.getElementById('test-code-input').value;
        
        if (!unitId) {
            log('Please select a unit to add a test for.', 'error');
            return;
        }
        
        if (!testCode) {
            log('Please enter test code.', 'error');
            return;
        }
        
        try {
            const result = await addTestToUnit(unitId, testCode);
            log(`Test added successfully. Unit now has ${result} tests.`, 'success');
            
            // Clear the test code input
            document.getElementById('test-code-input').value = '';
        } catch (error) {
            log(`Error adding test: ${error.message}`, 'error');
        }
    });
    
    // Execute AI command button
    document.getElementById('execute-command-btn').addEventListener('click', async () => {
        const commandInput = document.getElementById('ai-command-input').value;
        
        if (!commandInput) {
            log('Please enter an AI command.', 'error');
            return;
        }
        
        try {
            // Parse JSON command
            const command = JSON.parse(commandInput);
            
            // Execute command
            const result = await handleAIRequest(command);
            
            // Display result
            const resultsDiv = document.getElementById('ai-results');
            resultsDiv.innerHTML = `<h3>Command Result</h3><pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow: auto;">${JSON.stringify(result, null, 2)}</pre>`;
            
            log(`Command executed successfully.`, 'success');
            
            // Update pending updates display if needed
            if (command.command === 'proposeUpdate' || command.command === 'applyUpdate') {
                updatePendingUpdatesDisplay();
            }
        } catch (error) {
            log(`Error executing command: ${error.message}`, 'error');
        }
    });
}

// Update unit select dropdown
async function updateUnitSelect() {
    try {
        const result = await handleAIRequest({ command: 'findUnits', query: '' });
        
        if (result.success) {
            const select = document.getElementById('unit-select');
            select.innerHTML = '<option value="">Select a unit</option>';
            
            if (result.units && result.units.length > 0) {
                // Group units by cluster
                const clusters = {};
                
                result.units.forEach(unit => {
                    const clusterId = unit.clusterId || 'Unclustered';
                    
                    if (!clusters[clusterId]) {
                        clusters[clusterId] = [];
                    }
                    
                    clusters[clusterId].push(unit);
                });
                
                // Add options grouped by cluster
                Object.entries(clusters).forEach(([clusterId, units]) => {
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = clusterId;
                    
                    units.forEach(unit => {
                        const option = document.createElement('option');
                        option.value = unit.id;
                        option.textContent = unit.name;
                        optgroup.appendChild(option);
                    });
                    
                    select.appendChild(optgroup);
                });
            }
        }
    } catch (error) {
        console.error('Error updating unit select:', error);
    }
}

// Update pending updates display
function updatePendingUpdatesDisplay() {
    const pendingUpdatesDiv = document.getElementById('pending-updates');
    
    if (pendingUpdates.size === 0) {
        pendingUpdatesDiv.innerHTML = '<p>No pending updates.</p>';
        return;
    }
    
    let html = `<p>${pendingUpdates.size} pending updates:</p>`;
    html += '<table style="width: 100%; border-collapse: collapse;">';
    html += '<tr><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Unit ID</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Proposed At</th><th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Actions</th></tr>';
    
    pendingUpdates.forEach((update, key) => { // Changed unitId to key
        const proposedAtDate = new Date(update.proposedAt).toLocaleString();
        if (update.type === 'plan') {
            html += `<tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">Plan: ${update.planId}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${proposedAtDate}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">
                    <button onclick="window.viewPlanInConsole('${update.planId}')">View Plan (Console)</button>
                    <button onclick="window.rejectPlan('${update.planId}')">Reject Plan</button>
                </td>
            </tr>`;
        } else { // This is a single update (type 'single_update' or undefined)
            const unitId = key; // For single updates, the key from the map is the unitId
            html += `<tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">Unit ID: ${unitId}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${proposedAtDate}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">
                    <button onclick="window.applyPendingUpdate('${unitId}')">Apply</button>
                    <button onclick="window.rejectPendingUpdate('${unitId}')">Reject</button>
                </td>
            </tr>`;
        }
    });
    
    html += '</table>';
    pendingUpdatesDiv.innerHTML = html;
    
    // Add global functions for the buttons
    window.applyPendingUpdate = async (unitId) => {
        try {
            const result = await handleAIRequest({ command: 'applyUpdate', id: unitId });
            
            if (result.success) {
                log(`Update applied successfully for unit: ${unitId}`, 'success');
                updatePendingUpdatesDisplay();
            } else {
                log(`Error applying update: ${result.error}`, 'error');
            }
        } catch (error) {
            log(`Error applying update: ${error.message}`, 'error');
        }
    };
    
    window.rejectPendingUpdate = (unitId) => {
        pendingUpdates.delete(unitId);
        log(`Update rejected for unit: ${unitId}`, 'success');
        updatePendingUpdatesDisplay();
    };
}

// Log messages to the UI
function log(message, type = 'info') {
    const logContainer = document.getElementById('log-container');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    
    console.log(`[LOG/${type}] ${message}`);
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', initApp);