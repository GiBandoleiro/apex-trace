"""Fetch CC0 Poly Haven PBR surfaces and package power-of-two WebP maps.

Source: https://polyhaven.com/license (CC0). The API supplies the exact 1K
download URLs, so this script does not depend on guessed CDN paths.
"""

from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
import json

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "textures" / "photo"
SURFACES = {
    "asphalt": ("aerial_asphalt_01", 1024),
    "dirt": ("dirt_aerial_02", 1024),
    "grass": ("grass_ground", 1024),
    "gravel": ("gravel_ground_01", 512),
    "concrete": ("concrete_floor_worn_02", 512),
    "sand": ("aerial_sand", 512),
    "snow": ("snow_02", 512),
    "basalt": ("aerial_rocks_01", 512),
}
MAPS = {"color": "Diffuse", "normal": "nor_gl", "roughness": "Rough"}


def download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "ApexTraceAssetBuilder/1.0 (CC0 asset packaging)"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for surface, (slug, size) in SURFACES.items():
        metadata = json.loads(download(f"https://api.polyhaven.com/files/{slug}"))
        for name, kind in MAPS.items():
            target = OUT / f"{surface}-{name}.webp"
            if target.exists():
                print(f"keep {target.name}")
                continue
            url = metadata[kind]["1k"]["jpg"]["url"]
            image = Image.open(BytesIO(download(url))).convert("RGB")
            if image.size != (size, size):
                image = image.resize((size, size), Image.Resampling.LANCZOS)
            image.save(target, "WEBP", quality=88 if name == "normal" else 84, method=6)
            print(f"saved {target.name}: {target.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
