"""
Import graph extractor for Python codebases, built on tree-sitter.

Walks a repository, parses every .py file, and builds a directed graph
where nodes are modules (files, identified by dotted module paths) and
edges represent import relationships between them.
"""

from pathlib import Path

import tree_sitter_python as tspython
from tree_sitter import Language, Parser

PY_LANGUAGE = Language(tspython.language())

# Common source-root directories: code under these typically isn't part of
# the dotted import path (e.g. src/mypkg/foo.py is imported as
# `import mypkg.foo`, not `import src.mypkg.foo`, because the layout adds
# the root to sys.path). Tried as a fallback when a plain match fails.
_SRC_ROOTS = ("src", "lib", "source")


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
        for module_path, file_path in self.module_index.items():
            source = file_path.read_bytes()
            tree = self.parser.parse(source)
            raw_imports = self._extract_imports(tree.root_node, source)
            for raw in raw_imports:
                resolved = self._resolve_import(module_path, raw)
                if resolved and resolved != module_path:
                    self.edges[module_path].add(resolved)

    def _extract_imports(self, root_node, source: bytes) -> set[str]:
        """
        Walk the AST and return the set of raw import targets as strings
        (e.g. "os", "collections", ".utils", "..pkg.thing").

        For `from X import a, b`, each imported name is also joined onto the
        module path (e.g. "pkg.sub", "pkg.sub.mod") since the name may be a
        submodule rather than an attribute — `_resolve_import`'s prefix
        search then tries the most specific candidate first and falls back
        to the bare module path if the name isn't itself a module.
        """
        imports = set()

        def join(module_text: str, name_text: str) -> str:
            # A pure-dots relative prefix (".", "..") needs no separator
            # before the name; a module with a trailing name does.
            if module_text.endswith('.'):
                return f"{module_text}{name_text}"
            return f"{module_text}.{name_text}"

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
                    module_text = module_node.text.decode("utf-8")
                    imports.add(module_text)
                    for name_node in node.children_by_field_name("name"):
                        if name_node.type == "wildcard_import":
                            continue
                        if name_node.type == "aliased_import":
                            name_node = name_node.child_by_field_name("name")
                        if name_node is not None:
                            name_text = name_node.text.decode("utf-8")
                            imports.add(join(module_text, name_text))
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
        if raw_import.startswith('.'):
            # relative import (your code here, fix later)
            level = len(raw_import) - len(raw_import.lstrip('.'))
            base_parts = importing_module.split('.')[:-level] if level > 0 else importing_module.split('.')
            remainder = raw_import.lstrip('.')
            candidate = '.'.join(base_parts + [remainder]) if remainder else '.'.join(base_parts)
            return candidate if candidate in self.module_index else None
        else:
            # absolute import — try progressively shorter prefixes
            parts = raw_import.split('.')
            candidate = self._match_prefix(parts)
            if candidate:
                return candidate
            # src/lib layouts add the root to sys.path, so code imports
            # "mypkg.foo" for a file actually stored at "src.mypkg.foo" —
            # retry with each known source root prepended.
            for root in _SRC_ROOTS:
                candidate = self._match_prefix([root, *parts])
                if candidate:
                    return candidate
            return None

    def _match_prefix(self, parts: list[str]) -> str | None:
        """Try progressively shorter dotted prefixes of `parts` against the
        module index, longest (most specific) first."""
        for i in range(len(parts), 0, -1):
            candidate = '.'.join(parts[:i])
            if candidate in self.module_index:
                return candidate
        return None

    # ------------------------------------------------------------------
    # Output
    # ------------------------------------------------------------------
    def to_graph_dict(self) -> dict:
        """Return {'nodes': [...], 'edges': [...]} for JSON serialization."""
        return {
            "nodes": [{"id": module_path, "file": str(file_path)} for module_path, file_path in self.module_index.items()],
            "edges": [
                        {"source": src, "target": dst}
                        for src, targets in self.edges.items()
                        for dst in targets
                    ]
        }


if __name__ == "__main__":
    import json
    extractor = ImportGraphExtractor("backend")
    extractor.discover_modules()
    extractor.parse_all()
    print(json.dumps(extractor.to_graph_dict(), indent=2))