const socket = io();
const nodeCharts = {}; // Store Chart.js instances: { node_id: Chart }
const MAX_DATA_POINTS = 30;
let availableReleases = {};
// Store installed versions per node to refresh selects when releases arrive
const nodeInstalledVersions = {};
let serverInstalledVersions = [];
let savedOrchestratorVersion = "";
let savedClientConfigs = {};

// --- Page Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    fetchReleases();
    loadConfig(); // Load models path and scan
    loadOrchestratorConfig(); // Load saved orchestrator version
    loadOrchestratorPort(); // Load saved orchestrator port
    fetchClientConfigs(); // Load saved client configs
    checkEmptyState();

    // Poll orchestrator status
    setInterval(updateOrchestratorStatus, 3000);
    updateOrchestratorStatus(); // Initial call
});

function copyToClipboard(text, element) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = element.innerText;
        element.innerText = "Copied!";
        element.classList.add("text-green-400");
        setTimeout(() => {
            element.innerText = originalText;
            element.classList.remove("text-green-400");
        }, 1500);
    }).catch(err => {
        console.error("Failed to copy text: ", err);
    });
}

async function fetchReleases() {
    try {
        const response = await fetch('/api/releases');
        if (response.ok) {
            availableReleases = await response.json();
            console.log("Available releases loaded:", availableReleases);

            // Refresh all existing selects now that we have data
            document.querySelectorAll('select[id^="select-"]').forEach(select => {
                const nodeId = select.id.replace('select-', '');
                populateSelect(nodeId, nodeInstalledVersions[nodeId] || []);
            });

            // Fetch server versions and populate main select
            fetchServerVersions();
        } else {
            console.error('Failed to fetch releases');
        }
    } catch (error) {
        console.error('Error fetching releases:', error);
    }
}

async function fetchServerVersions() {
    try {
        const response = await fetch('/api/server/versions');
        if (response.ok) {
            const data = await response.json();
            serverInstalledVersions = data.installed || [];
            populateServerSelect();
        }
    } catch (error) {
        console.error('Error fetching server versions:', error);
    }
}

async function fetchClientConfigs() {
    try {
        const response = await fetch('/api/config/clients');
        if (response.ok) {
            const data = await response.json();
            savedClientConfigs = data.client_configs || {};
            console.log("Client configs loaded:", savedClientConfigs);
        }
    } catch (error) {
        console.error('Error fetching client configs:', error);
    }
}

function populateServerSelect() {
    const select = document.getElementById('main-version-select');
    if (!select) return;

    if (Object.keys(availableReleases).length === 0) return;

    // Save current selection if user changed it, otherwise use saved config
    const currentSelection = select.value;
    select.innerHTML = '';

    for (const releaseTag in availableReleases) {
        const release = availableReleases[releaseTag];
        for (const backendKey in release.backends) {
            const backend = release.backends[backendKey];
            const versionTag = `${release.tag_name}_${backendKey}`;

            const option = document.createElement('option');
            option.value = JSON.stringify({ url: backend.url, version_tag: versionTag });

            let text = `Llama ${release.tag_name} (${backendKey})`;
            if (serverInstalledVersions.includes(versionTag)) {
                text += ' ✅ (Installed)';
            }
            option.textContent = text;
            select.appendChild(option);
        }
    }

    // Restore selection logic
    if (currentSelection && select.querySelector(`option[value='${currentSelection}']`)) {
        select.value = currentSelection;
    } else if (savedOrchestratorVersion) {
        for (const option of select.options) {
            try {
                const val = JSON.parse(option.value);
                if (val.version_tag === savedOrchestratorVersion) {
                    select.value = option.value;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!select.value && select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

async function installServerVersion() {
    const select = document.getElementById('main-version-select');
    if (!select || !select.value) {
        alert("Please select a version first.");
        return;
    }

    const selectedData = JSON.parse(select.value);

    try {
        // 1. Start Update
        const updateResponse = await fetch('/api/server/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: selectedData.url,
                version_tag: selectedData.version_tag
            })
        });

        if (updateResponse.ok) {
            console.log("Server update started");

            // 2. Save Configuration
            await fetch('/api/config/orchestrator_version', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orchestrator_version: selectedData.version_tag })
            });

            // Update local saved state
            savedOrchestratorVersion = selectedData.version_tag;

            // Save Port as well
            saveOrchestratorPort();

        } else {
            alert("Failed to start server update.");
        }
    } catch (error) {
        console.error("Error starting server update:", error);
    }
}

