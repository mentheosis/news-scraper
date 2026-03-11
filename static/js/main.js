import { fetchDates, fetchTopics, fetchHotTake, fetchGraph, saveGraph } from './api.js';
import { getLocalYYYYMMDD } from './utils.js';
import { toggleSidebar, closeSidebar, renderTopics, renderFeedHealth } from './ui.js';
import { setSort, state } from './state.js';
import { GraphEngine } from './graph/engine.js';
import { GraphRenderer } from './graph/renderer.js';
import { ViewLoader } from './views/ViewLoader.js';
import './components/Sidebar.js';
import './components/TopNav.js';

let graphEngine, graphRenderer;
let activeView = 'news';
let viewLoader;

document.addEventListener('DOMContentLoaded', async () => {
    viewLoader = new ViewLoader('view-container');

    // Navigation Listener (Add before initial load)
    document.addEventListener('view-change', (e) => {
        const view = e.detail.view;
        if (view === 'news' && activeView !== 'news') {
            viewLoader.load('news-feed');
        } else if (view === 'graph' && activeView !== 'graph') {
            viewLoader.load('graph-view');
        }
    });

    // View Loaded Handler
    document.addEventListener('view-loaded', (e) => {
        const viewName = e.detail.view;
        activeView = viewName === 'news-feed' ? 'news' : 'graph';

        if (viewName === 'news-feed') {
            initNewsFeedEvents();
            if (state.allTopics && state.allTopics.length > 0) {
                renderTopics(state.allTopics);
                // Also restore feed health if available
                if (state.feedHealth) renderFeedHealth(state.feedHealth);

                // Restore active digest if one was selected
                if (state.topicSelectionHistory.length > 0) {
                    const activeTitle = state.topicSelectionHistory[0];
                    const topicIdx = state.allTopics.findIndex(t => t.title === activeTitle);
                    if (topicIdx !== -1) {
                        import('./api.js').then(m => m.generateDigest(topicIdx, activeTitle));
                    }
                }
            }
        } else if (viewName === 'graph-view') {
            initGraphViewEvents();
            syncTopicsToGraph();
        }
    });

    // Global App Initialized
    // Initialize Graph Engine Early
    graphEngine = new GraphEngine();
    const persistedGraph = await fetchGraph();
    if (persistedGraph && persistedGraph.nodes) {
        persistedGraph.nodes.forEach(n => graphEngine.addNode(n));
        persistedGraph.edges.forEach(e => graphEngine.addEdge(e.source, e.target));
    }

    // Initial View Load
    await viewLoader.load('news-feed');

    // Fetch topics/dates after view is loaded
    fetchDates();
    fetchTopics(false, getLocalYYYYMMDD());

    // Global Modal Listener
    document.getElementById('close-hot-take')?.addEventListener('click', () => {
        document.getElementById('hot-take-modal')?.classList.add('hidden');
    });

    // Auto-save graph periodically if in graph view
    setInterval(() => {
        if (graphEngine && graphEngine.nodes.length > 0) {
            triggerGraphSave();
        }
    }, 10000); // Every 10 seconds
});

function triggerGraphSave() {
    const data = {
        nodes: graphEngine.nodes.map(n => ({
            id: n.id,
            type: n.type,
            label: n.label,
            summary: n.summary,
            articleCount: n.articleCount || 0,
            x: n.x,
            y: n.y
        })),
        edges: graphEngine.edges.map(e => ({
            source: e.sourceId || e.source,
            target: e.targetId || e.target
        }))
    };
    saveGraph(data);
}

function initNewsFeedEvents() {
    document.getElementById('btn-show-topics')?.addEventListener('click', () => toggleSidebar('sidebar', 'btn-show-topics'));
    document.getElementById('btn-show-headers')?.addEventListener('click', () => toggleSidebar('headers-sidebar', 'btn-show-headers'));
    document.getElementById('btn-show-health')?.addEventListener('click', () => toggleSidebar('secondary-sidebar', 'btn-show-health'));
    document.getElementById('btn-show-sources')?.addEventListener('click', () => toggleSidebar('right-sidebar', 'btn-show-sources'));

    document.getElementById('collapse-topics-btn')?.addEventListener('click', () => toggleSidebar('sidebar', 'btn-show-topics'));
    document.getElementById('collapse-headers-btn')?.addEventListener('click', () => toggleSidebar('headers-sidebar', 'btn-show-headers'));
    document.getElementById('collapse-health-btn')?.addEventListener('click', () => toggleSidebar('secondary-sidebar', 'btn-show-health'));

    document.getElementById('refresh-btn')?.addEventListener('click', () => {
        const dateSelect = document.getElementById('news-date-select');
        const today = getLocalYYYYMMDD();
        fetchTopics(true, dateSelect.value || today);
    });

    document.getElementById('sort-num-btn')?.addEventListener('click', () => setSort('number'));
    document.getElementById('sort-cite-btn')?.addEventListener('click', () => setSort('citations'));

    document.querySelectorAll('.hot-take-btn.preset').forEach(btn => {
        btn.addEventListener('click', () => fetchHotTake(btn.dataset.name));
    });

    document.getElementById('hot-take-custom-btn')?.addEventListener('click', () => {
        const name = document.getElementById('hot-take-custom-input').value.trim();
        if (name) fetchHotTake(name);
    });

    document.getElementById('retry-fetch-topics')?.addEventListener('click', () => {
        const today = getLocalYYYYMMDD();
        fetchTopics(false, today);
    });
}

