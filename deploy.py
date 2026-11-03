#!/usr/bin/env python3
"""Copy this plugin into the Omarchy plugin directory."""
from pathlib import Path
import shutil

source = Path(__file__).resolve().parent
target = Path.home() / ".config/omarchy/plugins/jee.menu"
skip = {"deploy.py", "README.md", "test.js", ".git", "__pycache__"}
target.mkdir(parents=True, exist_ok=True)
for path in source.iterdir():
    if path.name not in skip and path.is_file():
        shutil.copy2(path, target / path.name)
print(f"Updated {target}")
