<div align="center">

# 🚀 RPC Manager for llama.cpp Cluster

**The Ultimate Web UI to Orchestrate, Manage, and Auto-Deploy AI Clusters**

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0.0-black?logo=flask)](https://flask.palletsprojects.com/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Releases](https://img.shields.io/github/v/release/ТВОЙ_НИК/rpc_manager?include_prereleases&sort=semver)](https://github.com/ТВОЙ_НИК/rpc_manager/releases)

</div>

## 📖 Overview

**RPC Manager** is a powerful, zero-configuration control panel designed to manage a distributed cluster of `llama.cpp` RPC nodes. It allows you to pool the VRAM of multiple machines across your local network to run massive Large Language Models (LLMs) that wouldn't fit on a single GPU.

With a beautiful dark-mode dashboard, auto-discovery via mDNS, and automated binary updates, building a personal AI supercomputer has never been easier.

![Dashboard Screenshot](link_to_your_main_screenshot_here.png)
*(Drop a screenshot of your beautiful dashboard here)*

---

## ✨ Key Features

* 🎯 **Zero-Config Discovery (mDNS)**: Agents automatically find the Orchestrator on the local network. No need to hardcode IP addresses.
* 📦 **Auto-Downloader & Updater**: Installs `llama.cpp` binaries directly from GitHub releases to any node in one click. **Fully supports downloading CUDA dependencies (DLLs)**.
* 📊 **Live Telemetry**: Real-time monitoring of CPU, System RAM, GPU Temperature, and VRAM usage for every connected node.
* 🧠 **Smart Cluster Start**: Toggle specific nodes on or off via the UI. The Orchestrator automatically handles launching the RPC servers and passing the correct endpoint strings.
* 💾 **Model & Preset Management**: Scan your local directories for `.gguf` models, save launch parameters (Context, GPU Layers, Flash Attention, etc.) as presets, and switch between them instantly.
* ⚡ **Portable "One-Click" Deploy**: Fully compiled into standalone `.exe` files for both Server and Agent. No Python installation required on client machines!

---

## 🏗️ Architecture

The system consists of two lightweight, compiled applications:

1.  **RPC Server (Orchestrator)**: The central brain. Runs the Flask web interface, manages cluster state, and starts the primary `llama.cpp` instance that connects to all RPC nodes.
2.  **RPC Agent (Client)**: Runs on your worker machines (the ones with extra GPUs). It silently runs in the background, reports hardware telemetry, and listens for commands to download binaries or start/stop the RPC server.

---

## 🚀 Quick Start (Using Pre-compiled Binaries)

The easiest way to get started is using our standalone `.exe` releases for Windows.

### 1. Set up the Orchestrator (Main PC)
1. Download `RPC_Server.exe` from the [Releases page](../../releases).
2. Run `RPC_Server.exe`.
3. Open your browser and go to `http://localhost:5000`.

### 2. Set up the Nodes (Worker PCs)
1. Download `RPC_Agent.exe` to any PC on the same local network.
2. Run `RPC_Agent.exe`.
3. The agent will automatically find the Orchestrator and appear in your web dashboard!

### 3. Deploy and Run
1. In the Web UI, select the `llama.cpp` version you want to install and click **Apply** on your nodes.
2. Set your **Models Directory** and click **Scan**.
3. Select a model, tweak your launch parameters (or use a Preset), and click **Start Cluster**.

---

## 🛠️ Building from Source

If you want to modify the code or build the project yourself, follow these steps:

### Prerequisites
* Python 3.9+
* NVIDIA GPU (for hardware telemetry via `pynvml`)

### Installation

```bash
# 1. Clone the repository
git clone [https://github.com/YOUR_USERNAME/rpc_manager.git](https://github.com/YOUR_USERNAME/rpc_manager.git)
cd rpc_manager

# 2. Create and activate a virtual environment
python -m venv .venv
source .venv/Scripts/activate  # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt