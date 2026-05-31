import { createServer } from "node:http";
import { readGraph } from "./graph.js";
import type { CodeGraphSettings } from "./types.js";

export async function openGraphUi(root: string, settings: CodeGraphSettings): Promise<string> {
  const port = settings.uiPort;

  const server = createServer(async (req, res) => {
    if (req.url === "/graph") {
      res.setHeader("content-type", "application/json");
      const graph = await readGraph(root);
      res.end(JSON.stringify(graph));
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(renderUi());
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => resolve(`http://localhost:${port}`));
  });
}

function renderUi(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CodeGraph Mapper Visualizer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    :root {
      --bg-base: #0f172a;
      --bg-surface: #1e293b;
      --bg-surface-glass: rgba(30, 41, 59, 0.7);
      --border-color: rgba(255, 255, 255, 0.08);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;

      --color-file: #10b981;
      --color-module: #3b82f6;
      --color-class: #06b6d4;
      --color-function: #8b5cf6;
      --color-component: #ec4899;
      --color-route: #f97316;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: 'Outfit', sans-serif;
      display: grid;
      grid-template-columns: 320px 1fr;
      height: 100vh;
      overflow: hidden;
      transition: grid-template-columns 0.3s ease;
    }
    body.details-open {
      grid-template-columns: 320px 1fr 380px;
    }

    aside {
      background: var(--bg-surface-glass);
      backdrop-filter: blur(12px);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow-y: auto;
      padding: 20px;
    }
    .right-sidebar {
      grid-column: 3;
      border-left: 1px solid var(--border-color);
      border-right: none;
      background: var(--bg-surface-glass);
      backdrop-filter: blur(12px);
      display: none;
      flex-direction: column;
      height: 100vh;
      overflow-y: auto;
      padding: 20px;
    }
    body.details-open .right-sidebar {
      display: flex;
    }

    h1, h2, h3 {
      margin-top: 0;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    h1 { font-size: 20px; margin-bottom: 8px; color: #fff; display: flex; align-items: center; gap: 8px; }
    h2 { font-size: 16px; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; color: var(--text-main); }
    h3 { font-size: 11px; margin-bottom: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }

    .control-group {
      margin-bottom: 20px;
    }
    .search-input {
      width: 100%;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border-color);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    .search-input:focus {
      border-color: var(--color-module);
    }
    .stats-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 20px;
      font-size: 13px;
    }
    .stat-val { font-weight: 700; font-size: 18px; color: #fff; }

    .filter-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
    }
    .filter-item input {
      cursor: pointer;
      accent-color: var(--color-module);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    main {
      position: relative;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #network-container {
      flex: 1;
      width: 100%;
      height: 100%;
      background-color: var(--bg-base);
    }

    .detail-section {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .detail-row:last-child { margin-bottom: 0; }
    .detail-label { color: var(--text-muted); }
    .detail-value { font-weight: 500; text-align: right; word-break: break-all; }

    .relations-list {
      max-height: 180px;
      overflow-y: auto;
      font-size: 12px;
      font-family: 'JetBrains Mono', monospace;
    }
    .relation-item {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      cursor: pointer;
      border-radius: 4px;
    }
    .relation-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
      text-align: center;
      margin-bottom: 10px;
    }
    .btn:hover { background: rgba(255, 255, 255, 0.08); }
    .btn-accent {
      background: var(--color-module);
      border: none;
    }
    .btn-accent:hover { background: #2563eb; }

    .floating-controls {
      position: absolute;
      bottom: 20px;
      left: 20px;
      display: flex;
      gap: 10px;
      z-index: 10;
    }
    .floating-btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      color: #fff;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      user-select: none;
    }
    .floating-btn:hover { background: rgba(255, 255, 255, 0.08); }

    .node-list-container {
      flex: 1;
      overflow-y: auto;
      margin-top: 10px;
      border-top: 1px solid var(--border-color);
      padding-top: 15px;
    }
    .node-list-item {
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node-list-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  </style>
</head>
<body>
  <aside>
    <h1>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--color-module)"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"/><path d="M12 6V12L16 14"/></svg>
      CodeGraph Visualizer
    </h1>

    <div class="stats-box">
      <div>Nodes <div class="stat-val" id="count-nodes">0</div></div>
      <div>Edges <div class="stat-val" id="count-edges">0</div></div>
    </div>

    <div class="control-group">
      <h3>Search Nodes</h3>
      <input type="text" id="search-bar" class="search-input" placeholder="Name or path...">
    </div>

    <div class="control-group">
      <h3>Filter Node Types</h3>
      <div id="type-filters"></div>
    </div>

    <div class="control-group">
      <h3>Physics</h3>
      <label class="filter-item">
        <input type="checkbox" id="physics-toggle" checked>
        Enable Dynamic Layout
      </label>
    </div>

    <div class="node-list-container">
      <h3>Node List</h3>
      <div id="node-list"></div>
    </div>
  </aside>

  <main>
    <div id="network-container"></div>

    <div class="floating-controls">
      <div class="floating-btn" id="zoom-in" title="Zoom In">+</div>
      <div class="floating-btn" id="zoom-out" title="Zoom Out">-</div>
      <div class="floating-btn" id="zoom-fit" title="Fit Content">⛶</div>
    </div>
  </main>

  <aside class="right-sidebar">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
      <h2 style="margin:0; border:none; padding:0;">Node Details</h2>
      <span style="cursor:pointer; font-size:20px; color:var(--text-muted)" id="btn-close-details">&times;</span>
    </div>

    <div class="detail-section">
      <div class="detail-row">
        <span class="detail-label">Name</span>
        <span class="detail-value" id="detail-name">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <span class="detail-value" style="text-transform: capitalize;" id="detail-type">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Language</span>
        <span class="detail-value" id="detail-lang">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Line</span>
        <span class="detail-value" id="detail-line">-</span>
      </div>
      <div class="detail-row" style="flex-direction:column; align-items:flex-start; margin-top:8px;">
        <span class="detail-label" style="margin-bottom:4px;">File Path</span>
        <span class="detail-value" style="text-align:left; font-family:'JetBrains Mono', monospace; font-size:11px;" id="detail-path">-</span>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-row">
        <span class="detail-label">Transitive Blast Radius</span>
        <span class="detail-value" id="detail-radius">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Risk Level</span>
        <span class="detail-value" id="detail-risk" style="font-weight:bold;">-</span>
      </div>
    </div>

    <div class="control-group">
      <h3>Direct Callers (Inbound)</h3>
      <div class="relations-list" id="detail-inbound"></div>
    </div>

    <div class="control-group">
      <h3>Direct Callees (Outbound)</h3>
      <div class="relations-list" id="detail-outbound"></div>
    </div>

    <button class="btn btn-accent" id="btn-focus">Focus in Graph</button>
  </aside>

  <script>
    let graphData = { nodes: [], edges: [] };
    let network = null;
    let nodesDataSet = null;
    let edgesDataSet = null;
    let selectedNodeId = null;

    const COLORS = {
      file: '#10b981',
      module: '#3b82f6',
      class: '#06b6d4',
      function: '#8b5cf6',
      method: '#8b5cf6',
      component: '#ec4899',
      route: '#f97316',
      handler: '#f97316'
    };

    if (typeof window.bakedGraphData !== 'undefined') {
      initNetwork(window.bakedGraphData);
    } else {
      fetch('/graph')
        .then(res => res.json())
        .then(data => initNetwork(data))
        .catch(err => {
          console.error("Error loading graph:", err);
          document.getElementById('network-container').innerHTML = '<div style="padding:40px; text-align:center; color:#ef4444;"><h3>Error Loading Graph</h3><p>Verify that scan has been run and .codegraph/graph.db exists.</p></div>';
        });
    }

    const activeFilters = new Set(Object.keys(COLORS));

    function initFilters() {
      const container = document.getElementById('type-filters');
      container.innerHTML = '';
      Object.entries(COLORS).forEach(([type, color]) => {
        if (type === 'method' || type === 'handler') return; // group under function / route
        const item = document.createElement('label');
        item.className = 'filter-item';
        item.innerHTML = \`
          <input type="checkbox" checked value="\${type}">
          <span class="dot" style="background-color: \${color}"></span>
          <span style="text-transform: capitalize;">\${type}s</span>
        \`;
        item.querySelector('input').onchange = (e) => {
          if (e.target.checked) {
            activeFilters.add(type);
            if (type === 'function') activeFilters.add('method');
            if (type === 'route') activeFilters.add('handler');
          } else {
            activeFilters.delete(type);
            if (type === 'function') activeFilters.delete('method');
            if (type === 'route') activeFilters.delete('handler');
          }
          applyFilterAndSearch();
        };
        container.appendChild(item);
      });
    }

    function initNetwork(data) {
      graphData = data;
      document.getElementById('count-nodes').textContent = data.nodes.length;
      document.getElementById('count-edges').textContent = data.edges.length;

      initFilters();
      renderNodeList(data.nodes);

      const visNodes = data.nodes.map(n => ({
        id: n.id,
        label: n.name,
        title: n.id + '\\nPath: ' + n.path,
        color: {
          background: COLORS[n.type] || '#64748b',
          border: 'rgba(255,255,255,0.15)',
          highlight: {
            background: COLORS[n.type] || '#64748b',
            border: '#ffffff'
          }
        },
        font: { color: '#ffffff', face: 'Outfit', size: 14 },
        shape: n.type === 'file' ? 'box' : n.type === 'route' ? 'database' : 'ellipse',
        shadow: true
      }));

      const visEdges = data.edges.map(e => ({
        id: e.id,
        from: e.source,
        to: e.target,
        label: e.evidence || '',
        font: { face: 'JetBrains Mono', size: 9, color: '#94a3b8', strokeWidth: 0 },
        arrows: 'to',
        color: {
          color: 'rgba(148, 163, 184, 0.25)',
          highlight: 'rgba(245, 158, 11, 0.8)',
          hover: 'rgba(148, 163, 184, 0.5)'
        },
        smooth: {
          type: 'continuous',
          roundness: 0.5
        }
      }));

      nodesDataSet = new vis.DataSet(visNodes);
      edgesDataSet = new vis.DataSet(visEdges);

      const container = document.getElementById('network-container');
      const networkData = {
        nodes: nodesDataSet,
        edges: edgesDataSet
      };

      const options = {
        nodes: {
          borderWidth: 1.5,
          scaling: { min: 16, max: 32 }
        },
        edges: {
          width: 1.5,
          hoverWidth: 2
        },
        interaction: {
          hover: true,
          tooltipDelay: 200,
          hideEdgesOnDrag: false,
          hideEdgesOnZoom: false
        },
        physics: {
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -50,
            centralGravity: 0.01,
            springLength: 100,
            springConstant: 0.08
          },
          stabilization: {
            iterations: 200,
            updateInterval: 25
          }
        }
      };

      network = new vis.Network(container, networkData, options);

      network.on("selectNode", function (params) {
        if (params.nodes.length > 0) {
          showNodeDetails(params.nodes[0]);
        }
      });

      network.on("deselectNode", function () {
        closeDetails();
      });

      document.getElementById('search-bar').oninput = e => {
        applyFilterAndSearch();
      };

      document.getElementById('physics-toggle').onchange = e => {
        network.setOptions({ physics: { enabled: e.target.checked } });
      };

      document.getElementById('zoom-in').onclick = () => {
        network.moveTo({ scale: network.getScale() * 1.2 });
      };
      document.getElementById('zoom-out').onclick = () => {
        network.moveTo({ scale: network.getScale() * 0.8 });
      };
      document.getElementById('zoom-fit').onclick = () => {
        network.fit({ animation: { duration: 500 } });
      };
      document.getElementById('btn-focus').onclick = () => {
        if (selectedNodeId) {
          network.focus(selectedNodeId, { scale: 1.2, animation: { duration: 500 } });
          network.selectNodes([selectedNodeId]);
        }
      };
      document.getElementById('btn-close-details').onclick = () => {
        closeDetails();
      };
    }

    function renderNodeList(nodes) {
      const container = document.getElementById('node-list');
      container.innerHTML = '';
      nodes.slice(0, 100).forEach(n => {
        const item = document.createElement('div');
        item.className = 'node-list-item';
        item.innerHTML = \`<span class="dot" style="background-color:\${COLORS[n.type] || '#64748b'}"></span>\${n.name}\`;
        item.title = n.path;
        item.onclick = () => {
          network.selectNodes([n.id]);
          showNodeDetails(n.id);
          network.focus(n.id, { scale: 1.2, animation: { duration: 500 } });
        };
        container.appendChild(item);
      });
    }

    function applyFilterAndSearch() {
      const query = document.getElementById('search-bar').value.toLowerCase();
      const filteredNodes = graphData.nodes.filter(n => {
        const matchesQuery = !query || n.id.toLowerCase().includes(query) || n.name.toLowerCase().includes(query) || n.path.toLowerCase().includes(query);
        const matchesFilter = activeFilters.has(n.type);
        return matchesQuery && matchesFilter;
      });

      const updateArray = graphData.nodes.map(n => {
        const matchesQuery = !query || n.id.toLowerCase().includes(query) || n.name.toLowerCase().includes(query) || n.path.toLowerCase().includes(query);
        const matchesFilter = activeFilters.has(n.type);
        return {
          id: n.id,
          hidden: !(matchesQuery && matchesFilter)
        };
      });
      nodesDataSet.update(updateArray);
      renderNodeList(filteredNodes);
    }

    function showNodeDetails(nodeId) {
      selectedNodeId = nodeId;
      const node = graphData.nodes.find(n => n.id === nodeId);
      if (!node) return;

      document.body.classList.add('details-open');

      document.getElementById('detail-name').textContent = node.name;
      document.getElementById('detail-type').textContent = node.type;
      document.getElementById('detail-lang').textContent = node.language || 'unknown';
      document.getElementById('detail-line').textContent = node.line || node.startLine || '-';
      document.getElementById('detail-path').textContent = node.path;

      const inbound = graphData.edges.filter(e => e.target === nodeId);
      const outbound = graphData.edges.filter(e => e.source === nodeId);

      renderRelationList(document.getElementById('detail-inbound'), inbound, 'source');
      renderRelationList(document.getElementById('detail-outbound'), outbound, 'target');

      const blastRadius = calculateTransitiveRadius(nodeId);
      document.getElementById('detail-radius').textContent = blastRadius.count + ' nodes';
      document.getElementById('detail-risk').textContent = blastRadius.risk.toUpperCase();
      document.getElementById('detail-risk').style.color =
        blastRadius.risk === 'high' ? '#ef4444' : blastRadius.risk === 'medium' ? '#f59e0b' : '#10b981';
    }

    function renderRelationList(element, edges, keyField) {
      element.innerHTML = '';
      if (edges.length === 0) {
        element.innerHTML = '<div style="color:var(--text-muted); font-style:italic; font-size:12px; padding:6px 0;">None</div>';
        return;
      }
      edges.forEach(e => {
        const nodeVal = e[keyField];
        const label = nodeVal.substring(nodeVal.indexOf(':') + 1);
        const item = document.createElement('div');
        item.className = 'relation-item';
        item.innerHTML = \`<span style="color:var(--text-muted)">\${e.type}</span> <span>\${label}</span>\`;
        item.onclick = () => {
          network.selectNodes([nodeVal]);
          showNodeDetails(nodeVal);
          network.focus(nodeVal, { scale: 1.2, animation: { duration: 500 } });
        };
        element.appendChild(item);
      });
    }

    function calculateTransitiveRadius(startId) {
      const upstream = new Set();
      const uQueue = [startId];
      while(uQueue.length > 0) {
        const cur = uQueue.shift();
        graphData.edges.forEach(e => {
          if (e.target === cur && !upstream.has(e.source)) {
            upstream.add(e.source);
            uQueue.push(e.source);
          }
        });
      }

      const downstream = new Set();
      const dQueue = [startId];
      while(dQueue.length > 0) {
        const cur = dQueue.shift();
        graphData.edges.forEach(e => {
          if (e.source === cur && !downstream.has(e.target)) {
            downstream.add(e.target);
            dQueue.push(e.target);
          }
        });
      }

      const total = upstream.size + downstream.size;
      const risk = total > 20 ? 'high' : total > 5 ? 'medium' : 'low';
      return { count: total, risk };
    }

    function closeDetails() {
      document.body.classList.remove('details-open');
      selectedNodeId = null;
      if (network) {
        network.unselectAll();
      }
    }
  </script>
</body>
</html>`;
}
