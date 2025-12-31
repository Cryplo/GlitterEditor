import PropTypes from 'prop-types';
import React from 'react';
import {compose} from 'redux';
import {connect} from 'react-redux';
import ReactModal from 'react-modal';
import VM from 'scratch-vm';
import {injectIntl, intlShape} from 'react-intl';

import ErrorBoundaryHOC from '../lib/error-boundary-hoc.jsx';
import {
    getIsError,
    getIsShowingProject
} from '../reducers/project-state';
import {
    activateTab,
    BLOCKS_TAB_INDEX,
    COSTUMES_TAB_INDEX,
    SOUNDS_TAB_INDEX
} from '../reducers/editor-tab';

import {selectLocale} from '../reducers/locales';

import {
    closeCostumeLibrary,
    closeBackdropLibrary,
    closeTelemetryModal,
    openExtensionLibrary
} from '../reducers/modals';

import FontLoaderHOC from '../lib/font-loader-hoc.jsx';
import LocalizationHOC from '../lib/localization-hoc.jsx';
import SBFileUploaderHOC from '../lib/sb-file-uploader-hoc.jsx';
import ProjectFetcherHOC from '../lib/project-fetcher-hoc.jsx';
import TitledHOC from '../lib/titled-hoc.jsx';
import ProjectSaverHOC from '../lib/project-saver-hoc.jsx';
import storage from '../lib/storage';
import vmListenerHOC from '../lib/vm-listener-hoc.jsx';
import vmManagerHOC from '../lib/vm-manager-hoc.jsx';
import cloudManagerHOC from '../lib/cloud-manager-hoc.jsx';

import GUIComponent from '../components/gui/gui.jsx';
import {setIsScratchDesktop} from '../lib/isScratchDesktop.js';
import TWFullScreenResizerHOC from '../lib/tw-fullscreen-resizer-hoc.jsx';
import TWThemeManagerHOC from './tw-theme-manager-hoc.jsx';

const {RequestMetadata, setMetadata, unsetMetadata} = storage.scratchFetch;

const setProjectIdMetadata = projectId => {
    // If project ID is '0' or zero, it's not a real project ID. In that case, remove the project ID metadata.
    // Same if it's null undefined.
    if (projectId && projectId !== '0') {
        setMetadata(RequestMetadata.ProjectId, projectId);
    } else {
        unsetMetadata(RequestMetadata.ProjectId);
    }
};