async function loadConfig() {
    try {
        const response = await fetch('/api/config/models_path');
        if (response.ok) {
            const data = await response.json();
            const pathInput = document.getElementById('models-path-input');
            if (data.models_path) {
                pathInput.value = data.models_path;
                fetchModels(); // Scan if path exists
            }
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

async function loadOrchestratorConfig() {
    try {
        const response = await fetch('/api/config/orchestrator_version');
        if (response.ok) {
            const data = await response.json();
            if (data.orchestrator_version) {
                savedOrchestratorVersion = data.orchestrator_version;
                // Try to update select if it's already populated
                populateServerSelect();
            }
        }
    } catch (error) {
        console.error('Error loading orchestrator config:', error);
    }
}

async function loadOrchestratorPort() {
    try {
        const response = await fetch('/api/config/orchestrator_port');
        if (response.ok) {
            const data = await response.json();
            if (data.orchestrator_port) {
                document.getElementById('orchestrator-port-input').value = data.orchestrator_port;
            }
        }
    } catch (error) {
        console.error('Error loading orchestrator port:', error);
    }
}

async function saveOrchestratorPort() {
    const portInput = document.getElementById('orchestrator-port-input');
    const port = parseInt(portInput.value);

    if (!port) return;

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

async function saveConfigAndScan() {
    const pathInput = document.getElementById('models-path-input');
    const newPath = pathInput.value;

    if (!newPath) {
        alert("Please enter a valid path.");
        return;
    }

    const btn = document.getElementById('scan-models-btn');
    const originalText = btn.textContent;
    btn.textContent = "Scanning...";
    btn.disabled = true;

    try {
        // Save config
        const saveResponse = await fetch('/api/config/models_path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ models_path: newPath })
        });

        if (saveResponse.ok) {
            // Scan models
            await fetchModels();
        } else {
            alert("Failed to save configuration.");
        }
    } catch (error) {
        console.error('Error saving config:', error);
        alert("Error saving configuration.");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function fetchModels() {
    const select = document.getElementById('main-model-select');
    select.innerHTML = '<option>Scanning...</option>';
    select.disabled = true;

    try {
        const response = await fetch('/api/models');
        if (response.ok) {
            const data = await response.json();
            select.innerHTML = ''; // Clear

            if (data.models && data.models.length > 0) {
                // Sort models by name
                data.models.sort((a, b) => a.name.localeCompare(b.name));

                // Add default option
                const defaultOption = document.createElement('option');
                defaultOption.text = "Select a model...";
                defaultOption.value = "";
                defaultOption.disabled = true;
                defaultOption.selected = true;
                select.appendChild(defaultOption);

                data.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.absolute_path;
                    option.text = `[${model.size_gb} GB] ${model.relative_path}`;
                    select.appendChild(option);
                });
            } else {
                const option = document.createElement('option');
                option.text = "No .gguf models found in directory";
                select.appendChild(option);
            }
        } else {
            select.innerHTML = '<option>Error scanning models</option>';
        }
    } catch (error) {
        console.error('Error fetching models:', error);
        select.innerHTML = '<option>Error fetching models</option>';
    } finally {
        select.disabled = false;
    }
}

function checkEmptyState() {
    const grid = document.getElementById('node-grid');
    const emptyState = document.getElementById('empty-state');
    if (grid.children.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
    }
}

// --- Orchestrator Functions ---
async function startOrchestrator() {
    const modelPath = document.getElementById('main-model-select').value;
    const versionSelect = document.getElementById('main-version-select');
    const portInput = document.getElementById('orchestrator-port-input');

    if (!modelPath) {
        alert("Please select a model first.");
        return;
    }
    if (!versionSelect || !versionSelect.value) {
        alert("Please select an orchestrator version.");
        return;
    }

    const port = parseInt(portInput.value) || 8080;
    const versionData = JSON.parse(versionSelect.value);

    try {
        const response = await fetch('/api/orchestrator/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_path: modelPath,
                version_tag: versionData.version_tag,
                port: port
            })
        });
        const data = await response.json();
        console.log("Start orchestrator response:", data);
        updateOrchestratorStatus(); // Immediately update status
    } catch (error) {
        console.error("Error starting orchestrator:", error);
    }
}

