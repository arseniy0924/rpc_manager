import os
import threading
import requests
import zipfile
import shutil
import logging
import time
from typing import List, Dict, Any, Optional

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global state for server-side binary management
SERVER_STATE: Dict[str, Any] = {
    "status": "IDLE",  # Can be IDLE, UPDATING
    "message": ""
}

def get_server_installed_versions(base_folder: str = "server_bin") -> List[str]:
    """
    Scans the base folder for installed llama.cpp versions for the server.
    Returns a list of folder names (version tags).
    """
    if not os.path.exists(base_folder):
        return []
    
    versions = []
    try:
        for entry in os.listdir(base_folder):
            full_path = os.path.join(base_folder, entry)
            if os.path.isdir(full_path):
                versions.append(entry)
    except OSError as e:
        logger.error(f"Error scanning server bin directory: {e}")
        pass
        
    return versions

def download_and_extract_server(url: str, version_tag: str, base_folder: str = "server_bin"):
    """
    Downloads and extracts a llama.cpp binary version for the server.
    This function is intended to be run in a background thread.
    It updates the global SERVER_STATE dictionary with its progress.
    """
    target_folder = os.path.join(base_folder, version_tag)
    temp_zip_path = f"server_llama_{version_tag}.zip"
    
    SERVER_STATE["status"] = "UPDATING"
    SERVER_STATE["message"] = f"Preparing to download {version_tag}..."
    
    try:
        # 1. Check Cache
        if os.path.exists(target_folder):
            expected_files = ['server.exe', 'llama-server.exe']
            if any(os.path.exists(os.path.join(target_folder, f)) for f in expected_files):
                SERVER_STATE["message"] = f"Version {version_tag} already exists."
                time.sleep(3) # Keep message visible for a moment
                return
        
        # 2. Preparation: Clean up destination folder if it exists but is incomplete
        if os.path.exists(target_folder):
            shutil.rmtree(target_folder)
        os.makedirs(target_folder, exist_ok=True)

        # 3. Download with Progress
        SERVER_STATE["message"] = f"Starting download of {version_tag}..."
        with requests.get(url, stream=True, timeout=30) as r:
            r.raise_for_status()
            total_size = int(r.headers.get('content-length', 0))
            downloaded_size = 0
            start_time = time.time()
            last_log_time = start_time
            
            with open(temp_zip_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded_size += len(chunk)
                        
                        current_time = time.time()
                        if current_time - last_log_time > 1:
                            elapsed_time = current_time - start_time
                            speed = downloaded_size / elapsed_time if elapsed_time > 0 else 0
                            
                            if total_size > 0:
                                percent = (downloaded_size / total_size) * 100
                                eta = (total_size - downloaded_size) / speed if speed > 0 else 0
                                SERVER_STATE["message"] = (f"Downloading: {downloaded_size / (1024*1024):.1f}MB / {total_size / (1024*1024):.1f}MB "
                                                           f"({percent:.1f}%) | {speed / (1024*1024):.1f} MB/s")
                            else:
                                SERVER_STATE["message"] = f"Downloading: {downloaded_size / (1024*1024):.1f}MB"
                            
                            last_log_time = current_time

        SERVER_STATE["message"] = "Download complete. Extracting..."
        
        # 4. Extraction
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            zip_ref.extractall(target_folder)
            
        SERVER_STATE["message"] = f"Extraction of {version_tag} successful."
        time.sleep(3)

    except Exception as e:
        logger.exception(f"Error during server update for {version_tag}: {e}")
        SERVER_STATE["message"] = f"Error: {e}"
        time.sleep(5) # Keep error message visible
        
        # Cleanup on failure
        if os.path.exists(temp_zip_path):
            os.remove(temp_zip_path)
        if os.path.exists(target_folder):
            shutil.rmtree(target_folder)
            
    finally:
        # 5. Cleanup and state reset
        if os.path.exists(temp_zip_path):
            os.remove(temp_zip_path)
        
        SERVER_STATE["status"] = "IDLE"
        SERVER_STATE["message"] = ""

def start_server_update(url: str, version_tag: str):
    """
    Starts the server binary download process in a background thread.
    """
    if SERVER_STATE["status"] == "UPDATING":
        logger.warning("An update is already in progress.")
        return

    logger.info(f"Starting background update for server binary: {version_tag}")
    
    thread = threading.Thread(
        target=download_and_extract_server,
        args=(url, version_tag),
        daemon=True
    )
    thread.start()