class GUI extends React.Component {
    constructor (props) {
        super(props);
        this.handlePostMessage = this.handlePostMessage.bind(this);
    }
    componentDidMount () {
        setIsScratchDesktop(this.props.isScratchDesktop);
        this.props.onStorageInit(storage);
        this.props.onVmInit(this.props.vm);
        setProjectIdMetadata(this.props.projectId);

        // Listen for project state requests from parent window (GlitterCode)
        window.addEventListener('message', this.handlePostMessage);
    }
    componentWillUnmount () {
        window.removeEventListener('message', this.handlePostMessage);
    }
    handlePostMessage (event) {
        console.log('[GlitterEditor] Received postMessage:', event.data);

        // Handle GET_PROJECT_STATE request from GlitterCode
        if (event.data?.type === 'GET_PROJECT_STATE') {
            const requestId = event.data.requestId;
            console.log('[GlitterEditor] GET_PROJECT_STATE request, ID:', requestId);

            // Get project state from VM
            const projectState = this.props.vm ? this.getProjectState() : null;

            // Send response back to parent
            if (event.source) {
                event.source.postMessage({
                    type: 'PROJECT_STATE_RESPONSE',
                    requestId: requestId,
                    state: projectState
                }, event.origin);
                console.log('[GlitterEditor] Sent PROJECT_STATE_RESPONSE');
            }
        }

        // Handle GLITTER_APPLY_PATCH from GlitterCode (for applying agent changes)
        if (event.data?.type === 'APPLY_PATCH') {
            const requestId = event.data.requestId;
            console.log('[GlitterEditor] APPLY_PATCH received, ID:', requestId);
            const patch = event.data.patch;
            console.log('[GlitterEditor] Patch data:', patch);
            this.applyPatch(patch);
            // Send response back to parent
            if (event.source) {
                event.source.postMessage({
                    type: 'APPLY_PATCH_RESPONSE',
                    requestId: requestId,
                }, event.origin);
                console.log('[GlitterEditor] Sent APPLY_PATCH_RESPONSE');
            }
        }

        if (event.data?.type === 'SYNC_STATE') {
            const requestId = event.data.requestId;
            console.log('[GlitterEditor] SYNC_STATE received, ID:', requestId);
            const state = event.data.state;
            console.log('[GlitterEditor] State data:', state);
            this.syncState(state);
            // Send response back to parent
            if (event.source) {
                event.source.postMessage({
                    type: 'SYNC_STATE_RESPONSE',
                    requestId: requestId,
                }, event.origin);
                console.log('[GlitterEditor] Sent SYNC_STATE_RESPONSE');
            }
        }

        if (event.data?.type === 'APPLY_JSON_PATCH') {
            const requestId = event.data.requestId;
            console.log('[GlitterEditor] APPLY_JSON_PATCH received, ID:', requestId);
            const patch = event.data.patch;
            console.log('[GlitterEditor] JSON Patch data:', patch);

            if (patch && patch.action === 'applyJSONPatch' && patch.spriteName && patch.operations) {
                this.applyJSONPatch(patch.spriteName, patch.operations);
            } else {
                console.error('[GlitterEditor] Invalid patch format. Expected: { action: "applyJSONPatch", spriteName: string, operations: array }');
            }

            // Send response back to parent
            if (event.source) {
                event.source.postMessage({
                    type: 'APPLY_JSON_PATCH_RESPONSE',
                    requestId: requestId,
                }, event.origin);
                console.log('[GlitterEditor] Sent APPLY_JSON_PATCH_RESPONSE');
            }
        }

        if (event.data?.type === 'GLITTER_LOAD_PROJECT') {
            const projectData = event.data.projectData;
            const name = event.data.fileName;
            this.loadProject(projectData);
        }

        // Handle HIGHLIGHT_BLOCK - highlight a block in the toolbox/flyout by opcode
        if (event.data?.type === 'HIGHLIGHT_BLOCK') {
            const opcode = event.data.opcode;
            console.log('[GlitterEditor] HIGHLIGHT_BLOCK received, opcode:', opcode);
            this.highlightBlockInFlyout(opcode);
        }

        // Handle DEHIGHLIGHT_BLOCK - remove highlight from blocks in the toolbox/flyout
        if (event.data?.type === 'DEHIGHLIGHT_BLOCK') {
            const opcode = event.data.opcode;
            console.log('[GlitterEditor] DEHIGHLIGHT_BLOCK received, opcode:', opcode);
            this.dehighlightBlockInFlyout(opcode);
        }

        // Handle CHANGE_LANGUAGE - change the editor's language
        if (event.data?.type === 'CHANGE_LANGUAGE') {
            const requestId = event.data.requestId;
            const locale = event.data.locale;
            console.log('[GlitterEditor] CHANGE_LANGUAGE received, locale:', locale);

            if (locale) {
                // Dispatch the locale change through Redux
                if (this.props.onChangeLanguage) {
                    this.props.onChangeLanguage(locale);
                    console.log('[GlitterEditor] Dispatched selectLocale action');
                }
                // Update the document's lang attribute (for accessibility and CSS selectors)
                document.documentElement.lang = locale;

                // Also update the VM's locale directly to ensure blocks update
                if (this.props.vm) {
                    const messages = window.ReduxStore?.getState()?.locales?.messagesByLocale?.[locale];
                    if (messages) {
                        this.props.vm.setLocale(locale, messages).then(() => {
                            this.props.vm.refreshWorkspace();
                            console.log('[GlitterEditor] VM locale updated and workspace refreshed');
                        });
                    }
                }

                console.log('[GlitterEditor] Language changed to:', locale);
            }

            // Send response back to parent
            if (event.source) {
                event.source.postMessage({
                    type: 'CHANGE_LANGUAGE_RESPONSE',
                    requestId: requestId,
                    locale: locale
                }, event.origin);
                console.log('[GlitterEditor] Sent CHANGE_LANGUAGE_RESPONSE');
            }
        }
    }
    getProjectState () {
        // Get the project JSON from the VM
        try {
            const projectJson = this.props.vm.toJSON(null, { allowOptimization: false });
            return JSON.stringify(projectJson);
        } catch (error) {
            console.error('Error getting project state:', error);
            return null;
        }
    }
    applyPatch (patch) {
        // Apply a patch to update a single sprite
        try {
            if (!this.props.vm) {
                console.error('VM not available for patching');
                return;
            }

            console.log('Applying patch:', patch);

            // Handle single sprite update
            if (patch.action === 'updateSpriteBlocks' && patch.spriteName && patch.blocks) {
                const spriteName = patch.spriteName;
                const blocks = patch.blocks

                // Find the target sprite in the VM
                const runtime = this.props.vm.runtime;
                const targetSprite = runtime.targets.find(target =>
                    !target.isStage && target.sprite.name === spriteName
                );

                if (!targetSprite) {
                    console.error(`Sprite "${spriteName}" not found in project`);
                    return;
                }

                console.log(`Found target sprite: ${targetSprite.sprite.name}`);
                console.log(`Target sprite object:`, targetSprite);
                console.log(`Current blocks:`, targetSprite.blocks);
                console.log(`Current block count:`, Object.keys(targetSprite.blocks._blocks).length);
                console.log(`New blocks to apply:`, blocks);
                console.log(`New block count:`, Object.keys(blocks).length);

                // Update the sprite's blocks
                if (blocks) {
                    // Import the deserializeBlocks function from sb3
                    const {deserializeBlocks} = require('scratch-vm/src/serialization/sb3');

                    // Clear existing blocks first
                    const existingBlockIds = Object.keys(targetSprite.blocks._blocks);
                    console.log(`Deleting ${existingBlockIds.length} existing blocks:`, existingBlockIds);
                    existingBlockIds.forEach(blockId => {
                        targetSprite.blocks.deleteBlock(blockId);
                    });

                    // Deserialize the blocks (converts compressed format to full format)
                    console.log(`Deserializing blocks...`);
                    const deserializedBlocks = deserializeBlocks(blocks);
                    console.log(`Deserialized blocks:`, deserializedBlocks);

                    // Add new blocks - need to use createBlock for each one
                    console.log(`Adding deserialized blocks...`);
                    for (const blockId in deserializedBlocks) {
                        const blockData = deserializedBlocks[blockId];
                        console.log(`Creating block ${blockId}:`, blockData);

                        // The ID is already in blockData from deserialization
                        targetSprite.blocks.createBlock(blockData);
                    }

                    console.log(`Updated blocks for sprite "${spriteName}"`);
                    console.log(`Blocks after update:`, targetSprite.blocks);
                    console.log(`Block count after update:`, Object.keys(targetSprite.blocks._blocks).length);
                    console.log(`Block IDs after update:`, Object.keys(targetSprite.blocks._blocks));
                }

                // Update the sprite's variables
                /*
                if (spriteData.variables) {
                    Object.entries(spriteData.variables).forEach(([id, variable]) => {
                        targetSprite.createVariable(id, variable[0], variable[1]);
                    });
                    console.log(`Updated variables for sprite "${spriteName}"`);
                }*/

                // Update the sprite's lists
                /*if (spriteData.lists) {
                    Object.entries(spriteData.lists).forEach(([id, list]) => {
                        targetSprite.createList(id, list[0], list[1]);
                    });
                    console.log(`Updated lists for sprite "${spriteName}"`);
                }*/

                // Switch to the updated sprite to see the changes
                const spriteIndex = this.props.vm.runtime.targets.indexOf(targetSprite);
                console.log(`Setting editing target to sprite index: ${spriteIndex}`);
                this.props.vm.setEditingTarget(targetSprite.id);

                // Refresh the workspace - emit updates to trigger UI refresh
                console.log(`Emitting targets update...`);
                this.props.vm.emitTargetsUpdate();
                console.log(`Emitting workspace update...`);
                this.props.vm.emitWorkspaceUpdate();
                console.log(`Successfully updated sprite "${spriteName}"`);

                // Force a refresh by requesting blocks update
                console.log(`Requesting blocks update from workspace...`);
                this.props.vm.runtime.requestBlocksUpdate();
                console.log(`Patch application complete!`);
            } else {
                console.error('Invalid patch format. Expected action: "updateSprite"');
            }
        } catch (error) {
            console.error('Error applying patch:', error);
        }
    }

