export class GraphRenderer {
    constructor(canvas, engine) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.engine = engine;
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.selectedNode = null;
        this.hoveredNode = null;

        this.setupListeners();
        this.resize();

        // Use ResizeObserver for automatic handling of sidebar toggles
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = this.canvas.clientWidth * window.devicePixelRatio;
        this.canvas.height = this.canvas.clientHeight * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        this.draw(); // Immediate re-draw after clearing to avoid flicker
    }

    setupListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.panX) / this.zoom,
            y: (e.clientY - rect.top - this.panY) / this.zoom
        };
    }

    handleMouseDown(e) {
        const pos = this.getMousePos(e);
        const nodeBelow = this.engine.nodes.find(n => {
            const dx = n.x - pos.x;
            const dy = n.y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < 30; // Node radius
        });

        if (nodeBelow) {
            this.selectedNode = nodeBelow;
            if (e.shiftKey) {
                this.isConnecting = true;
                this.connectFrom = this.selectedNode;
            } else {
                this.selectedNode.dragging = true;
                this.onSelect?.(this.selectedNode);
            }
        } else {
            // Clicked background - pan but don't deselect
            this.draggingCanvas = true;
            this.dragStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        }
    }

    handleMouseMove(e) {
        const pos = this.getMousePos(e);

        if (this.isConnecting && this.connectFrom) {
            this.connectToPos = pos;
        } else if (this.selectedNode && this.selectedNode.dragging) {
            this.selectedNode.x = pos.x;
            this.selectedNode.y = pos.y;
        } else if (this.draggingCanvas) {
            this.panX = e.clientX - this.dragStart.x;
            this.panY = e.clientY - this.dragStart.y;
        } else {
            this.hoveredNode = this.engine.nodes.find(n => {
                const dx = n.x - pos.x;
                const dy = n.y - pos.y;
                return Math.sqrt(dx * dx + dy * dy) < 30;
            });
        }
    }

    handleMouseUp(e) {
        if (this.isConnecting && this.connectFrom) {
            const pos = this.getMousePos(e);
            const targetNode = this.engine.nodes.find(n => {
                const dx = n.x - pos.x;
                const dy = n.y - pos.y;
                return n !== this.connectFrom && Math.sqrt(dx * dx + dy * dy) < 30;
            });

            if (targetNode) {
                this.engine.addEdge(this.connectFrom.id, targetNode.id);
                this.onEdgeCreate?.();
            }
        }

        if (this.selectedNode) this.selectedNode.dragging = false;
        this.draggingCanvas = false;
        this.isConnecting = false;
        this.connectFrom = null;
        this.connectToPos = null;
    }

    handleWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom *= delta;
        this.zoom = Math.max(0.1, Math.min(5, this.zoom));
    }

    draw() {
        const { ctx, canvas, zoom, panX, panY } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        // Draw edges
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1 / zoom;
        for (const edge of this.engine.edges) {
            const n1 = this.engine.nodes.find(n => n.id === edge.sourceId);
            const n2 = this.engine.nodes.find(n => n.id === edge.targetId);
            if (n1 && n2) {
                ctx.beginPath();
                ctx.moveTo(n1.x, n1.y);
                ctx.lineTo(n2.x, n2.y);
                ctx.stroke();
            }
        }

        // Draw temporary connection line
        if (this.isConnecting && this.connectFrom && this.connectToPos) {
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.moveTo(this.connectFrom.x, this.connectFrom.y);
            ctx.lineTo(this.connectToPos.x, this.connectToPos.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw nodes
        for (const node of this.engine.nodes) {
            const isSelected = node === this.selectedNode;
            const isHovered = node === this.hoveredNode;

            ctx.beginPath();
            ctx.arc(node.x, node.y, 30, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? '#58a6ff' : (isHovered ? '#30363d' : '#161b22');
            ctx.fill();
            ctx.strokeStyle = isSelected ? '#fff' : '#30363d';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#fff';
            ctx.font = '10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(node.label, node.x, node.y + 5);
        }

        ctx.restore();
    }
}
