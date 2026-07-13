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


def test_from_dot_import_submodule(tmp_path):
    # `from . import utils` should resolve to the sibling submodule, not
    # just the enclosing package.
    pkg = tmp_path / "mypkg"
    pkg.mkdir(parents=True, exist_ok=True)
    write_file(pkg / "__init__.py", "")
    write_file(pkg / "mod.py", "from . import utils\n")
    write_file(pkg / "utils.py", "")

    g = ImportGraphExtractor(tmp_path)
    g.discover_modules()
    g.parse_all()
    graph = g.edges

    assert "mypkg.utils" in graph["mypkg.mod"]


def test_from_dotted_package_import_submodule(tmp_path):
    # `from pkg.sub import mod` where mod.py is a submodule (not just an
    # attribute defined in sub/__init__.py) should target the submodule.
    pkg = tmp_path / "pkg" / "sub"
    pkg.mkdir(parents=True, exist_ok=True)
    write_file(pkg / "__init__.py", "")
    write_file(pkg / "mod.py", "")
    write_file(tmp_path / "pkg" / "__init__.py", "")
    write_file(tmp_path / "pkg" / "user.py", "from pkg.sub import mod\n")

    g = ImportGraphExtractor(tmp_path)
    g.discover_modules()
    g.parse_all()
    graph = g.edges

    assert "pkg.sub.mod" in graph["pkg.user"]


def test_from_import_falls_back_to_attribute(tmp_path):
    # `from pkg import thing` where `thing` is just a name defined in
    # pkg/__init__.py (not a submodule) should still resolve to pkg itself.
    pkg = tmp_path / "pkg"
    pkg.mkdir(parents=True, exist_ok=True)
    write_file(pkg / "__init__.py", "thing = 1\n")
    write_file(pkg / "user.py", "from pkg import thing\n")

    g = ImportGraphExtractor(tmp_path)
    g.discover_modules()
    g.parse_all()
    graph = g.edges

    assert "pkg" in graph["pkg.user"]


def test_src_layout_fallback(tmp_path):
    # A src/ layout adds src/ to sys.path, so code imports "mypkg.foo"
    # even though the file lives at src/mypkg/foo.py.
    pkg = tmp_path / "src" / "mypkg"
    pkg.mkdir(parents=True, exist_ok=True)
    write_file(pkg / "__init__.py", "")
    write_file(pkg / "foo.py", "")
    write_file(pkg / "bar.py", "import mypkg.foo\n")

    g = ImportGraphExtractor(tmp_path)
    g.discover_modules()
    g.parse_all()
    graph = g.edges

    assert "src.mypkg.foo" in graph["src.mypkg.bar"]
