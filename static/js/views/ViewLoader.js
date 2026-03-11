export class ViewLoader {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.cache = new Map();
    }

    async load(viewName) {
        if (!this.container) return;

        // Optionally show a global loading state here

        try {
            let html;
            if (this.cache.has(viewName)) {
                html = this.cache.get(viewName);
            } else {
                const response = await fetch(`views/${viewName}.html`);
                if (!response.ok) throw new Error(`Failed to load view: ${viewName}`);
                html = await response.text();
                this.cache.set(viewName, html);
            }

            this.container.innerHTML = html;

            // Trigger a custom event so the main app knows to re-bind things
            this.container.dispatchEvent(new CustomEvent('view-loaded', {
                detail: { view: viewName },
                bubbles: true
            }));

        } catch (err) {
            console.error(err);
            this.container.innerHTML = `<div class="error-state"><p>Error loading view: ${err.message}</p></div>`;
        }
    }
}
