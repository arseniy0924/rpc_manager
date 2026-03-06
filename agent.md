# Architecture & Development Plan: Local AI Cluster Manager

## 1. Project Structure

The project will be divided into two main components: `server` (Manager) and `client` (Node Agent).

```text
rpc_manager/
├── server/                     # Backend Server (Flask)
│   ├── app.py                  # Application entry point
│   ├── config.py               # Configuration (Secret keys, paths)
│   ├── database.py             # SQLite models and connection
│   ├── extensions.py           # Flask extensions (SocketIO, SQLAlchemy)
│   ├── routes/                 # Route definitions
│   │   ├── api.py              # API for Agents (telemetry, registration)
│   │   └── web.py              # UI routes for the Dashboard
│   ├── services/               # Business Logic
│   │   ├── discovery.py        # mDNS/Zeroconf service listener
│   │   └── github_updater.py   # Logic to fetch llama.cpp releases
│   ├── static/                 # Frontend Assets
│   │   ├── css/                # Tailwind output / custom styles
│   │   └── js/                 # Dashboard logic (Socket.IO client)
│   └── templates/              # HTML Templates (Jinja2)
│       ├── base.html
│       └── dashboard.html
├── client/                     # Node Agent
│   ├── main.py                 # Agent entry point
│   ├── config.py               # Agent settings (Server URL, Node Name)
│   ├── hardware.py             # Telemetry collection (psutil, pynvml)
│   ├── runner.py               # Wrapper for llama.cpp process (subprocess)
│   ├── network.py              # HTTP Client & Discovery logic
│   └── system.py               # OS integration (Startup, Registry)
├── requirements.txt            # Python dependencies
└── README.md
```

## 2. Architecture & Communication

### Interaction Model
*   **Server:** Acts as the central command center. It hosts the Web UI and an API for agents.
*   **Client (Agent):** Runs on each GPU node. It actively connects to the Server.
*   **Discovery:**
    *   **Server** broadcasts its presence via **mDNS (Zeroconf)**.
    *   **Client** listens for the service `_rpc-manager._tcp.local.` to automatically find the server IP and port.
*   **Telemetry & Heartbeat:**
    *   **Protocol:** HTTP POST (JSON)
    *   **Frequency:** Every 2-5 seconds (configurable).
    *   **Flow:** Client sends `POST /api/heartbeat` with telemetry data.
    *   **Response:** Server replies with `200 OK` and a JSON body containing any **pending commands** (e.g., `{"action": "start_llama", "args": "..."}`).
*   **Real-time Dashboard:**
    *   **Protocol:** WebSocket (Flask-SocketIO).
    *   The Server pushes updates to the Web Browser whenever a heartbeat is received from an agent, ensuring the UI is always in sync.

### Data Formats (JSON)

#### 1. Telemetry Payload (Client -> Server)
```json
{
  "node_id": "uuid-or-mac-address",
  "hostname": "My-GPU-Node-1",
  "platform": "Windows 10",
  "status": "IDLE",  // or "RUNNING", "UPDATING", "OFFLINE"
  "resources": {
    "cpu_percent": 15.5,
    "ram_total_gb": 32.0,
    "ram_used_gb": 4.5,
    "gpus": [
      {
        "index": 0,
        "name": "NVIDIA GeForce RTX 3090",
        "vram_total_mb": 24576,
        "vram_used_mb": 1024,
        "temp_c": 45,
        "load_percent": 0
      }
    ]
  },
  "llama_status": {
    "running": false,
    "pid": null,
    "port": 8080,
    "version": "b1234"
  }
}
```

#### 2. Command Response (Server -> Client)
The server responds to the heartbeat with instructions if needed.
```json
{
  "commands": [
    {
      "id": "cmd_123",
      "type": "START_LLAMA",
      "payload": {
        "backend": "cuda",
        "model_path": "models/llama-2-7b.gguf",
        "flags": ["--n-gpu-layers", "99", "--port", "8080"]
      }
    }
  ]
}
```
*Possible Command Types:* `START_LLAMA`, `STOP_LLAMA`, `UPDATE_BINARY`, `REBOOT_SYSTEM`.

## 3. Development Plan (Modules)

### Phase 1: Foundation (Server & Client Skeleton)
1.  **Server:** Setup Flask, SQLite, and basic UI template (Tailwind).
2.  **Client:** Setup basic loop, hardware detection stub, and HTTP heartbeat.
3.  **Connectivity:** Implement mDNS discovery so Client finds Server automatically.

### Phase 2: Telemetry & Dashboard
1.  **Client:** Implement `hardware.py` using `psutil` and `pynvml` (NVIDIA Management Library) for real GPU stats.
2.  **Server:** Create API endpoint to receive telemetry and update the in-memory/database state.
3.  **UI:** Connect Flask-SocketIO to push these updates to the frontend. Design the "Node Card" component.

### Phase 3: Llama.cpp Management
1.  **Client:** Implement `runner.py` to handle `subprocess.Popen` for `llama-server.exe`. Handle stdout/stderr logging.
2.  **Server:** Add UI controls to configure launch arguments (model path, layers, backend) and send "Start/Stop" commands via the heartbeat response.

### Phase 4: Updates & System Integration
1.  **Server:** Implement GitHub API parser to find assets (llama-bXXXX-bin-win-avx2-x64.zip).
2.  **Client:** Implement logic to download URL provided by server, unzip, and replace binaries.
3.  **Client:** Add "Add to Startup" logic (Windows Registry).
4.  **Packaging:** Configure PyInstaller spec file for single-file EXE generation.
