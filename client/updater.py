import requests
import zipfile
import os
import shutil
import logging
import time
from typing import Optional, Callable, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def download_and_extract(version_data: Dict[str, Any], version_tag: str, base_folder: str = "bin",
                         progress_callback: Optional[Callable[[str], None]] = None) -> Optional[str]:
    """
    Downloads a zip archive (and any extra assets) from the given data and extracts it to a versioned folder.
    """
    target_folder = os.path.join(base_folder, version_tag)

    def log_and_callback(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    # 1. Check Cache
    if os.path.exists(target_folder):
        # rpc-server.exe добавлен в список ожидаемых файлов
        expected_files = ['llama-server.exe', 'server.exe', 'main.exe', 'llama-cli.exe', 'llama.exe', 'rpc-server.exe']
        found = False
        for f in expected_files:
            if os.path.exists(os.path.join(target_folder, f)):
                found = True
                break

        if found:
            log_and_callback(f"Version {version_tag} already exists and is valid. Skipping download.")
            return target_folder
        else:
            logger.warning(f"Folder for {version_tag} exists but seems incomplete. Re-downloading.")
            shutil.rmtree(target_folder, ignore_errors=True)

    try:
        os.makedirs(base_folder, exist_ok=True)
        os.makedirs(target_folder, exist_ok=True)

        # 2. Формируем очередь загрузки (основной файл + DLL)
        download_tasks = [
            {"url": version_data["url"], "filename": version_data.get("filename", f"llama_{version_tag}.zip")}]
        if "extra_assets" in version_data:
            download_tasks.extend(version_data["extra_assets"])

        for task in download_tasks:
            current_url = task["url"]
            current_filename = task.get("filename", f"asset_{int(time.time())}.zip")
            temp_zip_path = os.path.join(base_folder, f"temp_{current_filename}")

            # 3. Download with Progress
            log_and_callback(f"Starting download of {current_filename}")

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
                                    msg = (f"Downloading {current_filename}: "
                                           f"{downloaded_size / (1024 * 1024):.1f} MB / {total_size / (1024 * 1024):.1f} MB "
                                           f"({percent:.1f}%) | Speed: {speed / (1024 * 1024):.1f} MB/s | ETA: {eta:.0f}s")
                                else:
                                    msg = (f"Downloading {current_filename}: "
                                           f"{downloaded_size / (1024 * 1024):.1f} MB | Speed: {speed / (1024 * 1024):.1f} MB/s")

                                log_and_callback(msg)
                                last_log_time = current_time

            # 4. Extraction
            log_and_callback(f"Extracting {current_filename}...")
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(target_folder)

            # Очистка временного архива
            if os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)

        log_and_callback(f"Extraction of {version_tag} with dependencies completed successfully.")
        return target_folder

    except (requests.exceptions.RequestException, zipfile.BadZipFile, OSError) as e:
        error_msg = f"Error during update of {version_tag}: {e}"
        logger.error(error_msg)
        if progress_callback:
            progress_callback(error_msg)

        if os.path.exists(target_folder):
            shutil.rmtree(target_folder, ignore_errors=True)
        return None

    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        if progress_callback:
            progress_callback(f"Unexpected error: {e}")
        return None