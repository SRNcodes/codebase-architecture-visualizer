import { useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import "./App.css";

const BACKEND = "http://127.0.0.1:8000";

function nodeColor(degree) {
  if (degree === 0) return "#4a4f5c";
  if (degree <= 2) return "#5b8def";
  if (degree <= 5) return "#7fd88f";
  return "#e5a44c";
}

function App() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [repoPath, setRepoPath] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");

  const analyzeRepo = async () => {
    if (!repoPath.trim()) return;
    setAnalyzing(true);
    setError("");
    setSelectedNode(null);
    setSummary("");
    try {
      const response = await fetch(`${BACKEND}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_path: repoPath }),
      });
      if (!response.ok) {
        throw new Error(`Analysis failed (${response.status})`);
      }
      const data = await response.json();
      const degree = {};
      data.edges.forEach((e) => {
        degree[e.source] = (degree[e.source] || 0) + 1;
        degree[e.target] = (degree[e.target] || 0) + 1;
      });
      setGraphData({
        nodes: data.nodes.map((n) => ({
          ...n,
          val: 1 + (degree[n.id] || 0) * 0.4,
          color: nodeColor(degree[n.id] || 0),
        })),
        links: data.edges,
      });
    } catch (err) {
      setError(err.message || "Failed to analyze repo");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleNodeClick = async (node) => {
    setSelectedNode(node);
    setSummary("");
    setSummaryLoading(true);
    try {
      const response = await fetch(`${BACKEND}/graph/${encodeURIComponent(node.id)}`);
      const data = await response.json();
      setSelectedNode(data);
    } catch (err) {
      setError("Failed to load node details");
    }

    try {
      const summaryResponse = await fetch(
        `${BACKEND}/summarize/${encodeURIComponent(node.id)}`
      );
      const summaryData = await summaryResponse.json();
      setSummary(summaryData.summary || "");
    } catch (err) {
      setSummary("Failed to generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  };

  const hasGraph = graphData.nodes.length > 0;

  return (
    <div className="App">
      <div className="sidebar">
        <h2>Codebase Visualizer</h2>
        <input
          className="repo-input"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && analyzeRepo()}
          placeholder="Enter repo path..."
        />
        <button className="analyze-button" onClick={analyzeRepo} disabled={analyzing}>
          {analyzing ? "Analyzing..." : "Analyze"}
        </button>
        {error && <div className="status-line error">{error}</div>}
        {!error && hasGraph && !analyzing && (
          <div className="status-line">
            {graphData.nodes.length} modules, {graphData.links.length} imports
          </div>
        )}

        {selectedNode && (
          <div className="node-detail">
            <h3>{selectedNode.id}</h3>
            <p className="file-path">{selectedNode.file}</p>

            <h4>Summary</h4>
            {summaryLoading ? (
              <p className="summary-loading">Generating summary...</p>
            ) : (
              <p className="summary-text">{summary}</p>
            )}

            <h4>Dependencies</h4>
            {selectedNode.dependencies?.length ? (
              <ul>
                {selectedNode.dependencies.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-list">None</p>
            )}

            <h4>Dependents</h4>
            {selectedNode.dependents?.length ? (
              <ul>
                {selectedNode.dependents.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-list">None</p>
            )}
          </div>
        )}
      </div>

      <div className="graph-container">
        {!hasGraph && !analyzing && (
          <div className="graph-placeholder">
            Enter a repo path and click Analyze to see the import graph
          </div>
        )}
        <ForceGraph2D
          graphData={graphData}
          nodeLabel="id"
          nodeVal="val"
          nodeColor="color"
          linkColor={() => "rgba(255,255,255,0.15)"}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          backgroundColor="#0d0e12"
          onNodeClick={handleNodeClick}
        />
      </div>
    </div>
  );
}

export default App;
