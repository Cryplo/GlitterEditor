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
    }
    getProjectState () {
        // Get the project JSON from the VM
        try {
            const projectJson = this.props.vm.toJSON();
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

            // Apply each operation using the proper Blocks API methods
            for (const operation of patchOperations) {
                console.log('Applying operation:', operation);
                this.applyBlockOperation(targetSprite.blocks, operation);
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

    applyBlockOperation (blocks, operation) {
        // Apply a single RFC 6902 operation using the Blocks API
        const {op, path, value} = operation;
        const {deserializeBlocks} = require('scratch-vm/src/serialization/sb3');

        if (!op || !path) {
            throw new Error('Operation must have "op" and "path" properties');
        }

        const pathParts = this.parsePath(path);
        console.log(`Block operation: ${op}, Path: ${path}, Parts:`, pathParts);

        // The first part of the path should be the block ID
        const blockId = pathParts[0];

        if (!blockId) {
            throw new Error('Path must include a block ID');
        }

        switch (op) {
            case 'add':
                if (pathParts.length === 1) {
                    // Adding a new block: path is just "/blockId"
                    // Value should be the full block data
                    // Deserialize the block first (converts compressed SB3 format to full format)
                    const blocksToDeserialize = {[blockId]: {...value}};
                    deserializeBlocks(blocksToDeserialize);
                    const blockData = {...blocksToDeserialize[blockId], id: blockId};
                    console.log(`Creating block ${blockId}:`, blockData);
                    blocks.createBlock(blockData);
                } else {
                    // Modifying a property within an existing block
                    // Fall back to direct object manipulation for nested properties
                    this.applyOperation(blocks._blocks, operation);
                }
                break;

            case 'remove':
                if (pathParts.length === 1) {
                    // Removing an entire block: path is just "/blockId"
                    console.log(`Deleting block ${blockId}`);
                    blocks.deleteBlock(blockId);
                } else {
                    // Removing a property within a block
                    this.applyOperation(blocks._blocks, operation);
                }
                break;

            case 'replace':
                if (pathParts.length === 1) {
                    // Replacing an entire block: delete then create
                    // Deserialize the block first (converts compressed SB3 format to full format)
                    const blocksToDeserialize = {[blockId]: {...value}};
                    deserializeBlocks(blocksToDeserialize);
                    const blockData = {...blocksToDeserialize[blockId], id: blockId};
                    console.log(`Replacing block ${blockId}:`, blockData);
                    blocks.deleteBlock(blockId);
                    blocks.createBlock(blockData);
                } else {
                    // Replacing a property within a block
                    this.applyOperation(blocks._blocks, operation);
                }
                break;

            case 'move':
            case 'copy':
            case 'test':
                // For these operations, fall back to direct object manipulation
                this.applyOperation(blocks._blocks, operation);
                break;

            default:
                throw new Error(`Unknown operation: ${op}`);
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
    onRequestCloseTelemetryModal: () => dispatch(closeTelemetryModal())
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
