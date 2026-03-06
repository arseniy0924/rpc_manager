import { state } from './state.js';
import { updateCardChart } from './charts.js';
import { sendUpdateCommand, startRpc, stopRpc } from './api.js';

export function checkEmptyState() {
    const grid = document.getElementById('node-grid');
    const emptyState = document.getElementById('empty-state');
    if (grid.children.length === 0) {
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
    }
}

export function copyToClipboard(text, element) {
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

export function updateNodeCard(data) {
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

    // --- Логика тумблера включения ноды (Smart Cluster Start) ---
    const toggle = cardDiv.querySelector('.node-enable-toggle');
    if (toggle) {
        toggle.dataset.nodeId = data.node_id;

        // Восстанавливаем состояние из localStorage (по умолчанию включен)
        const savedToggleState = localStorage.getItem(`node_enabled_${data.node_id}`);
        if (savedToggleState !== null) {
            toggle.checked = savedToggleState === 'true';
        }

        // Сохраняем состояние при клике
        toggle.addEventListener('change', (e) => {
            localStorage.setItem(`node_enabled_${data.node_id}`, e.target.checked);
        });
    }
    // -----------------------------------------------------------

    const selectEl = cardDiv.querySelector('.select-version');
    selectEl.id = `select-${data.node_id}`;

    const applyBtn = cardDiv.querySelector('.btn-apply-update');
    applyBtn.onclick = () => handleUpdateClick(data.node_id);

    // RPC Controls
    const portInput = cardDiv.querySelector('.node-rpc-port');
    portInput.id = `rpc-port-${data.node_id}`;

    const startBtn = cardDiv.querySelector('.btn-start-rpc');
    startBtn.onclick = () => handleStartRpcClick(data.node_id);

    const stopBtn = cardDiv.querySelector('.btn-stop-rpc');
    stopBtn.onclick = () => handleStopRpcClick(data.node_id);

    document.getElementById('node-grid').appendChild(clone);
    checkEmptyState();
}

function handleUpdateClick(nodeId) {
    const select = document.getElementById(`select-${nodeId}`);
    if (!select || !select.value) {
        console.error("No version selected");
        return;
    }

    const selectedData = JSON.parse(select.value);
    // ВАЖНО: передаем только 2 аргумента! Весь объект selectedData идет целиком.
    sendUpdateCommand(nodeId, selectedData);
}

function handleStartRpcClick(nodeId) {
    const select = document.getElementById(`select-${nodeId}`);
    const portInput = document.getElementById(`rpc-port-${nodeId}`);

    if (!select || !select.value) {
        alert("Please select a version first.");
        return;
    }

    const versionData = JSON.parse(select.value);
    const port = parseInt(portInput.value) || 50052;

    startRpc(nodeId, versionData.version_tag, port);
}

function handleStopRpcClick(nodeId) {
    stopRpc(nodeId);
}

export function updateCardContent(card, data) {
    // Header
    card.querySelector('.node-hostname').textContent = data.hostname;

    // ВАЖНО: Обновляем IP в dataset тумблера, чтобы orchestrator.js его видел
    const toggle = card.querySelector('.node-enable-toggle');
    if (toggle) {
        toggle.dataset.nodeIp = data.ip || '127.0.0.1';
    }

    // Status Badge
    const statusBadge = card.querySelector('.node-status');
    statusBadge.textContent = data.status || 'ONLINE';

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

    // GPU
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
        portInput.value = llama.port;
    } else {
        rpcStatusSpan.textContent = 'Stopped';
        rpcStatusSpan.className = 'node-rpc-status text-gray-400';

        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        portInput.disabled = false;
    }
}

export function populateSelect(nodeId, installedVersions = []) {
    const select = document.getElementById(`select-${nodeId}`);
    if (!select) return;

    if (Object.keys(state.availableReleases).length === 0) return;

    const currentSelection = select.value;
    select.innerHTML = '';

    for (const releaseTag in state.availableReleases) {
        const release = state.availableReleases[releaseTag];
        for (const backendKey in release.backends) {
            const backend = release.backends[backendKey];
            const versionTag = `${release.tag_name}_${backendKey}`;

            const option = document.createElement('option');
            // ВАЖНО: используем правильные переменные: backend и versionTag
            const valueObj = {
                url: backend.url,
                filename: backend.filename,
                version_tag: versionTag,
                extra_assets: backend.extra_assets || []
            };
            option.value = JSON.stringify(valueObj);

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
    } else if (state.savedClientConfigs[nodeId] && state.savedClientConfigs[nodeId].version_tag) {
        const savedTag = state.savedClientConfigs[nodeId].version_tag;
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
