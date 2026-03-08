import {
    fetchReleases,
    fetchServerVersions,
    fetchClientConfigs,
    loadConfig,
    loadOrchestratorConfig,
    loadOrchestratorPort
} from './api.js';

import {
    checkEmptyState,
    updateNodeCard,
    populateSelect,
    copyToClipboard
} from './ui.js';

import {
    saveConfigAndScan,
    populateModelsSelect,
    populateServerSelect,
    installServerVersion,
    startOrchestrator,
    stopOrchestrator,
    updateOrchestratorStatus,
    saveCurrentPreset,
    saveFormState,
    restoreFormState,
    copyAllLogs
} from './orchestrator.js';

// --- Global Cluster Stats Cache ---
const clusterStats = {
    server: { ram_used: 0, ram_total: 0, vram_used: 0, vram_total: 0 },
    nodes: {} // Keys are node_id
};

// --- Watchdog Timers for Nodes ---
const nodeWatchdogs = {};

// --- Update Cluster Totals Function ---
function updateClusterTotals() {
    // Sum server stats
    let totalRamUsed = clusterStats.server.ram_used || 0;
    let totalRamTotal = clusterStats.server.ram_total || 0;
    let totalVramUsed = clusterStats.server.vram_used || 0;
    let totalVramTotal = clusterStats.server.vram_total || 0;

    // Sum node stats
    Object.values(clusterStats.nodes).forEach(node => {
        totalRamUsed += node.ram_used || 0;
        totalRamTotal += node.ram_total || 0;
        totalVramUsed += node.vram_used || 0;
        totalVramTotal += node.vram_total || 0;
    });

    // Format text
    const ramText = `CLUSTER RAM: ${totalRamUsed.toFixed(1)} / ${totalRamTotal.toFixed(1)} GB`;
    const vramText = `CLUSTER VRAM: ${totalVramUsed.toFixed(1)} / ${totalVramTotal.toFixed(1)} GB`;
    const displayText = `${ramText} | ${vramText}`;

    // Update DOM
    const el = document.getElementById('cluster-totals-text');
    if (el) {
        el.textContent = displayText;
    }
}

// Initialize Socket.IO
const socket = io();

// --- Page Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Load initial data
    await Promise.all([
        fetchReleases(),
        fetchClientConfigs(),
        fetchServerVersions()
    ]);

    // Load configurations
    const config = await loadConfig();
    if (config.models_path) {
        document.getElementById('models-path-input').value = config.models_path;
        await populateModelsSelect();
    }

    await loadOrchestratorConfig();
    populateServerSelect();

    const portConfig = await loadOrchestratorPort();
    if (portConfig.orchestrator_port) {
        document.getElementById('orchestrator-port-input').value = portConfig.orchestrator_port;
    }

    // Восстанавливаем сохраненные настройки формы с задержкой, чтобы выпадающие списки успели заполниться
    setTimeout(() => {
        restoreFormState();
        attachFormListeners();
    }, 500);

    checkEmptyState();

    // Poll orchestrator status (Вечный опрос логов)
    setInterval(updateOrchestratorStatus, 2000); // Сделал 2 сек для более быстрых логов
    updateOrchestratorStatus();
});

function attachFormListeners() {
    // Добавлены все чекбоксы!
    const ids = [
        'main-model-select', 'param-c', 'param-ngl', 'param-cache-k',
        'param-cache-v', 'param-fit', 'param-custom', 'param-disable-local',
        'param-fa', 'param-mmap'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', saveFormState);
            el.addEventListener('input', saveFormState);
        }
    });
}

// --- Socket.IO Handlers ---
socket.on('connect', () => {
    console.log('Connected to server via WebSocket');
});

socket.on('node_updated', (data) => {
    // Watchdog logic
    if (nodeWatchdogs[data.node_id]) {
        clearTimeout(nodeWatchdogs[data.node_id]);
        delete nodeWatchdogs[data.node_id];
    }
    
    if (data.status !== 'OFFLINE') {
        nodeWatchdogs[data.node_id] = setTimeout(() => {
            data.status = 'OFFLINE';
            data.resources = { cpu_percent: 0, ram_used: 0, ram_total: 0, gpus: [] };
            updateNodeCard(data);
            delete clusterStats.nodes[data.node_id];
            if (typeof updateClusterTotals === 'function') updateClusterTotals();
        }, 15000);
    }

    import('./state.js').then(module => {
        module.state.nodeInstalledVersions[data.node_id] = data.installed_versions || [];
        updateNodeCard(data);
        populateSelect(data.node_id, data.installed_versions || []);

        // Update cluster totals for node
        if (data.status === 'OFFLINE') {
            // Remove node from clusterStats if offline
            delete clusterStats.nodes[data.node_id];
        } else {
            // Parse node resources
            const ramUsed = parseFloat(data.resources?.ram_used || data.resources?.ram_used_gb || 0);
            const ramTotal = parseFloat(data.resources?.ram_total || data.resources?.ram_total_gb || 0);

            let vramUsed = 0;
            let vramTotal = 0;
            if (data.resources?.gpus && Array.isArray(data.resources.gpus)) {
                data.resources.gpus.forEach(gpu => {
                    // ИСПРАВЛЕНО: добавлено чтение vram_used_gb и vram_total_gb
                    vramUsed += parseFloat(gpu.vram_used_gb || gpu.used_gb || 0);
                    vramTotal += parseFloat(gpu.vram_total_gb || gpu.total_gb || 0);
                });
            }

            // Store in clusterStats.nodes
            clusterStats.nodes[data.node_id] = {
                ram_used: ramUsed,
                ram_total: ramTotal,
                vram_used: vramUsed,
                vram_total: vramTotal
            };
        }

        updateClusterTotals();
    });
});
// --- Server Telemetry Handler ---
socket.on('server_telemetry', (data) => {
    updateServerHeader(data);
    // Update cluster totals for server
    const ramUsed = parseFloat(data.ram_used || data.ram_used_gb || 0);
    const ramTotal = parseFloat(data.ram_total || data.ram_total_gb || 0);

    let vramUsed = 0;
    let vramTotal = 0;
    if (data.gpus && Array.isArray(data.gpus)) {
        data.gpus.forEach(gpu => {
            vramUsed += parseFloat(gpu.used_gb || gpu.used || 0);
            vramTotal += parseFloat(gpu.total_gb || gpu.total || 0);
        });
    }

    clusterStats.server.ram_used = ramUsed;
    clusterStats.server.ram_total = ramTotal;
    clusterStats.server.vram_used = vramUsed;
    clusterStats.server.vram_total = vramTotal;

    updateClusterTotals();
});

