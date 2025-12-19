/**
 * Extract all Scratch blocks from the scratch-vm codebase
 * This script parses all block definition files and generates a comprehensive JSON list
 */

const fs = require('fs');
const path = require('path');

// Block files to parse
const blockFiles = [
    'scratch3_control.js',
    'scratch3_event.js',
    'scratch3_looks.js',
    'scratch3_motion.js',
    'scratch3_operators.js',
    'scratch3_sound.js',
    'scratch3_sensing.js',
    'scratch3_data.js',
    'scratch3_procedures.js'
];

const blocksDir = path.join(__dirname, 'node_modules/scratch-vm/src/blocks');
const scratchBlocksDir = path.join(__dirname, 'node_modules/scratch-blocks/blocks_vertical');
const allBlocks = [];

// Block type definitions
const blockTypes = {
    COMMAND: 'command',
    REPORTER: 'reporter',
    BOOLEAN: 'boolean',
    HAT: 'hat',
    CONDITIONAL: 'conditional',
    LOOP: 'loop'
};

// Category mapping based on file names
const categoryMapping = {
    scratch3_control: 'control',
    scratch3_event: 'events',
    scratch3_looks: 'looks',
    scratch3_motion: 'motion',
    scratch3_operators: 'operators',
    scratch3_sound: 'sound',
    scratch3_sensing: 'sensing',
    scratch3_data: 'data',
    scratch3_procedures: 'procedures'
};

// Scratch-blocks file mapping
const scratchBlocksFileMapping = {
    control: 'control.js',
    events: 'event.js',
    looks: 'looks.js',
    motion: 'motion.js',
    operators: 'operators.js',
    sound: 'sound.js',
    sensing: 'sensing.js',
    data: 'data.js',
    procedures: 'procedures.js'
};

// Parse each block file
blockFiles.forEach(filename => {
    const filePath = path.join(blocksDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const baseName = filename.replace('.js', '');
    const category = categoryMapping[baseName] || baseName;

    // Extract primitives (regular blocks)
    const primitivesMatch = content.match(/getPrimitives\s*\(\s*\)\s*{[^}]*return\s*{([^}]+)}/s);
    if (primitivesMatch) {
        const primitivesContent = primitivesMatch[1];
        const blockMatches = primitivesContent.matchAll(/(\w+):\s*this\.(\w+)/g);

        for (const match of blockMatches) {
            const opcode = match[1];
            const functionName = match[2];

            allBlocks.push({
                opcode,
                category,
                type: guessBlockType(opcode, category),
                functionName,
                source: 'primitives'
            });
        }
    }

    // Extract hat blocks (event handlers)
    const hatsMatch = content.match(/getHats\s*\(\s*\)\s*{[^}]*return\s*{([^}]+)}/s);
    if (hatsMatch) {
        const hatsContent = hatsMatch[1];
        const hatMatches = hatsContent.matchAll(/(\w+):\s*{/g);

        for (const match of hatMatches) {
            const opcode = match[1];

            allBlocks.push({
                opcode,
                category,
                type: 'hat',
                functionName: null,
                source: 'hats'
            });
        }
    }

    // Extract monitored blocks (reporters that can show on stage)
    const monitoredMatch = content.match(/getMonitored\s*\(\s*\)\s*{[^}]*return\s*{([^}]+)}/s);
    if (monitoredMatch) {
        const monitoredContent = monitoredMatch[1];
        const monitorMatches = monitoredContent.matchAll(/(\w+):\s*{/g);

        for (const match of monitorMatches) {
            const opcode = match[1];

            // Check if already exists in primitives
            const existingBlock = allBlocks.find(b => b.opcode === opcode);
            if (existingBlock) {
                existingBlock.canMonitor = true;
            }
        }
    }
});

// Guess block type based on opcode naming patterns and category
function guessBlockType(opcode, category) {
    // Hat blocks (event handlers)
    if (opcode.startsWith('event_when') || opcode.includes('_start_')) {
        return 'hat';
    }

    // Boolean reporters (return true/false)
    if (opcode.includes('touching') || opcode.includes('_is') ||
        opcode.includes('_on_') || opcode.includes('keyPressed') ||
        opcode.includes('mousedown')) {
        return 'boolean';
    }

    // Reporters (return values)
    if (category === 'motion' && (opcode.includes('position') || opcode.includes('direction'))) {
        return 'reporter';
    }
    if (category === 'looks' && (opcode.includes('number') || opcode.includes('name') || opcode.includes('size'))) {
        return 'reporter';
    }
    if (category === 'sound' && (opcode.includes('volume') || opcode.includes('tempo'))) {
        return 'reporter';
    }
    if (category === 'sensing' && (opcode.includes('_of') || opcode.includes('answer') ||
        opcode.includes('mouse') || opcode.includes('loudness') || opcode.includes('timer') ||
        opcode.includes('username') || opcode.includes('current') || opcode.includes('days'))) {
        return 'reporter';
    }
    if (category === 'operators') {
        if (opcode.includes('equals') || opcode.includes('_gt') || opcode.includes('_lt') ||
            opcode.includes('_and') || opcode.includes('_or') || opcode.includes('_not') ||
            opcode.includes('contains')) {
            return 'boolean';
        }
        return 'reporter';
    }

    // Control flow blocks
    if (opcode.includes('repeat') || opcode.includes('forever') || opcode.includes('while') ||
        opcode.includes('for_each')) {
        return 'loop';
    }
    if (opcode.includes('_if')) {
        return 'conditional';
    }

    // Default to command block
    return 'command';
}

