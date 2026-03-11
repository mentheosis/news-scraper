export class AgTopNav extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    align-items: center;
                    height: 60px;
                    background-color: var(--sidebar-bg, #161b22);
                    border-bottom: 1px solid var(--border, #30363d);
                    padding: 0 20px;
                    gap: 30px;
                    z-index: 100;
                }
                .logo {
                    font-size: 20px;
                    font-weight: 800;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .nav-links {
                    display: flex;
                    gap: 10px;
                    height: 100%;
                }
                .nav-item {
                    display: flex;
                    align-items: center;
                    padding: 0 15px;
                    color: var(--text-secondary, #8b949e);
                    font-weight: 600;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                    border-bottom: 2px solid transparent;
                }
                .nav-item:hover {
                    color: #fff;
                }
                .nav-item.active {
                    color: var(--accent, #58a6ff);
                    border-bottom-color: var(--accent, #58a6ff);
                }
            </style>
            <div class="logo">
                <span style="font-size: 24px;">📰</span> AgNews
            </div>
            <div class="nav-links">
                <div class="nav-item active" data-view="news">News Feed</div>
                <div class="nav-item" data-view="topics">Topics</div>
                <div class="nav-item" data-view="graph">Knowledge Graph</div>
            </div>
        `;

        this.shadowRoot.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                this.setActive(view);
                this.dispatchEvent(new CustomEvent('view-change', {
                    detail: { view },
                    bubbles: true,
                    composed: true
                }));
            });
        });
    }

    setActive(view) {
        this.shadowRoot.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });
    }
}

customElements.define('ag-top-nav', AgTopNav);
