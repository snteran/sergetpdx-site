import pathlib
import sys

# Let the tests "import handler" from backend/src.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "src"))