async function stopOrchestrator() {
    try {
        const response = await fetch('/api/orchestrator/stop', { method: 'POST' });
        const data = await response.json();
        console.log("Stop orchestrator response:", data);
        updateOrchestratorStatus(); // Immediately update status
    } catch (error) {
        console.error("Error stopping orchestrator:", error);
    }
}

async function updateOrchestratorStatus() {
    // 1. Check Orchestrator Process Status
    try {
        const response = await fetch('/api/orchestrator/status');
        const data = await response.json();
        const statusText = document.getElementById('orchestrator-status-text');
        const logsDiv = document.getElementById('orchestrator-logs');

        if (data.state === 'READY') {
            // Ready state
            const host = window.location.hostname;
            const port = data.port;
            statusText.innerHTML = `✅ Ready! <a href="http://${host}:${port}" target="_blank" class="text-blue-400 underline ml-2">Web UI</a> | API: <code class="bg-gray-900 p-1 rounded text-xs ml-1 cursor-pointer hover:bg-gray-700" onclick="copyToClipboard('http://${host}:${port}/v1', this)">http://${host}:${port}/v1</code>`;
            statusText.className = 'text-green-400 font-bold flex items-center';
            logsDiv.classList.add('hidden');
        } else if (data.state === 'LOADING') {
            // Loading state
            statusText.textContent = `Loading Model... (PID: ${data.pid})`;
            statusText.className = 'text-yellow-400 font-bold animate-pulse';

            // Show logs
            logsDiv.classList.remove('hidden');
            if (data.logs && data.logs.length > 0) {
                logsDiv.innerHTML = data.logs.join('<br>');
                logsDiv.scrollTop = logsDiv.scrollHeight;
            }
        } else {
            // Stopped state
            statusText.textContent = 'Stopped';
            statusText.className = 'text-gray-500';
            logsDiv.classList.add('hidden');
        }
    } catch (error) {
        console.error("Error fetching orchestrator status:", error);
        const statusText = document.getElementById('orchestrator-status-text');
        statusText.textContent = 'Error';
        statusText.className = 'text-red-500';
    }

    // 2. Check Server Binary Update Status
    try {
        const response = await fetch('/api/server/status');
        const data = await response.json();
        const logDiv = document.getElementById('server-download-log');
        const logText = document.getElementById('server-download-text');

        if (data.status === 'UPDATING') {
            logDiv.classList.remove('hidden');
            logText.textContent = data.message;
            logDiv.scrollTop = logDiv.scrollHeight;
        } else {
            // Hide log if IDLE, unless there was an error message recently?
            // For now, let's hide it if IDLE for simplicity, as backend handles sleep.
            if (data.message) {
                 // If there is a lingering message (e.g. success/error), show it briefly or keep it?
                 // Let's hide it if status is IDLE for simplicity, as backend handles sleep.
                 logDiv.classList.add('hidden');
            } else {
                logDiv.classList.add('hidden');
            }

            // If we just finished updating, we might want to refresh the installed versions list
            // This is a bit naive (polling every 3s), but works.
            if (data.status === 'IDLE' && !window.serverUpdateFinished) {
                 // Check if we need to refresh versions
                 fetchServerVersions();
            }
        }
    } catch (error) {
        console.error("Error fetching server update status:", error);
    }
}

// --- WebSocket Handlers ---
socket.on('connect', () => {
    console.log('Connected to server via WebSocket');
});

socket.on('node_updated', (data) => {
    // Cache installed versions for later use (e.g. when releases load)
    nodeInstalledVersions[data.node_id] = data.installed_versions || [];

    updateNodeCard(data);
    populateSelect(data.node_id, data.installed_versions || []);
});

// --- Command Functions ---
function sendCommand(nodeId, commandData) {
    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId, command: commandData })
    })
    .then(response => response.json())
    .then(data => console.log('Command sent:', data))
    .catch(error => console.error('Error sending command:', error));
}

