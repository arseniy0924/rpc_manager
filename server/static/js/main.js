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

// --- ЭКСПОРТ ФУНКЦИЙ В ГЛОБАЛЬНУЮ ЗОНУ ДЛЯ HTML (Исправляет неработающие кнопки) ---
window.saveConfigAndScan = saveConfigAndScan;
window.installServerVersion = installServerVersion;
window.startOrchestrator = startOrchestrator;
window.stopOrchestrator = stopOrchestrator;
window.copyToClipboard = copyToClipboard;
window.saveCurrentPreset = saveCurrentPreset;
window.copyAllLogs = copyAllLogs;