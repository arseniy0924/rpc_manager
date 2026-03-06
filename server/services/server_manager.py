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


def download_and_extract_server(version_data: Dict[str, Any], version_tag: str, base_folder: str = "server_bin"):
    """
    Downloads and extracts a llama.cpp binary version for the server.
    Supports multiple assets (main binary + CUDA DLLs) while maintaining full progress tracking.
    """
    target_folder = os.path.join(base_folder, version_tag)

    SERVER_STATE["status"] = "UPDATING"
    SERVER_STATE["message"] = f"Preparing to download {version_tag}..."

    try:
        # 1. Check Cache
        if os.path.exists(target_folder):
            expected_files = ['server.exe', 'llama-server.exe']
            if any(os.path.exists(os.path.join(target_folder, f)) for f in expected_files):
                SERVER_STATE["message"] = f"Version {version_tag} already exists."
                time.sleep(3)
                return

        # 2. Preparation
        if os.path.exists(target_folder):
            shutil.rmtree(target_folder)
        os.makedirs(target_folder, exist_ok=True)

        # Формируем список задач: основной URL + все доп. ассеты (DLL)
        download_tasks = [{"url": version_data["url"], "filename": version_data.get("filename", f"llama_{version_tag}.zip")}]
        if "extra_assets" in version_data:
            download_tasks.extend(version_data["extra_assets"])

        for task in download_tasks:
            current_url = task["url"]
            current_filename = task["filename"]
            temp_zip_path = f"server_llama_{current_filename}"  # Индивидуальный путь для каждого архива

            # 3. Download with Progress (весь твой оригинальный код внутри цикла)
            SERVER_STATE["message"] = f"Starting download of {current_filename}..."
            with requests.get(current_url, stream=True, timeout=30) as r:
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
                                    SERVER_STATE["message"] = (
                                        f"Downloading {current_filename}: {downloaded_size / (1024 * 1024):.1f}MB / {total_size / (1024 * 1024):.1f}MB "
                                        f"({percent:.1f}%) | {speed / (1024 * 1024):.1f} MB/s")
                                else:
                                    SERVER_STATE[
                                        "message"] = f"Downloading {current_filename}: {downloaded_size / (1024 * 1024):.1f}MB"

                                last_log_time = current_time

            SERVER_STATE["message"] = f"Extracting {current_filename}..."

            # 4. Extraction
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(target_folder)

            # Удаляем временный файл текущего архива сразу после распаковки
            if os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)

        SERVER_STATE["message"] = f"Installation of {version_tag} with dependencies successful."
        time.sleep(3)

    except Exception as e:
        logger.exception(f"Error during server update for {version_tag}: {e}")
        SERVER_STATE["message"] = f"Error: {e}"
        time.sleep(5)
        # В случае ошибки удаляем папку, чтобы не оставлять битых файлов
        if os.path.exists(target_folder):
            shutil.rmtree(target_folder)

    finally:
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
