import { state } from './state.js';

// --- Releases & Versions ---

export async function fetchReleases() {
    try {
        const response = await fetch('/api/releases');
        if (response.ok) {
            state.availableReleases = await response.json();
            console.log("Available releases loaded:", state.availableReleases);
            return state.availableReleases;
        } else {
            console.error('Failed to fetch releases');
            return {};
        }
    } catch (error) {
        console.error('Error fetching releases:', error);
        return {};
    }
}

export async function fetchServerVersions() {
    try {
        const response = await fetch('/api/server/versions');
        if (response.ok) {
            const data = await response.json();
            state.serverInstalledVersions = data.installed || [];
            return state.serverInstalledVersions;
        }
    } catch (error) {
        console.error('Error fetching server versions:', error);
    }
    return [];
}

// --- Configuration ---

export async function fetchClientConfigs() {
    try {
        const response = await fetch('/api/config/clients');
        if (response.ok) {
            const data = await response.json();
            state.savedClientConfigs = data.client_configs || {};
            console.log("Client configs loaded:", state.savedClientConfigs);
            return state.savedClientConfigs;
        }
    } catch (error) {
        console.error('Error fetching client configs:', error);
    }
    return {};
}

export async function loadConfig() {
    try {
        const response = await fetch('/api/config/models_path');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return {};
}

export async function saveConfig(modelsPath) {
    try {
        const response = await fetch('/api/config/models_path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ models_path: modelsPath })
        });
        return response.ok;
    } catch (error) {
        console.error('Error saving config:', error);
        return false;
    }
}

export async function loadOrchestratorConfig() {
    try {
        const response = await fetch('/api/config/orchestrator_version');
        if (response.ok) {
            const data = await response.json();
            if (data.orchestrator_version) {
                state.savedOrchestratorVersion = data.orchestrator_version;
            }
            return data;
        }
    } catch (error) {
        console.error('Error loading orchestrator config:', error);
    }
    return {};
}

export async function saveOrchestratorConfig(versionTag) {
    try {
        await fetch('/api/config/orchestrator_version', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orchestrator_version: versionTag })
        });
        state.savedOrchestratorVersion = versionTag;
    } catch (error) {
        console.error('Error saving orchestrator config:', error);
    }
}

export async function loadOrchestratorPort() {
    try {
        const response = await fetch('/api/config/orchestrator_port');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error loading orchestrator port:', error);
    }
    return {};
}

export async function saveOrchestratorPort(port) {
    try {
        await fetch('/api/config/orchestrator_port', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orchestrator_port: port })
        });
    } catch (error) {
        console.error('Error saving orchestrator port:', error);
    }
}

export async function saveClientConfig(nodeId, versionTag) {
    try {
        await fetch(`/api/config/client/${nodeId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version_tag: versionTag })
        });
        state.savedClientConfigs[nodeId] = { version_tag: versionTag };
    } catch (error) {
        console.error(`Error saving config for client ${nodeId}:`, error);
    }
}

export async function loadLastSelectedModel() {
    try {
        const response = await fetch('/api/config/last_model');
        if (response.ok) {
            const data = await response.json();
            return data.last_selected_model;
        }
    } catch (error) {
        console.error('Error loading last selected model:', error);
    }
    return "";
}

export async function saveLastSelectedModel(modelPath) {
    try {
        await fetch('/api/config/last_model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model_path: modelPath })
        });
    } catch (error) {
        console.error('Error saving last selected model:', error);
    }
}

// --- Presets ---

export async function fetchPresets(modelPath) {
    try {
        const encodedModel = encodeURIComponent(modelPath);
        const response = await fetch(`/api/config/presets?model=${encodedModel}`);
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error fetching presets:', error);
    }
    return { presets: {} };
}

export async function savePreset(modelPath, presetName, settings) {
    try {
        const response = await fetch('/api/config/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelPath,
                preset_name: presetName,
                settings: settings
            })
        });
        return response.ok;
    } catch (error) {
        console.error('Error saving preset:', error);
        return false;
    }
}

// --- Models ---

export async function fetchModels() {
    try {
        const response = await fetch('/api/models');
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error fetching models:', error);
    }
    return { models: [] };
}

// --- Commands ---

export async function sendCommand(nodeId, commandData) {
    try {
        const response = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId, command: commandData })
        });
        return await response.json();
    } catch (error) {
        console.error('Error sending command:', error);
        return { error: error.toString() };
    }
}

export async function sendUpdateCommand(nodeId, url, versionTag) {
    const command = {
        type: "UPDATE_BINARY",
        url: url,
        version_tag: versionTag
    };

    // Send command to agent
    await sendCommand(nodeId, command);

    // Save preference
    await saveClientConfig(nodeId, versionTag);
}

export async function startRpc(nodeId, versionTag, port) {
    const command = {
        type: "START_RPC",
        version_tag: versionTag,
        port: port
    };
    return await sendCommand(nodeId, command);
}

export async function stopRpc(nodeId) {
    const command = { type: "STOP_RPC" };
    return await sendCommand(nodeId, command);
}

// --- Server / Orchestrator Actions ---

export async function updateServerBinary(url, versionTag) {
    try {
        const response = await fetch('/api/server/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, version_tag: versionTag })
        });
        return response.ok;
    } catch (error) {
        console.error("Error starting server update:", error);
        return false;
    }
}

export async function startOrchestratorProcess(modelPath, versionTag, port, launchParams) {
    try {
        const response = await fetch('/api/orchestrator/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_path: modelPath,
                version_tag: versionTag,
                port: port,
                launch_params: launchParams
            })
        });
        return await response.json();
    } catch (error) {
        console.error("Error starting orchestrator:", error);
        return { error: error.toString() };
    }
}

export async function stopOrchestratorProcess() {
    try {
        const response = await fetch('/api/orchestrator/stop', { method: 'POST' });
        return await response.json();
    } catch (error) {
        console.error("Error stopping orchestrator:", error);
        return { error: error.toString() };
    }
}

export async function getOrchestratorStatus() {
    try {
        const response = await fetch('/api/orchestrator/status');
        return await response.json();
    } catch (error) {
        console.error("Error fetching orchestrator status:", error);
        return { error: error.toString() };
    }
}

export async function getServerUpdateStatus() {
    try {
        const response = await fetch('/api/server/status');
        return await response.json();
    } catch (error) {
        console.error("Error fetching server update status:", error);
        return { error: error.toString() };
    }
}
