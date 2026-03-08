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
    import('./state.js').then(module => {
        module.state.nodeInstalledVersions[data.node_id] = data.installed_versions || [];
        updateNodeCard(data);
        populateSelect(data.node_id, data.installed_versions || []);
    });
});

// --- Server Telemetry Handler ---
socket.on('server_telemetry', (data) => {
    updateServerHeader(data);
});

function updateServerHeader(data) {
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