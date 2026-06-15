import tempfile
from pathlib import Path
import textwrap

from analyzer.import_graph import ImportGraph


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

    g = ImportGraph(tmp_path)
    graph = g.build()

    # module names should be relative to the tmp_path
    assert "mypkg.a" in graph
    assert "mypkg.b" in graph

    assert "os" in graph["mypkg.a"]
    assert "mypkg" not in graph["mypkg.a"]
    assert "sys" in graph["mypkg.b"]
