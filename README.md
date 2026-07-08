# Codebase Architecture Visualizer

Visualizes the import graph of a Python codebase as an interactive force-directed
graph, with AI-generated summaries of each module.

## Architecture

```
backend/            FastAPI app
  main.py           API endpoints (/analyze, /graph, /graph/{id}, /summarize/{id})
  analyzer/
    import_graph.py Parses Python files with tree-sitter and builds a module
                     import graph (nodes = modules, edges = import relationships)
    summarizer.py    Sends module source to the Claude API and caches the result

frontend/           React app
  src/App.js        Force-directed graph (react-force-graph-2d) + sidebar with
                     node details and AI summary
```

**Flow:** the frontend POSTs a repo path to `/analyze`, which walks the repo with
`ImportGraphExtractor`, parses every `.py` file's imports via tree-sitter, and
resolves them to in-repo modules. The resulting graph is cached server-side (in
memory) and rendered in the browser. Clicking a node fetches its dependencies,
dependents, and an LLM-generated summary of the file.

## Running it

### Backend

```bash
cd backend
python3 -m venv ../.venv   # if not already created
../.venv/bin/pip install -r requirements.txt
../.venv/bin/python3 -m uvicorn main:app --port 8000
```

To enable AI summaries, set an Anthropic API key before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or create backend/.env with ANTHROPIC_API_KEY=sk-ant-...
```

Without a key, `/summarize/{id}` returns a message telling you the key is missing
instead of erroring.

### Frontend

```bash
cd frontend
npm install
npm start
```

Opens at http://localhost:3000 and talks to the backend at http://127.0.0.1:8000.

## Usage

1. Enter an absolute path to a Python repo in the sidebar and click **Analyze**.
2. The import graph renders on the right — node size and color scale with how
   many modules import/are imported by that node.
3. Click a node to see its file path, dependencies, dependents, and an
   AI-generated summary of what the module does.

Tested against [pallets/flask](https://github.com/pallets/flask) (83 modules,
87 import edges).

## Known limitations

- Graph state is kept in a single in-memory variable on the backend — only one
  analyzed repo at a time, no persistence across restarts.
- Only Python import resolution is implemented (`import x`, `from x import y`,
  relative imports). No support for dynamic imports, namespace packages, or
  other languages.
- Summaries are cached in-process per module for the lifetime of the backend
  process, keyed by module ID.
