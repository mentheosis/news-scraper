export class AgSidebar extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        const width = this.getAttribute('width') || '300px';
        const side = this.getAttribute('side') || 'left';

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: ${width};
                    height: 100%;
                    background-color: var(--sidebar-bg, #161b22);
                    border-${side === 'left' ? 'right' : 'left'}: 1px solid var(--border, #30363d);
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s ease;
                    z-index: 10;
                    flex-shrink: 0;
                    overflow: hidden;
                    position: relative;
                }
                :host(.collapsed) {
                    width: 0;
                    border: none;
                }
                .content {
                    width: ${width};
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
                ::slotted([slot="header"]) {
                    padding: 20px;
                    border-bottom: 1px solid var(--border, #30363d);
                }
                ::slotted([slot="body"]) {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                }
            </style>
            <div class="content">
                <slot name="header"></slot>
                <slot name="body"></slot>
                <slot></slot>
            </div>
        `;
    }

    toggle() {
        this.classList.toggle('collapsed');
        return this.classList.contains('collapsed');
    }

    open() {
        this.classList.remove('collapsed');
    }

    close() {
        this.classList.add('collapsed');
    }
}

customElements.define('ag-sidebar', AgSidebar);
