import tree_sitter_python as tspython
from tree_sitter import Language, Parser


PY_LANGUAGE = Language(tspython.language())
parser = Parser(PY_LANGUAGE)

code = b"""
import os
from collections import OrderedDict
from . import utils
from ..pkg import thing
from .sibling import helper

def foo():
    return os.path.join('a', 'b')
"""

tree = parser.parse(code)
print(tree.root_node)

code = b"import tree_sitter_python as tspython"
tree = parser.parse(code)
print(tree.root_node)