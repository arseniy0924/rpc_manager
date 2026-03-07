import subprocess
import os
import logging
import platform
import threading
import re
from typing import Optional, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_vulkan_device_mapping(version_path: str) -> Dict[int, int]:
    """
    Автоматически определяет соответствие индексов Vulkan устройств.
    Возвращает словарь: UI индекс -> Vulkan индекс.
    """
    try:
        # Запускаем rpc-server с --verbose для получения списка устройств
        exe_path = os.path.join(version_path, 'rpc-server.exe')
        if not os.path.exists(exe_path):
            return {}
            
        result = subprocess.run(
            [exe_path, '--verbose'],
            capture_output=True,
            text=True,
            timeout=10,
            env=os.environ.copy()
        )
        
        # Ищем строки с устройствами Vulkan
        # Пример: "Vulkan: Found device 0: NVIDIA GeForce RTX 4060"
        vulkan_devices = []
        for line in result.stderr.split('\n'):
            if 'Vulkan:' in line and 'Found device' in line:
                match = re.search(r'Found device (\d+):', line)
                if match:
                    vulkan_idx = int(match.group(1))
                    vulkan_devices.append(vulkan_idx)
        
        # Если нашли устройства, создаем маппинг по порядку
        if vulkan_devices:
            mapping = {}
            for ui_idx, vulkan_idx in enumerate(vulkan_devices):
                mapping[ui_idx] = vulkan_idx
            logger.info(f"Auto-detected Vulkan mapping: {mapping}")
            return mapping
            
    except Exception as e:
        logger.warning(f"Failed to auto-detect Vulkan mapping: {e}")
    
    # Fallback: пустой маппинг (будет использоваться как есть)
    return {}

class LlamaRunner:
    """
    Manages the lifecycle of a llama.cpp RPC server background process.
    """
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.port: Optional[int] = None
        self.version_tag: Optional[str] = None
        self.pid: Optional[int] = None

    def start(self, version_tag: str, port: int, base_folder: str = "bin", selected_gpus: Optional[list] = None) -> bool:
        if selected_gpus is None:
            selected_gpus = []
        """
        Starts the llama.cpp RPC server process for a given version.

        Args:
            version_tag (str): The version to run (e.g., 'b8215_cuda').
            port (int): The port to bind the server to.
            base_folder (str): The root folder where versions are stored.

        Returns:
            bool: True if the process started successfully, False otherwise.
        """
        if self.process and self.process.poll() is None:
            logger.warning(f"A process is already running (PID: {self.pid}). Please stop it first.")
            return False

        version_path = os.path.join(base_folder, version_tag)
        if not os.path.isdir(version_path):
            logger.error(f"Version folder not found: {version_path}")
            return False

        # Find the executable file
        possible_executables = ['rpc-server.exe', 'llama-rpc-server.exe', 'server.exe']
        exe_path = None
        for exe_name in possible_executables:
            path = os.path.join(version_path, exe_name)
            if os.path.exists(path):
                exe_path = path
                break
        
        if not exe_path:
            logger.error(f"No RPC server executable found in {version_path}")
            return False

        # Form the command
        command = [exe_path, "--host", "0.0.0.0", "--port", str(port)]
        
        # Platform-specific flags to hide console window
        creation_flags = 0
        if platform.system() == "Windows":
            creation_flags = subprocess.CREATE_NO_WINDOW

        # Configure environment variables for GPU isolation
        env = os.environ.copy()
        if selected_gpus:
            gpus_str = ",".join(str(gpu) for gpu in selected_gpus)

            # 1. Порядок по шине PCI (чтобы 0, 1, 2 совпадали с nvidia-smi)
            env["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"

            # 2. Изоляция для CUDA
            env["CUDA_VISIBLE_DEVICES"] = gpus_str

            # 3. Изоляция для Vulkan
            # Автоматически определяем соответствие индексов
            if "vulkan" in version_tag.lower():
                vulkan_map = get_vulkan_device_mapping(version_path)
                if vulkan_map:
                    vulkan_selected = [str(vulkan_map.get(i, i)) for i in selected_gpus]
                    env["GGML_VK_VISIBLE_DEVICES"] = ",".join(vulkan_selected)
                    logger.info(f"Using Vulkan mapping: {vulkan_map}")
                else:
                    # Fallback: используем как есть
                    env["GGML_VK_VISIBLE_DEVICES"] = gpus_str
                    logger.warning("Vulkan mapping not detected, using direct indices")
            else:
                env["GGML_VK_VISIBLE_DEVICES"] = gpus_str

            # 4. Флаг для подавления встройки (если она мешает Вулкану)
            # Этот параметр заставляет Vulkan-слой NVIDIA игнорировать другие драйверы
            env["VK_LOADER_LAYERS_DISABLE"] = "~implicit~"

            logger.info(f"Isolating GPUs. Order: PCI_BUS_ID, Selected: {gpus_str}")
        
        try:
            logger.info(f"Starting RPC server with command: {' '.join(command)}")
            logger.info(f"Environment variables: {env}")
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
            
            self.version_tag = version_tag
            self.port = port
            self.pid = self.process.pid
            
            # Start background thread to read logs
            threading.Thread(target=self._read_logs, daemon=True).start()
            
            logger.info(f"Process started successfully with PID: {self.pid}")
            return True
        except Exception as e:
            logger.exception(f"Failed to start process: {e}")
            self.process = None
            return False

    def stop(self) -> bool:
        """
        Stops the currently running llama.cpp server process.

        Returns:
            bool: True if the process was stopped successfully or was not running.
        """
        if not self.process or self.process.poll() is not None:
            logger.info("Process is not running.")
            self._reset_state()
            return True

        logger.info(f"Stopping process with PID: {self.pid}...")
        try:
            self.process.terminate()
            self.process.wait(timeout=3)
            logger.info("Process terminated gracefully.")
        except subprocess.TimeoutExpired:
            logger.warning("Process did not terminate gracefully. Forcing kill.")
            self.process.kill()
        except Exception as e:
            logger.exception(f"Error while stopping process: {e}")
        finally:
            self._reset_state()
        
        return True

    def _read_logs(self):
        """Reads and logs output from the RPC server process."""
        try:
            while self.process and self.process.poll() is None:
                line = self.process.stdout.readline()
                if line:
                    logger.info(f"[RPC] {line.strip()}")
        except Exception as e:
            logger.error(f"Error reading logs: {e}")

    def _reset_state(self):
        """Resets all internal state variables."""
        self.process = None
        self.port = None
        self.version_tag = None
        self.pid = None

    def get_status(self) -> Dict[str, Any]:
        """
        Gets the current status of the managed process.
        If the process has terminated unexpectedly, the state is cleaned up.

        Returns:
            A dictionary containing the running status, PID, port, and version.
        """
        if self.process and self.process.poll() is not None:
            logger.warning(f"Process with PID {self.pid} terminated unexpectedly.")
            self._reset_state()

        return {
            "running": self.process is not None and self.process.poll() is None,
            "pid": self.pid,
            "port": self.port,
            "version_tag": self.version_tag
        }

# Global instance of the runner
runner = LlamaRunner()