// Parse scratch-blocks files to extract dropdown information
function parseDropdownsFromScratchBlocks(category) {
    const filename = scratchBlocksFileMapping[category];
    if (!filename) return {};

    const filePath = path.join(scratchBlocksDir, filename);
    if (!fs.existsSync(filePath)) return {};

    const content = fs.readFileSync(filePath, 'utf8');
    const dropdownInfo = {};

    // Match block definitions with Blockly.Blocks['opcode'] = {...}
    // Need to capture the entire block definition including nested braces
    const blockPattern = /Blockly\.Blocks\['(\w+)'\]\s*=\s*\{([\s\S]*?)(?=\nBlockly\.Blocks\[|$)/g;
    const blockMatches = content.matchAll(blockPattern);

    for (const match of blockMatches) {
        const opcode = match[1];
        const blockContent = match[2];

        // Check if this block has a field_dropdown
        if (!blockContent.includes('field_dropdown')) continue;

        // Extract the jsonInit call
        const jsonInitMatch = blockContent.match(/this\.jsonInit\(\s*\{([\s\S]*?)\}\s*\);/);
        if (!jsonInitMatch) continue;

        const jsonInitContent = jsonInitMatch[1];

        // Look for field_dropdown definitions
        // Match the entire field_dropdown object
        const fieldPattern = /\{\s*"type":\s*"field_dropdown"\s*,\s*"name":\s*"(\w+)"\s*,\s*"options":\s*\[([\s\S]*?)\]\s*\}/g;
        const fieldMatches = jsonInitContent.matchAll(fieldPattern);

        const dropdowns = [];
        for (const fieldMatch of fieldMatches) {
            const fieldName = fieldMatch[1];
            const optionsContent = fieldMatch[2];

            // Parse options - they are in format: [label, value]
            const options = [];
            const optionPattern = /\[\s*([^,\[\]]+)\s*,\s*([^\[\]]+?)\s*\]/g;
            const optionMatches = optionsContent.matchAll(optionPattern);

            for (const optionMatch of optionMatches) {
                let label = optionMatch[1].trim();
                let value = optionMatch[2].trim();

                // Clean up quotes and Blockly.Msg references
                label = label.replace(/^['"]|['"]$/g, '').replace(/Blockly\.Msg\./, '');
                value = value.replace(/^['"]|['"]$/g, '');

                options.push({ label, value });
            }

            if (options.length > 0) {
                dropdowns.push({
                    fieldName,
                    options
                });
            }
        }

        if (dropdowns.length > 0) {
            dropdownInfo[opcode] = dropdowns;
        }
    }

    return dropdownInfo;
}

// Extract dropdown information for all categories
const allDropdownInfo = {};
const menuBlocks = []; // Track menu-only blocks (not in VM primitives)

Object.keys(scratchBlocksFileMapping).forEach(category => {
    const dropdowns = parseDropdownsFromScratchBlocks(category);

    // Check which blocks with dropdowns are not already in allBlocks
    Object.keys(dropdowns).forEach(opcode => {
        const existingBlock = allBlocks.find(b => b.opcode === opcode);
        if (!existingBlock) {
            // This is a menu block not in VM primitives
            menuBlocks.push({
                opcode,
                category,
                type: 'menu',
                functionName: null,
                source: 'scratch-blocks-menu',
                dropdowns: dropdowns[opcode],
                hasDropdown: true
            });
        }
    });

    Object.assign(allDropdownInfo, dropdowns);
});

// Add menu blocks to the main blocks array
allBlocks.push(...menuBlocks);

// Add dropdown information to existing blocks
allBlocks.forEach(block => {
    if (!block.hasDropdown && allDropdownInfo[block.opcode]) {
        block.dropdowns = allDropdownInfo[block.opcode];
        block.hasDropdown = true;
    }
});

// Load human-readable labels from opcode-labels.js
const opcodeLabelsPath = path.join(__dirname, 'src/lib/opcode-labels.js');
if (fs.existsSync(opcodeLabelsPath)) {
    const labelsContent = fs.readFileSync(opcodeLabelsPath, 'utf8');

    // Extract labels from the messages object
    const labelMatches = labelsContent.matchAll(/(\w+):\s*{\s*defaultMessage:\s*['"]([^'"]+)['"]/g);
    const labelMap = {};

    for (const match of labelMatches) {
        labelMap[match[1]] = match[2];
    }

    // Add labels to blocks
    allBlocks.forEach(block => {
        if (labelMap[block.opcode]) {
            block.label = labelMap[block.opcode];
        }
    });
}

// Sort blocks by category and opcode
allBlocks.sort((a, b) => {
    if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
    }
    return a.opcode.localeCompare(b.opcode);
});

// Generate output
const output = {
    metadata: {
        generatedAt: new Date().toISOString(),
        totalBlocks: allBlocks.length,
        blocksWithDropdowns: allBlocks.filter(b => b.hasDropdown).length,
        categories: [...new Set(allBlocks.map(b => b.category))].sort()
    },
    blocks: allBlocks
};

// Group blocks by category for easier reference
const blocksByCategory = {};
allBlocks.forEach(block => {
    if (!blocksByCategory[block.category]) {
        blocksByCategory[block.category] = [];
    }
    blocksByCategory[block.category].push(block);
});
output.blocksByCategory = blocksByCategory;

// Write to JSON file
const outputPath = path.join(__dirname, 'scratch-blocks-list.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`\n✓ Successfully extracted ${allBlocks.length} Scratch blocks`);
console.log(`✓ Blocks with dropdowns: ${output.metadata.blocksWithDropdowns}`);
console.log(`✓ Output written to: ${outputPath}\n`);
console.log('Categories found:');
output.metadata.categories.forEach(cat => {
    const count = blocksByCategory[cat].length;
    const withDropdowns = blocksByCategory[cat].filter(b => b.hasDropdown).length;
    console.log(`  - ${cat}: ${count} blocks (${withDropdowns} with dropdowns)`);
});
console.log('');