    syncState (state){
       const sb3 = require('scratch-vm/src/serialization/sb3'); 
       // Directly load the JSON project data
        // Convert JSON to binary format first
        const projectJson = JSON.stringify(state);
        const projectData = new TextEncoder().encode(projectJson);

        this.props.vm.loadProject(projectData.buffer);

        // Refresh UI
        this.props.vm.emitWorkspaceUpdate();
        this.props.vm.runtime.requestBlocksUpdate();
       /*
       const projectData = sb3.serialize(state);

       this.props.vm.loadProject(projectData);

       this.props.vm.emitWorkspaceUpdate();
       this.props.vm.runtime.requestBlocksUpdate();*/
    }

    applyJSONPatch (spriteName, patchOperations) {
        // Apply RFC 6902 JSON Patch operations to a specific sprite's blocks
        try {
            if (!this.props.vm) {
                console.error('VM not available for patching');
                return;
            }

            console.log(`Applying RFC 6902 JSON Patch to sprite "${spriteName}":`, patchOperations);

            // Ensure patch is an array
            if (!Array.isArray(patchOperations)) {
                console.error('Invalid patch format. Expected an array of operations');
                return;
            }

            // Find the target sprite in the VM runtime
            const runtime = this.props.vm.runtime;
            const targetSprite = runtime.targets.find(target =>
                !target.isStage && target.sprite.name === spriteName
            );

            if (!targetSprite) {
                console.error(`Sprite "${spriteName}" not found in project`);
                return;
            }

            console.log(`Found target sprite: ${targetSprite.sprite.name}`);
            console.log(`Current blocks:`, targetSprite.blocks);
            console.log(`Current block count:`, Object.keys(targetSprite.blocks._blocks).length);

            const {deserializeBlocks} = require('scratch-vm/src/serialization/sb3');

            // First pass: collect all blocks to add/replace and process removals
            const blocksToAdd = {};
            const blocksToRemove = [];
            const otherOperations = [];

            for (const operation of patchOperations) {
                const {op, path, value} = operation;
                const pathParts = this.parsePath(path);
                const blockId = pathParts[0];

                if (pathParts.length === 1) {
                    // Whole-block operation
                    if (op === 'add') {
                        blocksToAdd[blockId] = {...value};
                    } else if (op === 'remove') {
                        blocksToRemove.push(blockId);
                    } else if (op === 'replace') {
                        blocksToRemove.push(blockId);
                        blocksToAdd[blockId] = {...value};
                    }
                } else {
                    // Nested property operation - handle later
                    otherOperations.push(operation);
                }
            }

            // Remove blocks first
            console.log(`Deleting ${blocksToRemove.length} blocks:`, blocksToRemove);
            blocksToRemove.forEach(blockId => {
                targetSprite.blocks.deleteBlock(blockId);
            });

            // Deserialize all blocks together (so references between blocks are resolved)
            console.log(`Deserializing ${Object.keys(blocksToAdd).length} blocks...`);
            deserializeBlocks(blocksToAdd);
            console.log(`Deserialized blocks:`, blocksToAdd);

            // Create all the deserialized blocks
            console.log(`Creating blocks...`);
            for (const blockId in blocksToAdd) {
                const blockData = {...blocksToAdd[blockId], id: blockId};
                console.log(`Creating block ${blockId}:`, blockData);
                targetSprite.blocks.createBlock(blockData);
            }

            // Apply any nested property operations
            for (const operation of otherOperations) {
                console.log('Applying nested operation:', operation);
                this.applyOperation(targetSprite.blocks._blocks, operation);
            }

            console.log(`Blocks after patching:`, targetSprite.blocks._blocks);
            console.log(`Block count after patching:`, Object.keys(targetSprite.blocks._blocks).length);

            // Switch to the updated sprite to see the changes
            const spriteIndex = this.props.vm.runtime.targets.indexOf(targetSprite);
            console.log(`Setting editing target to sprite index: ${spriteIndex}`);
            this.props.vm.setEditingTarget(targetSprite.id);

            // Refresh the workspace - emit updates to trigger UI refresh
            console.log(`Emitting targets update...`);
            this.props.vm.emitTargetsUpdate();
            console.log(`Emitting workspace update...`);
            this.props.vm.emitWorkspaceUpdate();
            console.log(`Requesting blocks update from workspace...`);
            this.props.vm.runtime.requestBlocksUpdate();

            console.log(`Successfully applied JSON patch to sprite "${spriteName}"`);

        } catch (error) {
            console.error('Error applying JSON patch:', error);
        }
    }

