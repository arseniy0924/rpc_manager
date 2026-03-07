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
    
    // Extract GPU names for chart legend
    const gpuNames = (data.resources && data.resources.gpus) 
        ? data.resources.gpus.map(gpu => gpu.name || `GPU ${gpu.index}`) 
        : [];
    
    updateCardChart(nodeId, data, gpuNames);
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

    // --- СБОРКА ВЫБРАННЫХ GPU ДЛЯ ЭТОЙ НОДЫ ---
    const selectedGpus = Array.from(document.querySelectorAll(`#node-${nodeId} .gpu-toggle:checked`))
        .map(checkbox => parseInt(checkbox.dataset.gpuIndex, 10));
    console.log(`Node ${nodeId}: Selected GPUs:`, selectedGpus);
    // -----------------------------------------

    const versionData = JSON.parse(select.value);
    const port = parseInt(portInput.value) || 50052;

    startRpc(nodeId, versionData.version_tag, port, selectedGpus);
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

    // GPU - теперь поддерживаем массив карт
    const gpuContainer = card.querySelector('.gpu-list');

    // Сохраняем состояние чекбоксов перед очисткой
    const gpuToggleStates = {};
    const existingToggles = card.querySelectorAll('.gpu-toggle');
    existingToggles.forEach(toggle => {
        const gpuIndex = toggle.dataset.gpuIndex;
        if (gpuIndex !== undefined) {
            gpuToggleStates[gpuIndex] = toggle.checked;
        }
    });

    gpuContainer.innerHTML = '';

    if (res.gpus && res.gpus.length > 0) {
        res.gpus.forEach(gpu => {
            const vramUsed = (gpu.vram_used_gb || 0).toFixed(1);
            const vramTotal = (gpu.vram_total_gb || 0).toFixed(1);
            const temp = gpu.temp || gpu.temp_c || 0;

            // Проверяем сохраненное состояние, по умолчанию true
            const isChecked = gpuToggleStates[gpu.index] !== undefined ? gpuToggleStates[gpu.index] : true;
            const checkedAttr = isChecked ? 'checked' : '';

            const gpuHtml = `
                <div class="gpu-item mb-2">
                    <div class="flex items-center justify-between">
                        <span class="node-gpu-name font-semibold text-sm">${gpu.name}</span>
                        <input type="checkbox" class="gpu-toggle" data-gpu-index="${gpu.index}" ${checkedAttr}>
                    </div>
                    <div class="flex justify-between text-xs text-gray-500 mt-1">
                        <span class="node-vram-val">${vramUsed}/${vramTotal} GB</span>
                        <span class="node-gpu-temp">${temp}°C</span>
                    </div>
                </div>
            `;
            gpuContainer.innerHTML += gpuHtml;
        });
    } else {
        gpuContainer.innerHTML = '<div class="text-gray-400 text-sm">No GPU</div>';
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

export async function populateSelect(nodeId, installedVersions = []) {
    const select = document.getElementById(`select-${nodeId}`);
    if (!select) return;

    // 1. ЖЕЛЕЗОБЕТОННАЯ ЗАЩИТА: парсим только если это реально JSON (начинается с "{")
    let currentUserSelection = null;
    if (select.value && select.value.trim().startsWith('{')) {
        try {
            currentUserSelection = JSON.parse(select.value).version_tag;
        } catch (e) {
            console.warn("Ignored invalid JSON in select:", select.value);
        }
    }

    const safeInstalled = Array.isArray(installedVersions) ? installedVersions : [];

    try {
        const [releasesData, configRes] = await Promise.all([
            fetch('/api/releases').then(r => r.ok ? r.json() : {}).catch(() => ({})),
            fetch('/api/config/clients').then(r => r.ok ? r.json() : { client_configs: {} }).catch(() => ({ client_configs: {} }))
        ]);

        const savedConfig = configRes.client_configs?.[nodeId] || {};
        const savedVersionTag = savedConfig.version_tag;

        const combinedVersions = [];
        const addedTags = new Set();

        for (const releaseTag in releasesData) {
            const release = releasesData[releaseTag];
            for (const backendKey in release.backends) {
                const backend = release.backends[backendKey];
                const versionTag = `${release.tag_name}_${backendKey}`;

                combinedVersions.push({
                    version_tag: versionTag,
                    name: `Llama ${release.tag_name} (${backendKey})`,
                    url: backend.url,
                    filename: backend.filename,
                    extra_assets: backend.extra_assets || [],
                    is_installed: safeInstalled.includes(versionTag)
                });
                addedTags.add(versionTag);
            }
        }

        safeInstalled.forEach(localTag => {
            if (!addedTags.has(localTag)) {
                combinedVersions.push({
                    version_tag: localTag,
                    name: `Local: ${localTag}`,
                    url: "",
                    filename: "",
                    extra_assets: [],
                    is_installed: true
                });
                addedTags.add(localTag);
            }
        });

        select.innerHTML = '<option value="" disabled>Select Version...</option>';

        combinedVersions.forEach(version => {
            const option = document.createElement('option');
            option.value = JSON.stringify({
                url: version.url,
                filename: version.filename,
                version_tag: version.version_tag,
                extra_assets: version.extra_assets
            });

            option.textContent = version.is_installed ? `✅ [INSTALLED] ${version.name}` : version.name;
            select.appendChild(option);
        });

        let targetVersionTag = currentUserSelection || savedVersionTag;

        if (!targetVersionTag && safeInstalled.length > 0) {
            const installedSorted = safeInstalled
                .map(v => {
                    const match = v.match(/^b(\d+)/);
                    return { tag: v, num: match ? parseInt(match[1], 10) : 0 };
                })
                .sort((a, b) => b.num - a.num);

            if (installedSorted.length > 0) {
                targetVersionTag = installedSorted[0].tag;
            }
        }

        if (targetVersionTag) {
            for (const option of select.options) {
                // И здесь тоже проверяем, что option.value это валидный JSON
                if (!option.value || !option.value.trim().startsWith('{')) continue;
                try {
                    const val = JSON.parse(option.value);
                    if (val.version_tag === targetVersionTag) {
                        select.value = option.value;
                        break;
                    }
                } catch (e) {}
            }
        } else if (select.options.length > 1 && !select.value) {
            select.selectedIndex = 1;
        }

    } catch (error) {
        console.error(`CRITICAL: Error populating select for node ${nodeId}:`, error);
        select.innerHTML = `<option disabled>Error loading versions</option>`;
    }
}
