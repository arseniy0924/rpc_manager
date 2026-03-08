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

        // 1. Сохраняем текущее состояние галок перед перерисовкой
        const currentStates = {};
        document.querySelectorAll('.local-gpu-toggle').forEach(cb => {
            currentStates[cb.dataset.gpuIndex] = cb.checked;
        });

        // 2. Генерируем HTML с чекбоксами
        const gpusHtml = data.gpus.map(g => {
            // Если карта новая, ставим по умолчанию true. Если была - берем сохраненное состояние.
            const isChecked = currentStates[g.index] !== undefined ? currentStates[g.index] : true;
            return `
                <div class="flex items-center bg-gray-800/60 px-2 py-1 rounded border border-gray-700 whitespace-nowrap">
                    <input type="checkbox"
                           class="local-gpu-toggle mr-2 accent-green-500 cursor-pointer w-4 h-4"
                           data-gpu-index="${g.index}"
                           ${isChecked ? 'checked' : ''}>
                    <span class="text-xs">
                        <b class="text-green-400">${g.name}</b>
                        <span class="text-gray-500">|</span> ${g.temp}°C
                        <span class="text-gray-500">|</span> ${(g.used_gb || 0).toFixed(2)}/${(g.total_gb || 0).toFixed(2)} GB
                    </span>
                </div>
            `;
        }).join('<div class="w-2"></div>');

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