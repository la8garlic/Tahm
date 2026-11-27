"""Prepare the licensed offline font from Xiaomi's official distribution."""
import argparse
import hashlib
from pathlib import Path
import shutil
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

from fontTools.ttLib.woff2 import compress

URL = "https://hyperos.mi.com/font-download/MiSans.zip"
SOURCE_SHA = "0ddef90648998900175cfdca9a6f087a2544c182f130b0ad4f7e94a03a115e79"
WEB_SHA = "8aa2552809c5144e37a17f5274a872380a96d7e0979e0af7d99b8c821bce9f1f"
OUTPUT = Path(__file__).resolve().parents[1] / "web/fonts/MiSansVF.woff2"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare(archive):
    if OUTPUT.is_file() and digest(OUTPUT) == WEB_SHA:
        print("MiSans VF verified")
        return
    OUTPUT.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUTPUT.parent) as temp:
        stage = Path(temp)
        if archive is None:
            archive = stage / "MiSans.zip"
            with urlopen(URL, timeout=120) as response, archive.open("wb") as out:
                shutil.copyfileobj(response, out)
        source = stage / "MiSansVF.ttf"
        with ZipFile(archive) as package:
            entry, = (n for n in package.namelist() if n.endswith("/MiSansVF.ttf"))
            with package.open(entry) as data, source.open("wb") as out:
                shutil.copyfileobj(data, out)
        if digest(source) != SOURCE_SHA:
            raise ValueError("Unexpected Xiaomi font version; review the upstream file and license.")
        font = stage / OUTPUT.name
        compress(source, font)
        if digest(font) != WEB_SHA:
            raise ValueError("WOFF2 digest mismatch; use the pinned font preparation tools.")
        font.replace(OUTPUT)
    print("MiSans VF prepared and verified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="existing official MiSans.zip")
    prepare(parser.parse_args().archive)
