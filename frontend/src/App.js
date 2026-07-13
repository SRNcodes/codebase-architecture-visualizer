import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceX, forceY } from "d3-force-3d";
import "./App.css";

const BACKEND = "http://127.0.0.1:8000";
const SURFACE_COLOR = "#0d0e12";

// Validated categorical palette (dark mode), ordered for max CVD separation.
// See: node scripts/validate_palette.js against surface #0d0e12 — all checks pass.
const PACKAGE_COLORS = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
];
const OTHER_COLOR = "#5b6070";
const HUB_COUNT = 12;

// Group modules by top-level package so related files cluster visually.
// A generic "src"/"lib" layout collapses everything into one bucket, so for
// those we keep one extra path segment.
function packageOf(id) {
  const parts = id.split(".");
  if (parts.length <= 1) return parts[0];
  if (["src", "lib", "source"].includes(parts[0]) && parts.length > 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return parts[0];
}

function shortName(id) {
  const parts = id.split(".");
  return parts[parts.length - 1];
}

function endpointId(endpoint) {
  return typeof endpoint === "object" && endpoint !== null ? endpoint.id : endpoint;
}

// react-force-graph's built-in hover tooltip sets innerHTML directly, and
// module names come from scanning arbitrary files on disk — escape before
// it reaches that tooltip.
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function buildGraph(data) {
  const degree = {};
  const neighbors = new Map();
  data.edges.forEach((e) => {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source).add(e.target);
    neighbors.get(e.target).add(e.source);
  });

  const packageCounts = new Map();
  data.nodes.forEach((n) => {
    const pkg = packageOf(n.id);
    packageCounts.set(pkg, (packageCounts.get(pkg) || 0) + 1);
  });
  const rankedPackages = [...packageCounts.entries()].sort((a, b) => b[1] - a[1]);
  const packageColor = new Map();
  rankedPackages.forEach(([pkg], i) => {
    packageColor.set(pkg, i < PACKAGE_COLORS.length ? PACKAGE_COLORS[i] : OTHER_COLOR);
  });

  const hubThreshold = [...Object.values(degree)]
    .sort((a, b) => b - a)[Math.min(HUB_COUNT, Object.values(degree).length) - 1] || Infinity;

  const nodes = data.nodes.map((n) => {
    const d = degree[n.id] || 0;
    const pkg = packageOf(n.id);
    return {
      ...n,
      pkg,
      degree: d,
      color: packageColor.get(pkg),
      shortName: shortName(n.id),
      r: Math.min(20, 4 + Math.sqrt(d) * 2.6),
      isHub: d > 0 && d >= hubThreshold,
    };
  });

  const legend = rankedPackages.slice(0, PACKAGE_COLORS.length).map(([pkg, count]) => ({
    pkg,
    count,
    color: packageColor.get(pkg),
  }));
  const otherCount = rankedPackages
    .slice(PACKAGE_COLORS.length)
    .reduce((sum, [, count]) => sum + count, 0);
  if (otherCount > 0) legend.push({ pkg: "Other", count: otherCount, color: OTHER_COLOR });

  return { nodes, links: data.edges, neighbors, legend };
}

