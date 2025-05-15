
# Vanilla JS Componentization & AI Dev System

This project offers an AI-assisted code maintenance and enhancement tool design to manage and enhance large JavaScript codebases with AI assistance. 

Here's what the code does:

## Core Functionality

1. **Code Analysis & Componentization**
   - Takes a large monolithic JavaScript codebase as input
   - Breaks it down into smaller, manageable code units (primarily functions)
   - Identifies static dependencies between these units through code analysis
   - Tracks dynamic relationships between functions at runtime using function tracing

2. **Persistent Storage**
   - Stores all code units and their relationships in IndexedDB
   - Organizes units into logical clusters based on their dependencies and relationships
   - Provides efficient ways to query and retrieve code units and their metadata

3. **Dynamic Code Execution**
   - Loads specific code units on demand, resolving their dependencies automatically
   - Executes code within the browser, with appropriate safety measures
   - Supports tracing of runtime behavior to continually improve the system's understanding of code relationships

4. **Testing Framework**
   - Provides a simple unit testing system for individual code units
   - Stores test cases alongside code units in the database
   - Runs tests and reports results to verify code functionality

5. **AI Integration Interface**
   - Defines a clear API for AI agents to interact with the code units
   - Allows AI to query, analyze, and understand code structure
   - Enables AI to propose modifications to specific code units
   - Provides mechanisms for reviewing and applying AI-suggested changes

## Technical Implementation Details

- **Pure Browser Environment**: Everything runs client-side using only vanilla JavaScript and browser APIs
- **Asynchronous Processing**: Heavy tasks are offloaded to Web Workers to maintain UI responsiveness
- **Chunked Operations**: Large datasets are processed in chunks to avoid hitting browser limitations
- **Dependency Resolution**: Code units are loaded in the correct order based on their dependencies

## User Interface

The UI has four main sections:

1. **Import Code**: Allows pasting JavaScript code and ingesting it into the system
2. **Analysis**: Runs clustering algorithms and displays code units and their organization
3. **Testing**: Provides interfaces to create and run tests for individual code units
4. **AI Interface**: Allows manual interaction with the AI interface API and shows pending updates

## Data Flow

1. Original code is ingested via the static analyzer, which identifies functions and their dependencies
2. These code units are stored in IndexedDB with unique identifiers
3. The clustering algorithm groups related units together for better organization
4. Runtime tracing can be applied to gather information about dynamic relationships
5. AI agents can query the system, understand code structure, and propose targeted modifications
6. Users can review and apply these modifications, with testing to verify correctness

With these files in place, we've implemented a complete browser-based system for managing and facilitating AI-driven development of a large JavaScript application. Here's a summary of what we've built:

1. **Core Database System:** Using IndexedDB for persistent storage of code units and their relationships.

2. **Static Analysis:** A worker-based system that can parse JavaScript code to identify functions and their dependencies.

3. **Runtime Tracing:** A mechanism to track function calls during execution and record dynamic relationships.

4. **Code Clustering:** An algorithm to group related code units into manageable clusters.

5. **Dynamic Loading:** A system to resolve dependencies and load code units in the correct order for execution.

6. **Unit Testing:** A simple testing framework to verify code unit functionality.

7. **AI Interface:** An API for AI agents to retrieve, analyze, modify, and test code units.

8. **UI Components:** A user interface to import code, run analysis, perform testing, and interact with the AI interface.

To use this system:

1. Load the HTML page in a browser.
2. Import your JavaScript code by pasting it in the input field and clicking "Analyze & Import".
3. Run clustering to group related code units.
4. View the units and clusters to understand the code structure.
5. Add tests to verify code functionality.
6. Use the AI interface to propose and apply changes to the code.

This system is designed to be extensible. You can enhance it by:

1. Improving the static analyzer to handle more complex JavaScript patterns.
2. Enhancing the clustering algorithm for better code organization.
3. Implementing more robust sandboxing for code execution.
4. Adding visualization tools for code relationships.

All of this is implemented in vanilla JavaScript and runs entirely in the browser without any server-side dependencies.