    applyOperation (obj, operation) {
        // Apply a single RFC 6902 operation to the object
        const {op, path, value, from} = operation;

        if (!op || !path) {
            throw new Error('Operation must have "op" and "path" properties');
        }

        const pathParts = this.parsePath(path);
        console.log(`Operation: ${op}, Path: ${path}, Parts:`, pathParts);

        switch (op) {
            case 'add':
                this.opAdd(obj, pathParts, value);
                break;
            case 'remove':
                this.opRemove(obj, pathParts);
                break;
            case 'replace':
                this.opReplace(obj, pathParts, value);
                break;
            case 'move':
                if (!from) throw new Error('Move operation requires "from" property');
                const fromParts = this.parsePath(from);
                const movedValue = this.getValue(obj, fromParts);
                this.opRemove(obj, fromParts);
                this.opAdd(obj, pathParts, movedValue);
                break;
            case 'copy':
                if (!from) throw new Error('Copy operation requires "from" property');
                const fromPartsCopy = this.parsePath(from);
                const copiedValue = this.getValue(obj, fromPartsCopy);
                this.opAdd(obj, pathParts, copiedValue);
                break;
            case 'test':
                const testValue = this.getValue(obj, pathParts);
                if (JSON.stringify(testValue) !== JSON.stringify(value)) {
                    throw new Error(`Test failed at path ${path}`);
                }
                break;
            default:
                throw new Error(`Unknown operation: ${op}`);
        }
    }

