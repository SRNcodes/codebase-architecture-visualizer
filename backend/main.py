from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from analyzer.import_graph import ImportGraphExtractor
from analyzer.summarizer import ModuleSummarizer

load_dotenv()

app = FastAPI()
_summarizer = ModuleSummarizer()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_last_graph = None

class AnalyzeRequest(BaseModel):
    repo_path: str


def main():    # placeholder for any startup logic
    pass

@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    global _last_graph
    # run extractor, store in _last_graph, return it
    extractor = ImportGraphExtractor(request.repo_path)
    extractor.discover_modules()
    extractor.parse_all()
    _last_graph = extractor.to_graph_dict()
    return _last_graph


@app.get("/graph/{node_id}")
def get_node(node_id: str):
    if _last_graph is None:
        raise HTTPException(status_code=404, detail="No graph computed yet")
    
    node = next((n for n in _last_graph["nodes"] if n["id"] == node_id), None)
    
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    
    dependencies = [e["target"] for e in _last_graph["edges"] if e["source"] == node_id]
    dependents = [e["source"] for e in _last_graph["edges"] if e["target"] == node_id]

    return {
        **node,
        "dependencies": dependencies,
        "dependents": dependents,
    }

@app.get("/summarize/{node_id}")
def summarize_node(node_id: str):
    if _last_graph is None:
        raise HTTPException(status_code=404, detail="No graph computed yet")

    node = next((n for n in _last_graph["nodes"] if n["id"] == node_id), None)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")

    summary = _summarizer.summarize(node_id, node["file"])
    return {"id": node_id, "summary": summary}


@app.get("/graph")
def get_graph():
    if _last_graph is not None:
        return _last_graph
    raise HTTPException(status_code=404, detail="No graph computed yet")



if __name__ == "__main__":
    main()
