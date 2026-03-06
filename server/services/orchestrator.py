import subprocess
import logging
import platform
import time
import os
import threading
from collections import deque
from typing import Optional, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MainOrchestrator:
    """
    Manages the lifecycle of the main llama.cpp orchestrator process.
    This process connects to remote RPC servers and serves the model via HTTP.
    """
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.port: Optional[int] = None
        self.pid: Optional[int] = None
        self.model_path: Optional[str] = None
        self.version_tag: Optional[str] = None
        self.state: str = "STOPPED" # STOPPED, LOADING, READY
        self.logs: deque = deque(maxlen=1000)

    def start(self, version_tag: str, model_path: str, rpc_endpoints: str, port: int = 8080, launch_params: Optional[Dict[str, Any]] = None) -> bool:
        """
        Starts the main llama.cpp orchestrator process.

        Args:
            version_tag (str): The version tag of the server binary to use (e.g., 'b8215_cuda').
            model_path (str): Path to the .gguf model file.
            rpc_endpoints (str): Comma-separated list of RPC endpoints (e.g., "192.168.1.154:50052,192.168.1.155:50052").
            port (int): The port to bind the HTTP server to.
            launch_params (dict, optional): Additional launch parameters (c, ngl, cache_type_k, etc.).

        Returns:
            bool: True if the process started successfully, False otherwise.
        """
        if self.process and self.process.poll() is None:
            logger.warning(f"Orchestrator is already running (PID: {self.pid}). Please stop it first.")
            return False

        # Determine binary path
        base_folder = "server_bin"
        version_path = os.path.join(base_folder, version_tag)
        
        if not os.path.exists(version_path):
            logger.error(f"Server version folder not found: {version_path}")
            return False

        # Find executable
        possible_executables = ['llama-server.exe', 'server.exe']
        binary_path = None
        for exe in possible_executables:
            path = os.path.join(version_path, exe)
            if os.path.exists(path):
                binary_path = path
                break
        
        if not binary_path:
            logger.error(f"No server executable found in {version_path}")
            return False

        # Form the base command
        command = [
            binary_path,
            "-m", model_path,
            "--port", str(port),
            "--host", "0.0.0.0"
        ]
        
        # Add RPC endpoints if available
        if rpc_endpoints and rpc_endpoints.strip():
            command.extend(["--rpc", rpc_endpoints])
            
        # Environment variables
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        # Add launch parameters if provided
        if launch_params:
            if launch_params.get("c"):
                command.extend(["-c", str(launch_params["c"])])
            
            if launch_params.get("ngl"):
                command.extend(["-ngl", str(launch_params["ngl"])])
            else:
                # Default to offloading all layers if not specified, as per previous logic
                command.extend(["-ngl", "99"])

            if launch_params.get("cache_type_k"):
                command.extend(["--cache-type-k", str(launch_params["cache_type_k"])])
            
            if launch_params.get("cache_type_v"):
                command.extend(["--cache-type-v", str(launch_params["cache_type_v"])])
            
            if launch_params.get("flash_attn"):
                command.extend(["--flash-attn", "on"])
            
            if launch_params.get("no_mmap"):
                command.append("--no-mmap")
                
            if launch_params.get("fit"):
                command.extend(["--fit", str(launch_params["fit"])])
                
            if launch_params.get("custom_args"):
                # Split custom args string into list items
                custom_args = str(launch_params["custom_args"]).split()
                command.extend(custom_args)
                
            # Disable local GPU if requested
            if launch_params.get("disable_local_gpu"):
                env["CUDA_VISIBLE_DEVICES"] = "-1"
                env["HIP_VISIBLE_DEVICES"] = "-1"
                env["GGML_VK_VISIBLE_DEVICES"] = ""
                env["SYCL_DEVICE_FILTER"] = ""
                logger.info("Local GPU disabled via environment variables.")
        else:
            # Default behavior if no params provided
            command.extend(["-ngl", "99"])
        
        # Platform-specific flags to hide console window on Windows
        creation_flags = 0
        if platform.system() == "Windows":
            creation_flags = subprocess.CREATE_NO_WINDOW

        try:
            logger.info(f"Starting orchestrator: {' '.join(command)}")
            self.process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                encoding='utf-8',
                errors='replace',
                creationflags=creation_flags,
                env=env
            )
            
            self.port = port
            self.pid = self.process.pid
            self.model_path = model_path
            self.version_tag = version_tag
            self.state = "LOADING"
            self.logs.clear()
            
            # Start log reading thread
            threading.Thread(target=self._read_logs, daemon=True).start()
            
            logger.info(f"Orchestrator started successfully with PID: {self.pid}")
            return True
        except Exception as e:
            logger.exception(f"Failed to start orchestrator: {e}")
            self.process = None
            self.state = "STOPPED"
            return False

    def _read_logs(self):
        """Reads logs from the subprocess stdout and updates state."""
        ready_phrases = [
            "server is listening on", 
            "http server listening", 
            "llama server listening", 
            "running on http", 
            "listening on http",
            "srv init: server is listening"
        ]
        
        while self.process and self.process.poll() is None:
            try:
                line = self.process.stdout.readline()
                if not line:
                    break
                
                line = line.strip()
                if line:
                    self.logs.append(line)
                    # Check for readiness indicators
                    line_lower = line.lower()
                    if any(phrase in line_lower for phrase in ready_phrases):
                        self.state = "READY"
            except Exception as e:
                logger.error(f"Error reading orchestrator logs: {e}")
                break

    def stop(self) -> bool:
        """
        Stops the currently running orchestrator process.

        Returns:
            bool: True if the process was stopped successfully or was not running.
        """
        if not self.process or self.process.poll() is not None:
            logger.info("Orchestrator is not running.")
            self._reset_state()
            return True

        logger.info(f"Stopping orchestrator with PID: {self.pid}...")
        try:
            self.process.terminate()
            self.process.wait(timeout=5) # Give it a bit more time to close connections
            logger.info("Orchestrator terminated gracefully.")
        except subprocess.TimeoutExpired:
            logger.warning("Orchestrator did not terminate gracefully. Forcing kill.")
            self.process.kill()
        except Exception as e:
            logger.exception(f"Error while stopping orchestrator: {e}")
        finally:
            self._reset_state()
        
        return True

    def _reset_state(self):
        """Resets all internal state variables."""
        self.process = None
        self.port = None
        self.pid = None
        self.model_path = None
        self.version_tag = None
        self.state = "STOPPED"

    def get_status(self) -> Dict[str, Any]:
        """
        Gets the current status of the orchestrator process.
        If the process has terminated unexpectedly, the state is cleaned up.

        Returns:
            A dictionary containing the running status, PID, port, model path, and logs.
        """
        if self.process and self.process.poll() is not None:
            logger.warning(f"Orchestrator with PID {self.pid} terminated unexpectedly.")
            self._reset_state()

        return {
            "running": self.process is not None and self.process.poll() is None,
            "state": self.state,
            "pid": self.pid,
            "port": self.port,
            "model_path": self.model_path,
            "version_tag": self.version_tag,
            "logs": list(self.logs)
        }

# Global instance of the orchestrator
orchestrator = MainOrchestrator()