    parsePath (path) {
        // Parse JSON Pointer path (RFC 6901)
        if (path === '') return [];
        if (!path.startsWith('/')) {
            throw new Error('Path must start with /');
        }
        return path.substring(1).split('/').map(part => {
            // Unescape special characters
            return part.replace(/~1/g, '/').replace(/~0/g, '~');
        });
    }

    getValue (obj, pathParts) {
        // Navigate to the value at the given path
        let current = obj;
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            if (current === null || current === undefined) {
                throw new Error(`Cannot read property at path: ${pathParts.slice(0, i + 1).join('/')}`);
            }
            current = current[part];
        }
        return current;
    }

    opAdd (obj, pathParts, value) {
        // Add operation: adds a value at the specified path
        if (pathParts.length === 0) {
            throw new Error('Cannot add to root');
        }

        const parentPath = pathParts.slice(0, -1);
        const key = pathParts[pathParts.length - 1];
        const parent = this.getValue(obj, parentPath);

        if (parent === null || parent === undefined) {
            throw new Error(`Cannot add to non-existent path: ${parentPath.join('/')}`);
        }

        if (Array.isArray(parent)) {
            if (key === '-') {
                parent.push(value);
            } else {
                const index = parseInt(key, 10);
                parent.splice(index, 0, value);
            }
        } else {
            parent[key] = value;
        }
        console.log(`Added value at ${pathParts.join('/')}`);
    }

    opRemove (obj, pathParts) {
        // Remove operation: removes the value at the specified path
        if (pathParts.length === 0) {
            throw new Error('Cannot remove root');
        }

        const parentPath = pathParts.slice(0, -1);
        const key = pathParts[pathParts.length - 1];
        const parent = this.getValue(obj, parentPath);

        if (parent === null || parent === undefined) {
            throw new Error(`Cannot remove from non-existent path: ${parentPath.join('/')}`);
        }

        if (Array.isArray(parent)) {
            const index = parseInt(key, 10);
            parent.splice(index, 1);
        } else {
            delete parent[key];
        }
        console.log(`Removed value at ${pathParts.join('/')}`);
    }

    opReplace (obj, pathParts, value) {
        // Replace operation: replaces the value at the specified path
        if (pathParts.length === 0) {
            throw new Error('Cannot replace root');
        }

        const parentPath = pathParts.slice(0, -1);
        const key = pathParts[pathParts.length - 1];
        const parent = this.getValue(obj, parentPath);

        if (parent === null || parent === undefined) {
            throw new Error(`Cannot replace at non-existent path: ${parentPath.join('/')}`);
        }

        parent[key] = value;
        console.log(`Replaced value at ${pathParts.join('/')}`);
    }

    loadProject (projectData) {
        var binaryString = atob(projectData);
        var bytes = new Uint8Array(binaryString.length);
        for (var i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        this.props.vm.loadProject(bytes.buffer);
    }

    // Store for tracking highlighted blocks
    _highlightedBlocks = new Map(); // opcode -> { block, originalFill, flashTimer }

    highlightBlockInFlyout (opcode) {
        try {
            // Get the Blockly workspace
            const workspace = window.Blockly?.getMainWorkspace();
            if (!workspace) {
                console.error('[GlitterEditor] Blockly workspace not available');
                return;
            }

            // Access toolbox_ directly (internal property)
            const toolbox = workspace.toolbox_;
            if (!toolbox) {
                console.error('[GlitterEditor] Toolbox not available');
                return;
            }

            const flyout = workspace.getFlyout();
            if (!flyout) {
                console.error('[GlitterEditor] Flyout not available');
                return;
            }

            // Get the category from the opcode (e.g., 'motion_movesteps' -> 'motion')
            const category = opcode.split('_')[0];

            // Map opcode prefixes to category IDs used in the toolbox
            const categoryMap = {
                'motion': 'motion',
                'looks': 'looks',
                'sound': 'sounds',
                'event': 'events',
                'control': 'control',
                'sensing': 'sensing',
                'operator': 'operators',
                'data': 'data',
                'procedures': 'myBlocks',
                'pen': 'pen'
            };

            const categoryId = categoryMap[category] || category;

            // Select the appropriate category to show the block in the flyout
            console.log(`[GlitterEditor] Selecting category: ${categoryId}`);
            toolbox.setSelectedCategoryById(categoryId);

            // Refresh the toolbox selection to ensure flyout is updated
            workspace.refreshToolboxSelection_();

            // Wait a bit for the flyout to update, then find and highlight the block
            setTimeout(() => {
                const flyoutWorkspace = flyout.getWorkspace();
                if (!flyoutWorkspace) {
                    console.error('[GlitterEditor] Flyout workspace not available');
                    return;
                }

                // Find the block with the matching opcode in the flyout
                const allBlocks = flyoutWorkspace.getAllBlocks();
                console.log(`[GlitterEditor] All blocks in flyout:`, allBlocks.map(b => b.type));
                let targetBlock = null;

                for (const block of allBlocks) {
                    if (block.type === opcode) {
                        targetBlock = block;
                        break;
                    }
                }

                if (!targetBlock) {
                    console.warn(`[GlitterEditor] Block with opcode "${opcode}" not found in flyout`);
                    return;
                }

                console.log(`[GlitterEditor] Found block:`, targetBlock);

                // Scroll the block into view within the flyout
                this.scrollBlockIntoViewInFlyout(flyout, targetBlock);

                // Highlight the block with a flashing effect
                this.flashBlock(targetBlock, opcode);

            }, 150); // Small delay to let the flyout render

        } catch (error) {
            console.error('[GlitterEditor] Error highlighting block:', error);
        }
    }

    scrollBlockIntoViewInFlyout (flyout, block) {
        try {
            // Get the block's position
            const blockPos = block.getRelativeToSurfaceXY();
            const flyoutWorkspace = flyout.getWorkspace();
            const metrics = flyoutWorkspace.getMetrics();

            // Calculate the scroll position to center the block
            const scrollX = 0; // Flyout typically only scrolls vertically
            const scrollY = blockPos.y - (metrics.viewHeight / 2) + (block.height / 2);

            // Use the flyout's scrollbar to scroll to the position
            if (flyout.scrollbar_) {
                flyout.scrollbar_.set(scrollX, Math.max(0, scrollY));
            }

            console.log(`[GlitterEditor] Scrolled flyout to block at y=${blockPos.y}`);
        } catch (error) {
            console.error('[GlitterEditor] Error scrolling to block:', error);
        }
    }

    flashBlock (block, opcode) {
        // Clear any existing highlight for this opcode
        if (this._highlightedBlocks.has(opcode)) {
            const existing = this._highlightedBlocks.get(opcode);
            if (existing.flashTimer) {
                clearTimeout(existing.flashTimer);
            }
            // Remove glow filter
            if (existing.block?.svgPath_) {
                existing.block.svgPath_.style.filter = '';
            }
        }

        // Ensure the purple glow filter exists in the SVG
        this.ensureGlowFilter();

        // Flash the block with a purple glow
        let flashOn = true;
        let count = 6; // 3 complete flashes

        const doFlash = () => {
            if (block.svgPath_) {
                block.svgPath_.style.filter = flashOn ? 'url(#glitterGoldenGlow)' : '';
            }
            flashOn = !flashOn;
            count--;

            if (count > 0) {
                const timer = setTimeout(doFlash, 200);
                this._highlightedBlocks.set(opcode, {
                    block,
                    flashTimer: timer
                });
            } else {
                // After flashing, keep the glow
                if (block.svgPath_) {
                    block.svgPath_.style.filter = 'url(#glitterGoldenGlow)';
                }
                this._highlightedBlocks.set(opcode, {
                    block,
                    flashTimer: null
                });
            }
        };

        doFlash();
    }

    ensureGlowFilter () {
        // Check if the filter already exists
        if (document.getElementById('glitterGoldenGlow')) {
            return;
        }

        // Find an SVG element to add the filter to (use the workspace SVG)
        const workspaceSvg = document.querySelector('.blocklySvg');
        if (!workspaceSvg) {
            console.error('[GlitterEditor] Could not find workspace SVG for glow filter');
            return;
        }

        // Check if defs exists, create if not
        let defs = workspaceSvg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            workspaceSvg.insertBefore(defs, workspaceSvg.firstChild);
        }

        // Create the purple glow filter
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'glitterGoldenGlow');
        filter.setAttribute('x', '-50%');
        filter.setAttribute('y', '-50%');
        filter.setAttribute('width', '200%');
        filter.setAttribute('height', '200%');

        // Gaussian blur for the glow (very thick for maximum visibility)
        const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
        feGaussianBlur.setAttribute('in', 'SourceGraphic');
        feGaussianBlur.setAttribute('stdDeviation', '12');
        feGaussianBlur.setAttribute('result', 'blur');

        // Color the glow #ffd166 (golden yellow) with high intensity
        const feColorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
        feColorMatrix.setAttribute('in', 'blur');
        feColorMatrix.setAttribute('type', 'matrix');
        feColorMatrix.setAttribute('values', '0 0 0 0 1  0 0 0 0 0.82  0 0 0 0 0.4  0 0 0 2.5 0'); // #ffd166 color with increased alpha
        feColorMatrix.setAttribute('result', 'glow');

        // Composite to intensify the glow
        const feComposite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
        feComposite.setAttribute('in', 'glow');
        feComposite.setAttribute('in2', 'glow');
        feComposite.setAttribute('operator', 'over');
        feComposite.setAttribute('result', 'glowIntense');

        // Merge the intense glow with the original
        const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
        const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        feMergeNode1.setAttribute('in', 'glowIntense');
        const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        feMergeNode2.setAttribute('in', 'SourceGraphic');
        feMerge.appendChild(feMergeNode1);
        feMerge.appendChild(feMergeNode2);

        filter.appendChild(feGaussianBlur);
        filter.appendChild(feColorMatrix);
        filter.appendChild(feComposite);
        filter.appendChild(feMerge);
        defs.appendChild(filter);

        console.log('[GlitterEditor] Created golden glow filter (#ffd166)');
    }

    dehighlightBlockInFlyout (opcode) {
        try {
            if (opcode) {
                // Dehighlight a specific block
                if (this._highlightedBlocks.has(opcode)) {
                    const highlighted = this._highlightedBlocks.get(opcode);
                    if (highlighted.flashTimer) {
                        clearTimeout(highlighted.flashTimer);
                    }
                    if (highlighted.block?.svgPath_) {
                        highlighted.block.svgPath_.style.filter = '';
                    }
                    this._highlightedBlocks.delete(opcode);
                    console.log(`[GlitterEditor] Dehighlighted block: ${opcode}`);
                }
            } else {
                // Dehighlight all blocks
                for (const highlighted of this._highlightedBlocks.values()) {
                    if (highlighted.flashTimer) {
                        clearTimeout(highlighted.flashTimer);
                    }
                    if (highlighted.block?.svgPath_) {
                        highlighted.block.svgPath_.style.filter = '';
                    }
                }
                this._highlightedBlocks.clear();
                console.log('[GlitterEditor] Dehighlighted all blocks');
            }
        } catch (error) {
            console.error('[GlitterEditor] Error dehighlighting block:', error);
        }
    }

    componentDidUpdate (prevProps) {
        if (this.props.projectId !== prevProps.projectId) {
            if (this.props.projectId !== null) {
                this.props.onUpdateProjectId(this.props.projectId);
            }
            setProjectIdMetadata(this.props.projectId);
        }
        if (this.props.isShowingProject && !prevProps.isShowingProject) {
            // this only notifies container when a project changes from not yet loaded to loaded
            // At this time the project view in www doesn't need to know when a project is unloaded
            this.props.onProjectLoaded();
        }
    }
    render () {
        if (this.props.isError) {
            throw this.props.error;
        }
        const {
            /* eslint-disable no-unused-vars */
            assetHost,
            cloudHost,
            error,
            isError,
            isScratchDesktop,
            isShowingProject,
            onProjectLoaded,
            onStorageInit,
            onUpdateProjectId,
            onVmInit,
            projectHost,
            projectId,
            /* eslint-enable no-unused-vars */
            children,
            fetchingProject,
            isLoading,
            loadingStateVisible,
            ...componentProps
        } = this.props;
        return (
            <GUIComponent
                loading={fetchingProject || isLoading || loadingStateVisible}
                {...componentProps}
            >
                {children}
            </GUIComponent>
        );
    }
}

GUI.propTypes = {
    assetHost: PropTypes.string,
    children: PropTypes.node,
    cloudHost: PropTypes.string,
    error: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    fetchingProject: PropTypes.bool,
    intl: intlShape,
    isError: PropTypes.bool,
    isEmbedded: PropTypes.bool,
    isFullScreen: PropTypes.bool,
    isLoading: PropTypes.bool,
    isScratchDesktop: PropTypes.bool,
    isShowingProject: PropTypes.bool,
    isTotallyNormal: PropTypes.bool,
    loadingStateVisible: PropTypes.bool,
    onChangeLanguage: PropTypes.func,
    onProjectLoaded: PropTypes.func,
    onSeeCommunity: PropTypes.func,
    onStorageInit: PropTypes.func,
    onUpdateProjectId: PropTypes.func,
    onVmInit: PropTypes.func,
    projectHost: PropTypes.string,
    projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    telemetryModalVisible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};

GUI.defaultProps = {
    isScratchDesktop: false,
    isTotallyNormal: false,
    onStorageInit: storageInstance => storageInstance.addOfficialScratchWebStores(),
    onProjectLoaded: () => {},
    onUpdateProjectId: () => {},
    onVmInit: (/* vm */) => {}
};

const mapStateToProps = state => {
    const loadingState = state.scratchGui.projectState.loadingState;
    return {
        activeTabIndex: state.scratchGui.editorTab.activeTabIndex,
        alertsVisible: state.scratchGui.alerts.visible,
        backdropLibraryVisible: state.scratchGui.modals.backdropLibrary,
        blocksTabVisible: state.scratchGui.editorTab.activeTabIndex === BLOCKS_TAB_INDEX,
        cardsVisible: state.scratchGui.cards.visible,
        connectionModalVisible: state.scratchGui.modals.connectionModal,
        costumeLibraryVisible: state.scratchGui.modals.costumeLibrary,
        costumesTabVisible: state.scratchGui.editorTab.activeTabIndex === COSTUMES_TAB_INDEX,
        error: state.scratchGui.projectState.error,
        isError: getIsError(loadingState),
        isEmbedded: state.scratchGui.mode.isEmbedded,
        isFullScreen: state.scratchGui.mode.isFullScreen || state.scratchGui.mode.isEmbedded,
        isPlayerOnly: state.scratchGui.mode.isPlayerOnly,
        isRtl: state.locales.isRtl,
        isShowingProject: getIsShowingProject(loadingState),
        loadingStateVisible: state.scratchGui.modals.loadingProject,
        projectId: state.scratchGui.projectState.projectId,
        soundsTabVisible: state.scratchGui.editorTab.activeTabIndex === SOUNDS_TAB_INDEX,
        targetIsStage: (
            state.scratchGui.targets.stage &&
            state.scratchGui.targets.stage.id === state.scratchGui.targets.editingTarget
        ),
        telemetryModalVisible: state.scratchGui.modals.telemetryModal,
        tipsLibraryVisible: state.scratchGui.modals.tipsLibrary,
        usernameModalVisible: state.scratchGui.modals.usernameModal,
        settingsModalVisible: state.scratchGui.modals.settingsModal,
        customExtensionModalVisible: state.scratchGui.modals.customExtensionModal,
        fontsModalVisible: state.scratchGui.modals.fontsModal,
        unknownPlatformModalVisible: state.scratchGui.modals.unknownPlatformModal,
        invalidProjectModalVisible: state.scratchGui.modals.invalidProjectModal,
        vm: state.scratchGui.vm
    };
};