function sendUpdateCommand(nodeId) {
    const select = document.getElementById(`select-${nodeId}`);
    if (!select || !select.value) {
        console.error("No version selected");
        return;
    }

    const selectedData = JSON.parse(select.value);
    const command = {
        type: "UPDATE_BINARY",
        url: selectedData.url,
        version_tag: selectedData.version_tag
    };

    // Send update command
    sendCommand(nodeId, command);

    // Save client config
    fetch(`/api/config/client/${nodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_tag: selectedData.version_tag })
    }).then(() => {
        // Update local cache
        savedClientConfigs[nodeId] = { version_tag: selectedData.version_tag };
    });
}

function startRpc(nodeId) {
    const select = document.getElementById(`select-${nodeId}`);
    const portInput = document.getElementById(`rpc-port-${nodeId}`);

    if (!select || !select.value) {
        alert("Please select a version first.");
        return;
    }

    const versionData = JSON.parse(select.value);
    const port = parseInt(portInput.value) || 50052;

    const command = {
        type: "START_RPC",
        version_tag: versionData.version_tag,
        port: port
    };

    sendCommand(nodeId, command);
}

function stopRpc(nodeId) {
    const command = { type: "STOP_RPC" };
    sendCommand(nodeId, command);
}

// --- DOM Manipulation ---
function updateNodeCard(data) {
    const nodeId = data.node_id;
    let card = document.getElementById(`node-${nodeId}`);

    if (!card) {
        createNodeCard(data);
        card = document.getElementById(`node-${nodeId}`);
    }

    updateCardContent(card, data);
    updateCardChart(nodeId, data);
}

function createNodeCard(data) {
    const template = document.getElementById('node-card-template');
    const clone = template.content.cloneNode(true);
    const cardDiv = clone.querySelector('div');

    cardDiv.id = `node-${data.node_id}`;

    const selectEl = cardDiv.querySelector('.select-version');
    selectEl.id = `select-${data.node_id}`;

    const applyBtn = cardDiv.querySelector('.btn-apply-update');
    applyBtn.onclick = () => sendUpdateCommand(data.node_id);

    // RPC Controls
    const portInput = cardDiv.querySelector('.node-rpc-port');
    portInput.id = `rpc-port-${data.node_id}`;

    const startBtn = cardDiv.querySelector('.btn-start-rpc');
    startBtn.onclick = () => startRpc(data.node_id);

    const stopBtn = cardDiv.querySelector('.btn-stop-rpc');
    stopBtn.onclick = () => stopRpc(data.node_id);

    document.getElementById('node-grid').appendChild(clone);
    checkEmptyState();

    // Initialize Chart.js
    const ctx = cardDiv.querySelector('.node-chart').getContext('2d');
    nodeCharts[data.node_id] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(MAX_DATA_POINTS).fill(''),
            datasets: [
                {
                    label: 'CPU %',
                    data: Array(MAX_DATA_POINTS).fill(0),
                    borderColor: '#60a5fa', // Blue-400
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                },
                {
                    label: 'GPU %',
                    data: Array(MAX_DATA_POINTS).fill(0),
                    borderColor: '#4ade80', // Green-400
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: '#374151' }, // Gray-700
                    ticks: { color: '#9ca3af', font: { size: 10 } }
                }
            },
            animation: false // Disable animation for smooth real-time updates
        }
    });
}

function populateSelect(nodeId, installedVersions = []) {
    const select = document.getElementById(`select-${nodeId}`);
    if (!select) return;

    // If releases are not loaded yet, do nothing (keep "Loading..." or empty)
    if (Object.keys(availableReleases).length === 0) {
        return;
    }

    // Save current selection to restore it later
    const currentSelection = select.value;

    // Clear existing options
    select.innerHTML = '';

    // Populate options
    for (const releaseTag in availableReleases) {
        const release = availableReleases[releaseTag];
        for (const backendKey in release.backends) {
            const backend = release.backends[backendKey];
            const versionTag = `${release.tag_name}_${backendKey}`;

            const option = document.createElement('option');
            option.value = JSON.stringify({ url: backend.url, version_tag: versionTag });

            let text = `Llama ${release.tag_name} (${backendKey})`;
            if (installedVersions.includes(versionTag)) {
                text += ' ✅ (Installed)';
            }
            option.textContent = text;
            select.appendChild(option);
        }
    }

    // Restore selection logic
    if (currentSelection && select.querySelector(`option[value='${currentSelection}']`)) {
        select.value = currentSelection;
    } else if (savedClientConfigs[nodeId] && savedClientConfigs[nodeId].version_tag) {
        // Try to restore from saved config
        const savedTag = savedClientConfigs[nodeId].version_tag;
        for (const option of select.options) {
            try {
                const val = JSON.parse(option.value);
                if (val.version_tag === savedTag) {
                    select.value = option.value;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!select.value && select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

function updateCardContent(card, data) {
    // Header
    card.querySelector('.node-hostname').textContent = data.hostname;
    // card.querySelector('.node-ip').textContent = data.ip || 'Unknown IP'; // Add IP to payload later if needed

    // Status Badge
    const statusBadge = card.querySelector('.node-status');
    statusBadge.textContent = data.status || 'ONLINE';

    // Color logic for status
    let statusClasses = "px-2 py-1 rounded text-xs font-bold uppercase tracking-wider node-status text-white ";
    if (data.status === 'OFFLINE') {
        statusClasses += 'bg-red-600';
    } else if (data.status === 'UPDATING') {
        statusClasses += 'bg-yellow-500 animate-pulse text-black';
    } else if (data.status === 'BUSY') {
        statusClasses += 'bg-yellow-600';
    } else {
        statusClasses += 'bg-green-600';
    }
    statusBadge.className = statusClasses;

    // Console Logic
    const consoleDiv = card.querySelector('.node-console');
    const consoleText = card.querySelector('.node-console-text');

    if (data.status === 'UPDATING') {
        consoleDiv.classList.remove('hidden');
        consoleText.textContent = data.status_message || "Updating...";
        // Auto scroll to bottom
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    } else {
        consoleDiv.classList.add('hidden');
    }

    // Resources
    const res = data.resources || {};
    card.querySelector('.node-cpu-val').textContent = (res.cpu_percent || 0).toFixed(1) + '%';

    const ramUsed = (res.ram_used_gb || 0).toFixed(1);
    const ramTotal = (res.ram_total_gb || 0).toFixed(1);
    card.querySelector('.node-ram-val').textContent = `${ramUsed}/${ramTotal} GB`;

    // GPU (Assume first GPU for summary)
    if (res.gpus && res.gpus.length > 0) {
        const gpu = res.gpus[0];
        card.querySelector('.node-gpu-name').textContent = gpu.name;
        card.querySelector('.node-gpu-temp').textContent = gpu.temp_c + '°C';

        const vramUsed = (gpu.vram_used_mb / 1024).toFixed(1);
        const vramTotal = (gpu.vram_total_mb / 1024).toFixed(1);
        card.querySelector('.node-vram-val').textContent = `${vramUsed}/${vramTotal} GB`;
    } else {
        card.querySelector('.node-gpu-name').textContent = "No GPU";
    }

    // RPC Status
    const llama = data.llama_status || {};
    const rpcStatusSpan = card.querySelector('.node-rpc-status');
    const startBtn = card.querySelector('.btn-start-rpc');
    const stopBtn = card.querySelector('.btn-stop-rpc');
    const portInput = card.querySelector('.node-rpc-port');

    if (llama.running) {
        rpcStatusSpan.textContent = `Running (Port: ${llama.port})`;
        rpcStatusSpan.className = 'node-rpc-status text-green-400 font-bold';

        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        portInput.disabled = true;
        portInput.value = llama.port; // Sync port if running
    } else {
        rpcStatusSpan.textContent = 'Stopped';
        rpcStatusSpan.className = 'node-rpc-status text-gray-400';

        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        portInput.disabled = false;
    }
}

function updateCardChart(nodeId, data) {
    const chart = nodeCharts[nodeId];
    if (!chart) return;

    const res = data.resources || {};
    const cpuLoad = res.cpu_percent || 0;

    // Calculate GPU Load (average if multiple, or first)
    let gpuLoad = 0;
    if (res.gpus && res.gpus.length > 0) {
        gpuLoad = res.gpus[0].load_percent || 0;
    }

    // Shift data
    chart.data.datasets[0].data.push(cpuLoad);
    chart.data.datasets[0].data.shift();

    chart.data.datasets[1].data.push(gpuLoad);
    chart.data.datasets[1].data.shift();

    chart.update();
}
