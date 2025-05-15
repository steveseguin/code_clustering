import { getUnit, putUnitsChunked } from './db.js';
import { loadAndExecute } from './codeLoader.js';

// Basic assertion functions
class Assertions {
    constructor() {
        this.results = [];
    }
    
    assertEqual(actual, expected, message = '') {
        const isEqual = actual === expected || 
            (JSON.stringify(actual) === JSON.stringify(expected));
        
        this.results.push({
            type: 'assertEqual',
            passed: isEqual,
            actual: actual,
            expected: expected,
            message: message || `Expected ${actual} to equal ${expected}`
        });
        
        return isEqual;
    }
    
    assertTrue(value, message = '') {
        const passed = Boolean(value);
        
        this.results.push({
            type: 'assertTrue',
            passed,
            actual: value,
            message: message || `Expected ${value} to be truthy`
        });
        
        return passed;
    }
    
    assertFalse(value, message = '') {
        const passed = !Boolean(value);
        
        this.results.push({
            type: 'assertFalse',
            passed,
            actual: value,
            message: message || `Expected ${value} to be falsy`
        });
        
        return passed;
    }
    
    assertThrows(fn, expectedError, message = '') {
        let passed = false;
        let actual = null;
        
        try {
            fn();
        } catch (error) {
            actual = error;
            
            if (expectedError) {
                if (typeof expectedError === 'string') {
                    passed = error.message.includes(expectedError);
                } else if (expectedError instanceof RegExp) {
                    passed = expectedError.test(error.message);
                } else if (typeof expectedError === 'function') {
                    passed = error instanceof expectedError;
                }
            } else {
                passed = true; // Just checking that it throws
            }
        }
        
        this.results.push({
            type: 'assertThrows',
            passed,
            actual: actual,
            expected: expectedError,
            message: message || `Expected function to throw${expectedError ? ` ${expectedError}` : ''}`
        });
        
        return passed;
    }
    
    getResults() {
        return this.results;
    }
    
    getSummary() {
        const total = this.results.length;
        const passed = this.results.filter(r => r.passed).length;
        
        return {
            total,
            passed,
            failed: total - passed,
            success: passed === total
        };
    }
}

// Add a test to a code unit
async function addTestToUnit(unitId, testCode) {
    const unit = await getUnit(unitId);
    if (!unit) {
        throw new Error(`Unit not found: ${unitId}`);
    }
    
    // Initialize metadata if not exists
    if (!unit.metadata) {
        unit.metadata = {};
    }
    
    // Add or update tests in metadata
    if (!unit.metadata.tests) {
        unit.metadata.tests = [];
    }
    
    unit.metadata.tests.push({
        id: `test_${Date.now()}`,
        code: testCode,
        createdAt: new Date().toISOString()
    });
    
    // Save the updated unit
    await putUnitsChunked([unit]);
    
    return unit.metadata.tests.length;
}

// Run tests for a unit
async function runTests(unitId) {
    const unit = await getUnit(unitId);
    if (!unit) {
        throw new Error(`Unit not found: ${unitId}`);
    }
    
    // Check if unit has tests
    if (!unit.metadata || !unit.metadata.tests || unit.metadata.tests.length === 0) {
        return {
            unitId,
            name: unit.name,
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                success: true
            },
            results: [],
            message: 'No tests found for this unit'
        };
    }
    
    const allResults = [];
    
    // Run each test
    for (const test of unit.metadata.tests) {
        const assertions = new Assertions();
        
        try {
            // Prepare test context with the unit code and assertions
            const context = {
                assertions,
                // Add other utilities if needed
            };
            
            // Load and execute the unit code first
            await loadAndExecute([unitId], context);
            
            // Execute the test code
            const testFn = new Function('assertions', test.code);
            testFn(assertions);
            
            // Collect test results
            const results = assertions.getResults();
            const summary = assertions.getSummary();
            
            allResults.push({
                testId: test.id,
                results,
                summary,
                error: null
            });
        } catch (error) {
            allResults.push({
                testId: test.id,
                results: assertions.getResults(),
                summary: assertions.getSummary(),
                error: {
                    message: error.message,
                    stack: error.stack
                }
            });
        }
    }
    
    // Calculate overall summary
    const summary = {
        total: allResults.reduce((sum, r) => sum + r.summary.total, 0),
        passed: allResults.reduce((sum, r) => sum + r.summary.passed, 0),
        failed: allResults.reduce((sum, r) => sum + r.summary.failed, 0),
        errors: allResults.filter(r => r.error).length
    };
    
    summary.success = summary.failed === 0 && summary.errors === 0;
    
    return {
        unitId,
        name: unit.name,
        summary,
        testResults: allResults
    };
}

export { Assertions, addTestToUnit, runTests };