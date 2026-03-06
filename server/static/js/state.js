// Shared state management
export const state = {
    availableReleases: {},
    nodeInstalledVersions: {}, // { nodeId: [versions] }
    serverInstalledVersions: [],
    savedOrchestratorVersion: "",
    savedClientConfigs: {} // { nodeId: { version_tag: ... } }
};