function initGraphViewEvents() {
    const canvas = document.getElementById('graph-canvas');
    if (!canvas) return;

    graphRenderer = new GraphRenderer(canvas, graphEngine);
    graphRenderer.onEdgeCreate = () => triggerGraphSave();
    graphRenderer.onSelect = (node) => {
        const sidebar = document.getElementById('node-edit-sidebar');
        if (!sidebar) {
            console.error('Graph sidebar not found!');
            return;
        }
        if (node) {
            sidebar.open();
            const labelInput = document.getElementById('node-label-input');
            const summaryArea = document.getElementById('node-summary');
            const typeBadge = document.getElementById('node-type-badge');
            const researchBtn = document.getElementById('node-research-btn');
            const saveBtn = document.getElementById('node-save-btn');
            const deleteBtn = document.getElementById('node-delete-btn');
            const articleCountLabel = document.getElementById('node-article-count');

            if (labelInput) labelInput.value = node.label;
            if (summaryArea) summaryArea.value = node.summary || '';

            if (articleCountLabel) {
                if (node.type === 'topic' && node.articleCount > 0) {
                    articleCountLabel.innerText = `${node.articleCount} articles`;
                    articleCountLabel.classList.remove('hidden');
                } else {
                    articleCountLabel.classList.add('hidden');
                }
            }

            const isTopic = node.type === 'topic';
            if (typeBadge) {
                typeBadge.innerText = isTopic ? 'Topic' : 'Idea';
                typeBadge.className = `type-badge ${node.type}`;
            }

            // Disable editing for topic nodes
            if (labelInput) labelInput.readOnly = isTopic;
            if (summaryArea) summaryArea.readOnly = isTopic;
            if (researchBtn) researchBtn.classList.toggle('hidden', isTopic);
            if (saveBtn) saveBtn.classList.toggle('hidden', isTopic);
            if (deleteBtn) deleteBtn.classList.toggle('hidden', isTopic);
        } else {
            sidebar.close();
        }
    };

    document.getElementById('node-delete-btn')?.addEventListener('click', () => {
        if (graphRenderer.selectedNode && graphRenderer.selectedNode.type === 'idea') {
            if (confirm(`Delete node "${graphRenderer.selectedNode.label}"?`)) {
                graphEngine.nodes = graphEngine.nodes.filter(n => n.id !== graphRenderer.selectedNode.id);
                graphEngine.edges = graphEngine.edges.filter(e => e.source !== graphRenderer.selectedNode.id && e.target !== graphRenderer.selectedNode.id);
                triggerGraphSave();
                document.getElementById('node-edit-sidebar').close();
                graphRenderer.selectedNode = null;
            }
        }
    });

    document.getElementById('graph-add-node')?.addEventListener('click', () => {
        const id = 'idea-' + Date.now();
        graphEngine.addNode({
            id: id,
            type: 'idea',
            label: 'New Idea',
            summary: ''
        });
        triggerGraphSave();
    });

    canvas.addEventListener('dblclick', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - graphRenderer.panX) / graphRenderer.zoom;
        const y = (e.clientY - rect.top - graphRenderer.panY) / graphRenderer.zoom;
        const id = 'idea-' + Date.now();
        graphEngine.addNode({ id, type: 'idea', label: 'New Idea', summary: '', x, y });
        triggerGraphSave();
    });

    document.getElementById('node-save-btn')?.addEventListener('click', () => {
        if (graphRenderer.selectedNode) {
            graphRenderer.selectedNode.label = document.getElementById('node-label-input').value;
            graphRenderer.selectedNode.summary = document.getElementById('node-summary').value;
            triggerGraphSave();
            document.getElementById('node-edit-sidebar').close();
            graphRenderer.selectedNode = null;
        }
    });

    document.getElementById('node-research-btn')?.addEventListener('click', async () => {
        if (graphRenderer.selectedNode) {
            const btn = document.getElementById('node-research-btn');
            const summaryArea = document.getElementById('node-summary');
            const originalText = btn.innerText;
            btn.innerText = 'Researching...';
            btn.disabled = true;

            const result = await import('./api.js').then(m => m.researchNode(graphRenderer.selectedNode.label));
            summaryArea.value = result;
            graphRenderer.selectedNode.summary = result;
            triggerGraphSave();

            btn.innerText = originalText;
            btn.disabled = false;
        }
    });

    document.getElementById('close-node-edit')?.addEventListener('click', () => {
        document.getElementById('node-edit-sidebar').close();
        graphRenderer.selectedNode = null;
    });

    document.getElementById('graph-zoom-in')?.addEventListener('click', () => graphRenderer.zoom *= 1.2);
    document.getElementById('graph-zoom-out')?.addEventListener('click', () => graphRenderer.zoom /= 1.2);
    document.getElementById('graph-reset')?.addEventListener('click', () => {
        graphRenderer.zoom = 1;
        graphRenderer.panX = 0;
        graphRenderer.panY = 0;
    });

    if (!window._graphLoopRunning) {
        window._graphLoopRunning = true;
        const loop = () => {
            if (activeView === 'graph') {
                graphEngine.update();
                graphRenderer.draw();
            }
            requestAnimationFrame(loop);
        };
        loop();
    }
}

function syncTopicsToGraph() {
    if (!state.allTopics || !graphEngine) return;
    let added = false;
    state.allTopics.forEach(topic => {
        const count = topic.articles ? topic.articles.length : (topic.article_indices ? topic.article_indices.length : 0);
        const existing = graphEngine.nodes.find(n => n.id === topic.title);

        if (!existing) {
            graphEngine.addNode({
                id: topic.title,
                type: 'topic',
                label: topic.title,
                summary: topic.description,
                articleCount: count
            });
            added = true;
        } else {
            // Update existing node with latest count and description if they changed
            if (existing.articleCount !== count) {
                existing.articleCount = count;
                added = true;
            }
            if (existing.summary !== topic.description) {
                existing.summary = topic.description;
                added = true;
            }
        }
    });
    if (added) triggerGraphSave();
}
