import requests
import logging
import time
import json
from typing import Dict, List, Optional, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class LlamaGitHubFetcher:
    """
    Fetches and parses release information from the ggerganov/llama.cpp GitHub repository.
    Implements caching to respect GitHub API rate limits.
    """
    
    GITHUB_API_URL = "https://api.github.com/repos/ggerganov/llama.cpp/releases"
    CACHE_DURATION_SECONDS = 1800  # 30 minutes

    def __init__(self):
        self._cache: Optional[List[Dict[str, Any]]] = None
        self._last_fetch_time: float = 0.0

    def fetch_latest_releases(self) -> List[Dict[str, Any]]:
        """
        Fetches the latest releases from GitHub API.
        Returns cached data if the cache is still valid (less than 30 minutes old).
        Handles API errors gracefully by returning cached data if available, or an empty list.
        """
        current_time = time.time()
        
        # Check cache validity
        if self._cache is not None and (current_time - self._last_fetch_time) < self.CACHE_DURATION_SECONDS:
            logger.info("Returning cached release data.")
            return self._cache

        logger.info("Fetching latest releases from GitHub...")
        try:
            response = requests.get(self.GITHUB_API_URL, timeout=10)
            
            if response.status_code == 200:
                releases = response.json()
                # Take only the last 3 releases
                self._cache = releases[:3]
                self._last_fetch_time = current_time
                return self._cache
            elif response.status_code == 403:
                logger.warning("GitHub API rate limit exceeded. Using cached data if available.")
            else:
                logger.error(f"Failed to fetch releases. Status code: {response.status_code}")
                
        except requests.RequestException as e:
            logger.error(f"Network error while fetching releases: {e}")

        # Return cached data if available, otherwise empty list
        return self._cache if self._cache is not None else []

    def parse_windows_assets(self, release_json: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        backends = {}
        assets = release_json.get('assets', [])

        # Сначала найдем основной исполняемый архив для каждой архитектуры
        for asset in assets:
            name = asset.get('name', '').lower()
            if not name.endswith('.zip') or 'win' not in name:
                continue

            # Игнорируем файлы библиотек на первом проходе
            if any(x in name for x in ['cudart', 'clblast', 'openblas']):
                continue

            download_url = asset.get('browser_download_url')
            size_mb = round(asset.get('size', 0) / (1024 * 1024), 2)

            info = {"url": download_url, "size_mb": size_mb, "filename": asset.get('name'), "extra_assets": []}

            if 'cuda' in name:
                key = 'cuda12' if 'cuda12' in name else 'cuda'
                backends[key] = info
            elif 'vulkan' in name:
                backends['vulkan'] = info
            elif 'avx2' in name:
                backends['avx2'] = info
            elif 'bin-win-x64.zip' in name:  # Базовая версия
                backends['cpu'] = info

        # Теперь вторым проходом добавим DLL (extra_assets) к соответствующим бэкендам
        for asset in assets:
            name = asset.get('name', '').lower()
            if 'cudart' in name and 'win' in name:
                # Добавляем рантайм CUDA к существующим cuda-бэкендам
                for key in backends:
                    if 'cuda' in key:
                        backends[key]['extra_assets'].append({
                            "url": asset.get('browser_download_url'),
                            "size_mb": round(asset.get('size', 0) / (1024 * 1024), 2),
                            "filename": asset.get('name')
                        })
        return backends

    def get_available_versions(self) -> Dict[str, Any]:
        """
        Orchestrates fetching and parsing to return a structured dictionary of available versions.
        
        Returns:
            Dict with tag_name as keys, containing release info and available backends.
        """
        releases = self.fetch_latest_releases()
        available_versions = {}
        
        for release in releases:
            tag_name = release.get('tag_name')
            if not tag_name:
                continue
                
            # Remove 'v' prefix if present for cleaner versioning, though llama.cpp usually uses bXXXX
            clean_tag = tag_name
            
            backends = self.parse_windows_assets(release)
            
            if backends: # Only include if we found valid windows assets
                available_versions[clean_tag] = {
                    "tag_name": tag_name,
                    "published_at": release.get('published_at'),
                    "html_url": release.get('html_url'),
                    "backends": backends
                }
                
        return available_versions

if __name__ == '__main__':
    fetcher = LlamaGitHubFetcher()
    versions = fetcher.get_available_versions()
    print(json.dumps(versions, indent=2))