const mapDispatchToProps = dispatch => ({
    onExtensionButtonClick: () => dispatch(openExtensionLibrary()),
    onActivateTab: tab => dispatch(activateTab(tab)),
    onActivateCostumesTab: () => dispatch(activateTab(COSTUMES_TAB_INDEX)),
    onActivateSoundsTab: () => dispatch(activateTab(SOUNDS_TAB_INDEX)),
    onRequestCloseBackdropLibrary: () => dispatch(closeBackdropLibrary()),
    onRequestCloseCostumeLibrary: () => dispatch(closeCostumeLibrary()),
    onRequestCloseTelemetryModal: () => dispatch(closeTelemetryModal()),
    onChangeLanguage: locale => dispatch(selectLocale(locale))
});

const ConnectedGUI = injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(GUI));

// note that redux's 'compose' function is just being used as a general utility to make
// the hierarchy of HOC constructor calls clearer here; it has nothing to do with redux's
// ability to compose reducers.
const WrappedGui = compose(
    LocalizationHOC,
    ErrorBoundaryHOC('Top Level App'),
    TWThemeManagerHOC, // componentDidUpdate() needs to run very early for icons to update immediately
    TWFullScreenResizerHOC,
    FontLoaderHOC,
    // QueryParserHOC, // tw: HOC is unused
    ProjectFetcherHOC,
    TitledHOC,
    ProjectSaverHOC,
    vmListenerHOC,
    vmManagerHOC,
    SBFileUploaderHOC,
    cloudManagerHOC
)(ConnectedGUI);

WrappedGui.setAppElement = ReactModal.setAppElement;
export default WrappedGui;
