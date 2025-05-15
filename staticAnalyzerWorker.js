// This is a simplified static analyzer using a basic AST-like approach
// It aims to identify function definitions and their dependencies in JavaScript code

// Helper to find matching closing bracket
function findMatchingBracket(code, startPos, openBracket, closeBracket) {
    let depth = 1;
    let pos = startPos;
    
    while (pos < code.length && depth > 0) {
        if (code[pos] === openBracket) depth++;
        else if (code[pos] === closeBracket) depth--;
        pos++;
    }
    
    return depth === 0 ? pos - 1 : -1;
}

// Helper to extract function details
function extractFunction(code, startPos, type, lineOffset) {
    // Find function name or use anonymous if not found
    let nameMatch;
    if (type === 'function') {
        nameMatch = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
        nameMatch.lastIndex = startPos;
    } else if (type === 'arrow') {
        // Look backwards for variable assignment
        const beforeText = code.substring(Math.max(0, startPos - 100), startPos);
        nameMatch = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g.exec(beforeText);
    } else if (type === 'method') {
        nameMatch = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
        nameMatch.lastIndex = startPos;
    }
    
    const name = nameMatch && nameMatch[1] ? nameMatch[1] : 'anonymous';
    
    // Find opening bracket position
    const openBracketPos = code.indexOf('{', startPos);
    if (openBracketPos === -1) return null;
    
    // Find matching closing bracket
    const closeBracketPos = findMatchingBracket(code, openBracketPos + 1, '{', '}');
    if (closeBracketPos === -1) return null;
    
    // Extract the function body including brackets
    const functionBody = code.substring(openBracketPos, closeBracketPos + 1);
    
    // Count lines to calculate start and end lines
    const codeBeforeFunction = code.substring(0, openBracketPos);
    const startLine = lineOffset + (codeBeforeFunction.match(/\n/g) || []).length;
    const endLine = startLine + (functionBody.match(/\n/g) || []).length;
    
    // Simple extraction of function calls within the body
    const functionCalls = [];
    const callRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let callMatch;
    
    while ((callMatch = callRegex.exec(functionBody)) !== null) {
        if (callMatch[1] !== 'function' && 
            callMatch[1] !== 'if' && 
            callMatch[1] !== 'for' && 
            callMatch[1] !== 'while' && 
            callMatch[1] !== 'switch') {
            functionCalls.push(callMatch[1]);
        }
    }
    
    // Generate a simple ID
    const id = `func_${name}_${startLine}`;
    
    return {
        id,
        name,
        type: type,
        code: code.substring(startPos, closeBracketPos + 1),
        startLine,
        endLine,
        staticDependencies: functionCalls,
        originalSource: 'source', // This will be replaced with the actual filename
        dynamicRelationships: []
    };
}

// Main function to analyze code
function analyzeCode(codeChunk, lineOffset = 0) {
    const units = [];
    const dependencies = [];
    
    // Skip comment blocks and strings to avoid false positives
    // This is a simplified approach and might miss some edge cases
    let inSingleLineComment = false;
    let inMultiLineComment = false;
    let inString = false;
    let stringChar = '';
    
    // Process character by character to track state
    for (let i = 0; i < codeChunk.length; i++) {
        // Check for comments
        if (!inString) {
            if (codeChunk[i] === '/' && codeChunk[i+1] === '/') {
                inSingleLineComment = true;
                i++; // Skip the second slash
                continue;
            } else if (codeChunk[i] === '/' && codeChunk[i+1] === '*') {
                inMultiLineComment = true;
                i++; // Skip the star
                continue;
            } else if (inSingleLineComment && codeChunk[i] === '\n') {
                inSingleLineComment = false;
            } else if (inMultiLineComment && codeChunk[i] === '*' && codeChunk[i+1] === '/') {
                inMultiLineComment = false;
                i++; // Skip the slash
                continue;
            }
            
            if (inSingleLineComment || inMultiLineComment) {
                continue;
            }
        }
        
        // Check for strings
        if ((codeChunk[i] === '"' || codeChunk[i] === "'" || codeChunk[i] === '`') && 
            (i === 0 || codeChunk[i-1] !== '\\')) {
            if (!inString) {
                inString = true;
                stringChar = codeChunk[i];
            } else if (codeChunk[i] === stringChar) {
                inString = false;
            }
            continue;
        }
        
        if (inString) continue;
        
        // Find function declarations
        if (codeChunk.substring(i, i+8) === 'function') {
            const func = extractFunction(codeChunk, i, 'function', lineOffset);
            if (func) {
                units.push(func);
            }
        } 
        // Find arrow functions
        else if (codeChunk.substring(i, i+2) === '=>') {
            // Look backwards to find the beginning of the arrow function
            let j = i - 1;
            while (j >= 0 && /\s/.test(codeChunk[j])) j--; // Skip whitespace
            
            // If we find a closing parenthesis, find its matching opening parenthesis
            if (codeChunk[j] === ')') {
                const openParenPos = findMatchingBracket(codeChunk, j - 1, ')', '(');
                if (openParenPos !== -1) {
                    const func = extractFunction(codeChunk, openParenPos, 'arrow', lineOffset);
                    if (func) {
                        units.push(func);
                    }
                }
            }
        }
        // Find method definitions
        else if (i > 0 && codeChunk[i] === '(' && /[a-zA-Z_$]/.test(codeChunk[i-1])) {
            // Look backwards to find the beginning of the method name
            let j = i - 1;
            while (j >= 0 && /[a-zA-Z0-9_$]/.test(codeChunk[j])) j--;
            
            // If the character before the method name is a dot, it's a method call, not definition
            if (j >= 0 && codeChunk[j] !== '.') {
                const func = extractFunction(codeChunk, j + 1, 'method', lineOffset);
                if (func) {
                    units.push(func);
                }
            }
        }
    }
    
    // Create dependency relationships
    units.forEach(unit => {
        unit.staticDependencies.forEach(depName => {
            // Find the target unit by name
            const targetUnit = units.find(u => u.name === depName);
            if (targetUnit) {
                const depId = `dep_${unit.id}_${targetUnit.id}`;
                dependencies.push({
                    id: depId,
                    sourceId: unit.id,
                    targetId: targetUnit.id,
                    type: 'static'
                });
            }
        });
    });
    
    return { units, dependencies };
}

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
        processedLines: (codeChunk.match(/\n/g) || []).length + 1 
    });

    // Send results back
    self.postMessage({ type: 'complete', units: result.units, dependencies: result.dependencies });
};