export class GraphEngine {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.k = 0.1; // Spring constant
        this.repulsion = 10000;
        this.friction = 0.9;
        this.minDistance = 100;
    }

    addNode(node) {
        if (this.nodes.find(n => n.id === node.id)) return;
        if (!node.x) node.x = 400 + (Math.random() - 0.5) * 400;
        if (!node.y) node.y = 300 + (Math.random() - 0.5) * 300;
        if (!node.vx) node.vx = 0;
        if (!node.vy) node.vy = 0;
        this.nodes.push(node);
    }

    addEdge(sourceId, targetId) {
        if (this.edges.find(e => e.sourceId === sourceId && e.targetId === targetId)) return;
        this.edges.push({ sourceId, targetId });
    }

    clear() {
        this.nodes = [];
        this.edges = [];
    }

    update() {
        // 1. Repulsion between nodes
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const n1 = this.nodes[i];
                const n2 = this.nodes[j];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const distSq = dx * dx + dy * dy + 0.1;
                const force = this.repulsion / distSq;
                const fx = (dx / Math.sqrt(distSq)) * force;
                const fy = (dy / Math.sqrt(distSq)) * force;

                n1.vx -= fx;
                n1.vy -= fy;
                n2.vx += fx;
                n2.vy += fy;
            }
        }

        // 2. Attraction of edges (Springs)
        for (const edge of this.edges) {
            const n1 = this.nodes.find(n => n.id === edge.sourceId);
            const n2 = this.nodes.find(n => n.id === edge.targetId);
            if (!n1 || !n2) continue;

            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const force = (dist - this.minDistance) * this.k;
            const fx = (dx / (dist + 0.1)) * force;
            const fy = (dy / (dist + 0.1)) * force;

            n1.vx += fx;
            n1.vy += fy;
            n2.vx -= fx;
            n2.vy -= fy;
        }

        // 3. Central gravity
        const centerX = 400;
        const centerY = 300;
        for (const node of this.nodes) {
            const dx = centerX - node.x;
            const dy = centerY - node.y;
            node.vx += dx * 0.01;
            node.vy += dy * 0.01;
        }

        // 4. Update positions with friction
        for (const node of this.nodes) {
            if (node.dragging) {
                node.vx = 0;
                node.vy = 0;
                continue;
            }
            node.x += node.vx;
            node.y += node.vy;
            node.vx *= this.friction;
            node.vy *= this.friction;
        }
    }
}
