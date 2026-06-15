from analyzer.import_graph import ImportGraph
import sys
import json


def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <path>")
        sys.exit(1)
    g = ImportGraph(sys.argv[1])
    graph = g.build()
    print(json.dumps({k: sorted(list(v)) for k, v in graph.items()}, indent=2))


if __name__ == "__main__":
    main()
