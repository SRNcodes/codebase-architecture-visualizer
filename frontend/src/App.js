import { useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const BACKEND = "http://127.0.0.1:8000";

function App() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [repoPath, setRepoPath] = useState("");

  const analyzeRepo = async () => {
    // TODO: POST to BACKEND/analyze with { repo_path: repoPath }
    // TODO: take the response and format it for ForceGraph2D
    // ForceGraph2D expects { nodes: [{id, ...}], links: [{source, target}] }
    // your API returns { nodes: [...], edges: [{source, target}] }
    // so you need to rename "edges" -> "links"
    fetch(`${BACKEND}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repo_path: repoPath }),
    })
      .then((response) => response.json())
      .then((data) => {
        const formattedData = {
          nodes: data.nodes,
          links: data.edges,
        };
        setGraphData(formattedData);
      })
      .catch((error) => {
        console.error("Error analyzing repo:", error);
      });
  };

  const handleNodeClick = async (node) => {
    fetch(`${BACKEND}/graph/${node.id}`)
    .then((response) => response.json())
    .then((data) => {
      setSelectedNode(data);
    })
    .catch((error) => {
      console.error("Error fetching node:", error);
    });
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ width: "300px", padding: "20px", background: "#1e1e1e", color: "white" }}>
        <h2>Codebase Visualizer</h2>
        <input
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="Enter repo path..."
          style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
        />
        <button onClick={analyzeRepo} style={{ width: "100%", padding: "8px" }}>
          Analyze
        </button>

        {selectedNode && (
          <div style={{ marginTop: "20px" }}>
            <h3>{selectedNode.id}</h3>
            <p style={{ fontSize: "12px", color: "#aaa" }}>{selectedNode.file}</p>
            <h4>Dependencies</h4>
            <ul>{selectedNode.dependencies?.map(d => <li key={d}>{d}</li>)}</ul>
            <h4>Dependents</h4>
            <ul>{selectedNode.dependents?.map(d => <li key={d}>{d}</li>)}</ul>
          </div>
        )}
      </div>

      <ForceGraph2D
        graphData={graphData}
        nodeLabel="id"
        onNodeClick={handleNodeClick}
      />
    </div>
  );
}

export default App;