function updateServerHeader(data) {
    // Парсим RAM и VRAM главного сервера для clusterStats
    const ramUsed = parseFloat(data.ram_used || data.ram_used_gb || 0);
    const ramTotal = parseFloat(data.ram_total || data.ram_total_gb || 0);

    // Суммируем VRAM из всех GPU
    let vramUsed = 0;
    let vramTotal = 0;
    if (data.gpus && Array.isArray(data.gpus)) {
        data.gpus.forEach(gpu => {
            vramUsed += parseFloat(gpu.used_gb || gpu.used || 0);
            vramTotal += parseFloat(gpu.total_gb || gpu.total || 0);
        });
    }

    // Записываем в clusterStats.server
    clusterStats.server.ram_used = ramUsed;
    clusterStats.server.ram_total = ramTotal;
    clusterStats.server.vram_used = vramUsed;
    clusterStats.server.vram_total = vramTotal;

    // Обновление CPU и RAM главного сервера
    const cpuBar = document.getElementById('server-cpu-bar');
    const cpuText = document.getElementById('server-cpu-text');
    if (cpuBar && cpuText) {
        const cpuPercent = data.cpu_percent || 0;
        cpuBar.style.width = `${cpuPercent}%`;
        cpuText.textContent = `${cpuPercent.toFixed(1)}%`;
    }

    const ramText = document.getElementById('server-ram-text');
    if (ramText) {
        // Берем либо ram_used, либо ram_used_gb. Если ничего нет - ставим 0
        const ramUsed = parseFloat(data.ram_used || data.ram_used_gb || 0);
        const ramTotal = parseFloat(data.ram_total || data.ram_total_gb || 0);

        ramText.textContent = `${ramUsed.toFixed(1)} / ${ramTotal.toFixed(1)} GB`;
    }
    // Обновление GPU данных
    const gpuContainer = document.getElementById('server-gpu-container');
    const gpuText = document.getElementById('server-gpu-text');
    if (!gpuContainer || !gpuText) return;

    if (data.gpus && data.gpus.length > 0) {
        gpuContainer.classList.remove('hidden');
        const currentStates = {};
        document.querySelectorAll('.local-gpu-toggle').forEach(cb => {
            currentStates[cb.dataset.gpuIndex] = cb.checked;
        });

        // Используем второй аргумент map (idx), если g.index отсутствует
        const gpusHtml = data.gpus.map((g, idx) => {
            const gpuIndex = g.index !== undefined ? g.index : idx; // ГАРАНТИЯ ИНДЕКСА
            const isChecked = currentStates[gpuIndex] !== undefined ? currentStates[gpuIndex] : true;
            return `
                <div class="flex items-center bg-gray-800/80 px-3 py-1.5 rounded-lg border border-gray-700 mr-2">
                    <input type="checkbox" class="local-gpu-toggle mr-2 w-4 h-4 accent-green-500"
                           data-gpu-index="${gpuIndex}" ${isChecked ? 'checked' : ''}>
                    <span class="text-xs"><b>${g.name}</b> | ${g.temp}°C | ${(g.used_gb || 0).toFixed(1)}/${(g.total_gb || 0).toFixed(1)} GB</span>
                </div>`;
        }).join('');
        gpuText.innerHTML = `<div class="flex flex-wrap gap-2">${gpusHtml}</div>`;
    } else {
        gpuContainer.classList.add('hidden');
    }
}

// --- ЭКСПОРТ ФУНКЦИЙ В ГЛОБАЛЬНУЮ ЗОНУ ДЛЯ HTML (Исправляет неработающие кнопки) ---
window.saveConfigAndScan = saveConfigAndScan;
window.installServerVersion = installServerVersion;
window.startOrchestrator = startOrchestrator;
window.stopOrchestrator = stopOrchestrator;
window.copyToClipboard = copyToClipboard;
window.saveCurrentPreset = saveCurrentPreset;
window.copyAllLogs = copyAllLogs;