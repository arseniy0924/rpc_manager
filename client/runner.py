import subprocess
import os
import logging
import platform
from typing import Optional, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LlamaRunner:
    """
    Manages the lifecycle of a llama.cpp RPC server background process.
    """
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.port: Optional[int] = None
        self.version_tag: Optional[str] = None
        self.pid: Optional[int] = None

    def start(self, version_tag: str, port: int, base_folder: str = "bin") -> bool:
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

        try:
            logger.info(f"Starting process: {' '.join(command)}")
            self.process = subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creation_flags
            )
            
            self.version_tag = version_tag
            self.port = port
            self.pid = self.process.pid
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
