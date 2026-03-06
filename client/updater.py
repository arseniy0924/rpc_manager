import requests
import zipfile
import os
import shutil
import logging
import time
from typing import Optional, Callable

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def download_and_extract(url: str, version_tag: str, base_folder: str = "bin", progress_callback: Optional[Callable[[str], None]] = None) -> Optional[str]:
    """
    Downloads a zip archive from the given URL and extracts it to a versioned folder.
    
    Args:
        url (str): Direct download URL of the zip file.
        version_tag (str): Unique tag for the version (e.g., 'b1615_cuda').
        base_folder (str): Root folder where versions are stored. Defaults to "bin".
        progress_callback (callable, optional): Function to call with status updates.
                           
    Returns:
        Optional[str]: Path to the extracted folder if successful, None otherwise.
    """
    target_folder = os.path.join(base_folder, version_tag)
    temp_zip_path = f"llama_{version_tag}.zip"
    
    def log_and_callback(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    # 1. Check Cache
    if os.path.exists(target_folder):
        # Check for key executables to ensure it's not an empty/corrupt folder
        # llama.cpp binaries often change names, checking for common ones
        expected_files = ['llama-server.exe', 'server.exe', 'main.exe', 'llama-cli.exe', 'llama.exe']
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
        # Ensure base folder exists
        os.makedirs(base_folder, exist_ok=True)

        # 2. Download with Progress
        log_and_callback(f"Starting download of {version_tag} from: {url}")
        
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
                        # Log progress every 1 second or if finished
                        if current_time - last_log_time > 1:
                            elapsed_time = current_time - start_time
                            speed = downloaded_size / elapsed_time if elapsed_time > 0 else 0
                            
                            msg = ""
                            if total_size > 0:
                                percent = (downloaded_size / total_size) * 100
                                eta = (total_size - downloaded_size) / speed if speed > 0 else 0
                                msg = (f"Downloading {version_tag}: "
                                       f"{downloaded_size / (1024*1024):.1f} MB / {total_size / (1024*1024):.1f} MB "
                                       f"({percent:.1f}%) | Speed: {speed / (1024*1024):.1f} MB/s | ETA: {eta:.0f}s")
                            else:
                                msg = (f"Downloading {version_tag}: "
                                       f"{downloaded_size / (1024*1024):.1f} MB | Speed: {speed / (1024*1024):.1f} MB/s")
                            
                            log_and_callback(msg)
                            last_log_time = current_time

        log_and_callback(f"Download completed. Total size: {downloaded_size / (1024*1024):.2f} MB")

        # 3. Extraction
        log_and_callback(f"Extracting archive to: {target_folder}")
        # Create target folder
        os.makedirs(target_folder, exist_ok=True)
        
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            zip_ref.extractall(target_folder)
            
        log_and_callback(f"Extraction of {version_tag} completed successfully.")
        
        # 4. Cleanup Zip
        if os.path.exists(temp_zip_path):
            os.remove(temp_zip_path)
            
        return target_folder

    except (requests.exceptions.RequestException, zipfile.BadZipFile, OSError) as e:
        error_msg = f"Error during update of {version_tag}: {e}"
        logger.error(error_msg)
        if progress_callback:
            progress_callback(error_msg)
        
        # Cleanup on failure
        if os.path.exists(temp_zip_path):
            try:
                os.remove(temp_zip_path)
                logger.info("Cleaned up partial zip file.")
            except OSError:
                pass
                
        if os.path.exists(target_folder):
            try:
                shutil.rmtree(target_folder)
                logger.info("Cleaned up partial installation folder.")
            except OSError:
                pass
                
        return None
        
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        if progress_callback:
            progress_callback(f"Unexpected error: {e}")
        return None

if __name__ == '__main__':
    # Test URL (using a specific release asset for testing)
    # Note: This URL might expire or change, in a real app use the fetcher to get a fresh URL.
    # Using a relatively small asset for quick testing if possible, or a standard one.
    TEST_URL = "https://github.com/ggml-org/llama.cpp/releases/download/b8213/llama-b8213-bin-win-vulkan-x64.zip"
    TEST_TAG = "test_b3165_avx2"
    
    def test_callback(msg):
        print(f"[CALLBACK] {msg}")

    print("--- TEST RUN 1: Download ---")
    path1 = download_and_extract(TEST_URL, TEST_TAG, "test_bin", progress_callback=test_callback)
    
    if path1:
        print(f"Success! Installed at: {path1}")
        
        print("\n--- TEST RUN 2: Cache Hit ---")
        path2 = download_and_extract(TEST_URL, TEST_TAG, "test_bin", progress_callback=test_callback)
        
        if path2 == path1:
            print("Cache test PASSED!")
        else:
            print("Cache test FAILED.")
    else:
        print("Download failed.")