function App() {
  const [graph, setGraph] = useState({ nodes: [], links: [], neighbors: new Map(), legend: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [repoPath, setRepoPath] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [isolatedPkg, setIsolatedPkg] = useState(null);
  const fgRef = useRef();
  const shouldFitRef = useRef(false);

  const analyzeRepo = async () => {
    if (!repoPath.trim()) return;
    setAnalyzing(true);
    setError("");
    setSelectedNode(null);
    setSummary("");
    setSearch("");
    setIsolatedPkg(null);
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
      setGraph(buildGraph(data));
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

  const hasGraph = graph.nodes.length > 0;

  // Cluster nodes by package: a weak radial pull per package plus the
  // default link/charge forces spreads the graph into legible groups
  // instead of one undifferentiated blob.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graph.nodes.length === 0) return;

    // Hub nodes repel harder (so dense clusters stay legible); isolated
    // nodes barely repel at all, so the cluster pull below can actually
    // hold them near their package instead of getting flung outward.
    fg.d3Force("charge").strength((n) => -30 - Math.min(n.degree, 8) * 18);
    fg.d3Force("link").distance(45).strength(0.4);

    const packages = [...new Set(graph.nodes.map((n) => n.pkg))];
    const angleStep = (2 * Math.PI) / Math.max(1, packages.length);
    const clusterRadius = 70 + packages.length * 12;
    const centers = new Map(
      packages.map((pkg, i) => [
        pkg,
        { x: Math.cos(i * angleStep) * clusterRadius, y: Math.sin(i * angleStep) * clusterRadius },
      ])
    );

    fg.d3Force("x", forceX((n) => centers.get(n.pkg)?.x ?? 0).strength(0.35));
    fg.d3Force("y", forceY((n) => centers.get(n.pkg)?.y ?? 0).strength(0.35));
    fg.d3ReheatSimulation();
    shouldFitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes]);

  // What should be drawn at full brightness right now: a search match set,
  // an isolated package cluster, or the hovered/selected node plus its
  // direct neighbors. Everything else dims — this is what makes "how is X
  // connected" (or "what's in this package") answerable at a glance.
  const highlight = useMemo(() => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matched = new Set(
        graph.nodes.filter((n) => n.id.toLowerCase().includes(q)).map((n) => n.id)
      );
      return matched.size ? { nodes: matched, focus: null } : null;
    }
    if (isolatedPkg) {
      const topPkgs = new Set(
        graph.legend.filter((e) => e.pkg !== "Other").map((e) => e.pkg)
      );
      const matched = new Set(
        graph.nodes
          .filter((n) =>
            isolatedPkg === "Other" ? !topPkgs.has(n.pkg) : n.pkg === isolatedPkg
          )
          .map((n) => n.id)
      );
      return { nodes: matched, focus: null };
    }
    const activeId = hoveredId || selectedNode?.id;
    if (!activeId) return null;
    const neigh = graph.neighbors.get(activeId) || new Set();
    return { nodes: new Set([activeId, ...neigh]), focus: activeId };
  }, [search, isolatedPkg, hoveredId, selectedNode, graph]);

  useEffect(() => {
    if (!fgRef.current || !highlight) return;
    if (!search.trim() && !isolatedPkg) return;
    fgRef.current.zoomToFit(400, 80, (n) => highlight.nodes.has(n.id));
  }, [search, isolatedPkg, highlight]);

  const toggleIsolatedPkg = (pkg) => {
    setSearch("");
    setIsolatedPkg((current) => (current === pkg ? null : pkg));
  };

  const resetView = () => {
    if (fgRef.current) fgRef.current.zoomToFit(400, 60);
  };

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
            {graph.nodes.length} modules, {graph.links.length} imports
          </div>
        )}

        {hasGraph && (
          <>
            <input
              className="repo-input search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a module..."
            />

            <div className="legend">
              {graph.legend.map((entry) => {
                const isActive = isolatedPkg === entry.pkg;
                const isDimmed = isolatedPkg && !isActive;
                return (
                  <button
                    type="button"
                    className={`legend-row${isActive ? " active" : ""}${isDimmed ? " dimmed" : ""}`}
                    key={entry.pkg}
                    onClick={() => toggleIsolatedPkg(entry.pkg)}
                    title={`Show only ${entry.pkg}`}
                  >
                    <span className="legend-dot" style={{ background: entry.color }} />
                    <span className="legend-name">{entry.pkg}</span>
                    <span className="legend-count">{entry.count}</span>
                  </button>
                );
              })}
            </div>
            {isolatedPkg && (
              <button
                type="button"
                className="clear-isolate-button"
                onClick={() => setIsolatedPkg(null)}
              >
                Clear filter
              </button>
            )}
            <p className="hint-text">
              Click a package to isolate it. Arrows point from the importing
              module to the module it imports.
            </p>
          </>
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

      <div className={`graph-container${analyzing ? " is-analyzing" : ""}`}>
        {!hasGraph && !analyzing && (
          <div className="graph-placeholder">
            Enter a repo path and click Analyze to see the import graph.
            <br />
            Modules cluster by package — hover or click a node to trace its
            connections; click empty space to clear.
          </div>
        )}
        {analyzing && (
          <div className="graph-loading">
            <div className="spinner" />
            <p>Analyzing repo…</p>
          </div>
        )}
        {hasGraph && (
          <button
            type="button"
            className="reset-view-button"
            onClick={resetView}
            title="Re-fit the graph to the view"
          >
            Reset view
          </button>
        )}
        <ForceGraph2D
          ref={fgRef}
          graphData={graph}
          backgroundColor={SURFACE_COLOR}
          onNodeClick={handleNodeClick}
          onNodeHover={(node) => setHoveredId(node ? node.id : null)}
          onBackgroundClick={() => {
            setSelectedNode(null);
            setSearch("");
            setIsolatedPkg(null);
          }}
          onEngineStop={() => {
            if (shouldFitRef.current) {
              shouldFitRef.current = false;
              fgRef.current.zoomToFit(400, 60);
            }
          }}
          cooldownTicks={100}
          maxZoom={6}
          nodeRelSize={4}
          nodeLabel={(node) =>
            `${escapeHtml(node.id)} · ${node.degree} connection${node.degree === 1 ? "" : "s"}`
          }
          nodeCanvasObject={(node, ctx, globalScale) => {
            const dimmed = highlight && !highlight.nodes.has(node.id);
            const isFocus =
              highlight && (node.id === highlight.focus || node.id === hoveredId);

            ctx.globalAlpha = dimmed ? 0.12 : 1;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color;
            ctx.fill();
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = SURFACE_COLOR;
            ctx.stroke();

            if (isFocus) {
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
            }

            // Selective labeling only: the hub nodes that define each
            // cluster's shape, plus whatever is currently focused/matched.
            // Labeling every node at once (e.g. all 40 files in a test
            // folder) is unreadable clutter, not information.
            const inHighlight = highlight && highlight.nodes.has(node.id);
            const showLabel =
              !dimmed &&
              (isFocus || node.isHub || (inHighlight && highlight.nodes.size <= 25));
            if (showLabel) {
              const fontSize = Math.max(4, 11 / globalScale);
              ctx.font = `${fontSize}px -apple-system, sans-serif`;
              ctx.fillStyle = "#cfd3db";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(node.shortName, node.x, node.y + node.r + 2);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r + 2, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          linkColor={(link) => {
            if (!highlight) return "rgba(255,255,255,0.15)";
            const active =
              highlight.nodes.has(endpointId(link.source)) &&
              highlight.nodes.has(endpointId(link.target));
            return active ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.03)";
          }}
          linkWidth={(link) => {
            if (!highlight) return 1;
            const active =
              highlight.nodes.has(endpointId(link.source)) &&
              highlight.nodes.has(endpointId(link.target));
            return active ? 2 : 0.5;
          }}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={(link) => {
            if (!highlight) return "rgba(255,255,255,0.25)";
            const active =
              highlight.nodes.has(endpointId(link.source)) &&
              highlight.nodes.has(endpointId(link.target));
            return active ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.03)";
          }}
        />
      </div>
    </div>
  );
}

export default App;
