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

    getNodeRadius(node) {
        if ((node.type === 'Topic' || node.type === 'Daily News') && node.articleCount > 0) {
            // Sub-linear growth: base 30 + 5 * sqrt(count)
            return 30 + Math.sqrt(node.articleCount) * 5;
        }
        return 30; // Default for Idea and nodes without articles
    }

    handleMouseDown(e) {
        const pos = this.getMousePos(e);
        const nodeBelow = this.engine.nodes.find(n => {
            const dx = n.x - pos.x;
            const dy = n.y - pos.y;
            const radius = this.getNodeRadius(n);
            return Math.sqrt(dx * dx + dy * dy) < radius;
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
            // Update wobble directly during drag for jello effect
            const dx = pos.x - this.selectedNode.x;
            const dy = pos.y - this.selectedNode.y;
            const speed = Math.sqrt(dx * dx + dy * dy);
            if (this.selectedNode.wobble === undefined) this.selectedNode.wobble = 0;
            this.selectedNode.wobble += speed * 0.02;

            this.selectedNode.x = pos.x;
            this.selectedNode.y = pos.y;
        } else if (this.draggingCanvas) {
            this.panX = e.clientX - this.dragStart.x;
            this.panY = e.clientY - this.dragStart.y;
        } else {
            this.hoveredNode = this.engine.nodes.find(n => {
                const dx = n.x - pos.x;
                const dy = n.y - pos.y;
                const radius = this.getNodeRadius(n);
                return Math.sqrt(dx * dx + dy * dy) < radius;
            });
        }
    }

    handleMouseUp(e) {
        if (this.isConnecting && this.connectFrom) {
            const pos = this.getMousePos(e);
            const targetNode = this.engine.nodes.find(n => {
                const dx = n.x - pos.x;
                const dy = n.y - pos.y;
                const radius = this.getNodeRadius(n);
                return n !== this.connectFrom && Math.sqrt(dx * dx + dy * dy) < radius;
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
        // More granular zoom for touchpads/smooth scrolling
        const sensitivity = 0.001;
        const delta = Math.exp(-e.deltaY * sensitivity);
        this.zoom *= delta;
        this.zoom = Math.max(0.1, Math.min(5, this.zoom));
    }

    wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = this.ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
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
        const time = performance.now() * 0.01; // Sped up time
        for (const node of this.engine.nodes) {
            const isSelected = node === this.selectedNode;
            const isHovered = node === this.hoveredNode;
            const radius = this.getNodeRadius(node);

            // Persistent wobble that decays over time for "springy" feel
            if (node.wobble === undefined) node.wobble = 0;

            const speed = Math.sqrt((node.vx || 0) ** 2 + (node.vy || 0) ** 2);
            // Boost wobble based on speed (Lowered sensitivity)
            node.wobble += speed * 0.02;
            // Decay wobble (Increased settling time by ~3x)
            node.wobble *= 0.975;
            // Cap it to a subtle maximum
            const wobbleScale = Math.min(node.wobble, 1.65);

            ctx.beginPath();
            const segments = 80; // Higher segment count for high-frequency waves
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2;
                // Standing wave: sin(k*theta) * sin(w*t)
                // Using two frequencies for a more complex "standing" shimmer
                const ripple = Math.sin(angle * 12) * Math.sin(time * 6) * 0.6 +
                    Math.cos(angle * 20) * Math.cos(time * 10) * 0.4;
                const offset = ripple * wobbleScale;
                const r = radius + offset;
                const px = node.x + Math.cos(angle) * r;
                const py = node.y + Math.sin(angle) * r;

                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();

            // Color logic
            let baseColor, strokeColor;
            if (node.type === 'Topic') {
                baseColor = isSelected ? '#ffea00' : (isHovered ? '#fff176' : '#fff59d'); // Yellow 300/400/200
                strokeColor = '#fbc02d';
            } else if (node.type === 'Daily News') {
                baseColor = isSelected ? '#aeea00' : (isHovered ? '#a5d6a7' : '#c8e6c9'); // Green 300/200/100
                strokeColor = '#7cb342';
            } else {
                // Idea or unknown
                baseColor = isSelected ? '#00b0ff' : (isHovered ? '#90caf9' : '#bbdefb'); // Blue 300/200/100
                strokeColor = '#0288d1';
            }

            if (isSelected) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = strokeColor;
            }

            ctx.fillStyle = baseColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.stroke();

            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            // Label - Wrapped and Centered
            ctx.fillStyle = '#161b22'; // Dark text for pale bubbles
            ctx.font = '10px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const maxWidth = radius * 1.8;
            const lines = this.wrapText(node.label, maxWidth);
            const lineHeight = 12;
            const totalHeight = lines.length * lineHeight;

            lines.forEach((line, i) => {
                const yOffset = (i * lineHeight) - (totalHeight / 2) + (lineHeight / 2);
                ctx.fillText(line, node.x, node.y + yOffset);
            });
        }

        ctx.restore();
    }
}
