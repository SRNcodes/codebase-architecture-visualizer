from pathlib import Path
import ast
from typing import Dict, Set, Union


class ImportGraph:
    """Build a simple import graph for Python files under a root directory.

    - Keys are module names relative to the root (path parts joined with '.')
    - Values are sets of imported module base names (the first part of an import)
    """

    def __init__(self, root: Union[str, Path]):
        self.root = Path(root)
        if not self.root.exists():
            raise ValueError(f"Root path does not exist: {self.root}")

    def _module_name_for_path(self, path: Path) -> str:
        rel = path.relative_to(self.root)
        # drop suffix
        parts = rel.with_suffix("").parts
        return ".".join(parts)

    def _parse_imports(self, source: str) -> Set[str]:
        tree = ast.parse(source)
        imports: Set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    base = alias.name.split(".")[0]
                    imports.add(base)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    base = node.module.split(".")[0]
                    imports.add(base)
                elif node.level:
                    # relative import with no module name, ignore or mark as local
                    # we leave it out because resolving relative imports requires package context
                    pass
        return imports

    def build(self) -> Dict[str, Set[str]]:
        graph: Dict[str, Set[str]] = {}
        for py in sorted(self.root.rglob("*.py")):
            # skip files outside the root or hidden directories if desired
            try:
                module = self._module_name_for_path(py)
            except Exception:
                continue
            try:
                src = py.read_text(encoding="utf8")
            except Exception:
                src = ""
            imports = self._parse_imports(src)
            # remove imports that refer to the same top-level package as the module
            module_base = module.split(".")[0] if module else None
            if module_base and module_base in imports:
                imports.discard(module_base)
            graph[module] = imports
        return graph


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) < 2:
        print("Usage: python import_graph.py <path-to-scan>")
        sys.exit(1)
    g = ImportGraph(sys.argv[1])
    graph = g.build()
    print(json.dumps({k: sorted(list(v)) for k, v in graph.items()}, indent=2))
