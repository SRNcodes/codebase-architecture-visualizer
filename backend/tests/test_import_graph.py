import tempfile
from pathlib import Path
import textwrap

from analyzer.import_graph import ImportGraphExtractor


def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content))


def test_simple_imports(tmp_path):
    # create a small package structure
    pkg = tmp_path / "mypkg"
    pkg.mkdir(parents=True, exist_ok=True)
    write_file(pkg / "__init__.py", "")
    write_file(pkg / "a.py", "from mypkg.b import B\nimport os\n")
    write_file(pkg / "b.py", "import sys\n")

    g = ImportGraphExtractor(tmp_path)
    g.discover_modules()
    g.parse_all()
    graph = g.edges

    # module names should be relative to the tmp_path
    assert "mypkg.a" in graph
    assert "mypkg.b" in graph

    # os and sys are external imports, so they're not resolved into the graph
    assert "mypkg.b" in graph["mypkg.a"]
    assert "mypkg" not in graph["mypkg.a"]
    assert graph["mypkg.b"] == set()
