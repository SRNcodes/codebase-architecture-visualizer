"""
Import graph extractor for Python codebases, built on tree-sitter.

Walks a repository, parses every .py file, and builds a directed graph
where nodes are modules (files, identified by dotted module paths) and
edges represent import relationships between them.
"""

from pathlib import Path
from platform import node

import tree_sitter_python as tspython
from tree_sitter import Language, Parser

PY_LANGUAGE = Language(tspython.language())


class ImportGraphExtractor:
    def __init__(self, repo_root: str):
        # TODO: store repo_root as a resolved absolute Path
        self.repo_root = Path(repo_root).resolve()
        # TODO: create self.parser using PY_LANGUAGE
        self.parser = Parser(PY_LANGUAGE)
        # TODO: initialize self.module_index: dict[str, Path]
        #       (dotted module path -> file Path)
        self.module_index = {}
        # TODO: initialize self.edges: dict[str, set[str]]
        #       (dotted module path -> set of imported module paths)
        self.edges = {}

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------
    def discover_modules(self):
        """
        Find all .py files under self.repo_root and populate
        self.module_index by converting each file path to a dotted
        module path (e.g. mypkg/sub/thing.py -> mypkg.sub.thing,
        mypkg/__init__.py -> mypkg).
        """
        findings = self.repo_root.rglob('*.py')
        for file in findings:
            if not self._is_ignored(file):
                module_path = self._file_to_module(file)
                self.edges[module_path] = set()
                self.module_index[module_path] = file


    def _file_to_module(self, path: Path) -> str:
        """Convert a file path to a dotted module path relative to repo root."""
        file_path = path.relative_to(self.repo_root)
        parts = file_path.with_suffix('').parts  # remove .py suffix
        if parts[-1] == '__init__':
            parts = parts[:-1]  # drop __init__ for package modules
        return '.'.join(parts)
        

    def _is_ignored(self, path: Path) -> bool:
        """Return True if this path should be skipped (.git, venv, etc.)."""
        ignored_dirs = {'.git', 'venv', '__pycache__', '.venv'}
        return any(part in ignored_dirs for part in path.parts)

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------
    def parse_all(self):
        """
        For each module in self.module_index, parse the file with
        tree-sitter, extract its imports, resolve them to module paths
        in this repo, and populate self.edges.
        """
        for module_path, file_path in self.module_index.items():
            source = file_path.read_bytes()
            tree = self.parser.parse(source)
            raw_imports = self._extract_imports(tree.root_node, source)
            self.edges[module_path] = raw_imports

    def _extract_imports(self, root_node, source: bytes) -> set[str]:
        """
        Walk the AST and return the set of raw import targets as strings
        (e.g. "os", "collections", ".utils", "..pkg.thing").
        """
        imports = set()
        def walk(node):
            if node.type == "import_statement":
                name_node = node.child_by_field_name("name")
                if name_node is not None:
                    if name_node.type == "aliased_import":
                        name_node = name_node.child_by_field_name("name")
                    if name_node is not None:
                        imports.add(name_node.text.decode("utf-8"))
            elif node.type == "import_from_statement":
                module_node = node.child_by_field_name("module_name")
                if module_node is not None:
                    imports.add(module_node.text.decode("utf-8"))
            for child in node.children:
                walk(child)
    
        walk(root_node)
        return imports

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------
    def _resolve_import(self, importing_module: str, raw_import: str) -> str | None:
        """
        Resolve a raw import string to a module path in self.module_index,
        or return None if it's an external (stdlib/third-party) import.
        """
        pass

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------
    def to_graph_dict(self) -> dict:
        """Return {'nodes': [...], 'edges': [...]} for JSON serialization."""
        pass


if __name__ == "__main__":
    extractor = ImportGraphExtractor(".")
    extractor.discover_modules()
    extractor.parse_all()
    for module, imports in extractor.edges.items():
        if imports:  # only print modules that import something
            print(module, "->", imports)