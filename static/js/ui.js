import { state } from './state.js';
import { generateDigest, fetchTopics } from './api.js';

export function toggleSidebar(sidebarId, btnId) {
    const sidebar = document.getElementById(sidebarId);
    const btn = document.getElementById(btnId);
    if (!sidebar) return;

    // Check if it's a web component or legacy aside
    if (sidebar.tagName.toLowerCase() === 'ag-sidebar') {
        const isCollapsed = sidebar.toggle();
        if (btn) btn.classList.toggle('active', !isCollapsed);
    } else {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        if (btn) btn.classList.toggle('active', !isCollapsed);
    }
}

export function closeSidebar(sidebarId, btnId) {
    const sidebar = document.getElementById(sidebarId);
    const btn = document.getElementById(btnId);
    if (!sidebar) return;

    if (sidebar.tagName.toLowerCase() === 'ag-sidebar') {
        sidebar.close();
    } else {
        sidebar.classList.add('collapsed');
    }
    if (btn) btn.classList.remove('active');
}

export function renderTopics(topics) {
    const list = document.getElementById('topic-list');
    list.innerHTML = '';

    if (!topics || topics.length === 0) {
        list.innerHTML = `<li class="empty-list">No major topics found today.</li>`;
        return;
    }

    const enrichedTopics = topics.map((t, i) => ({ ...t, originalIndex: i }));
    const sortedTopics = enrichedTopics.sort((a, b) => {
        const indexA = state.topicSelectionHistory.indexOf(a.title);
        const indexB = state.topicSelectionHistory.indexOf(b.title);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        if (a.has_cached_digest && !b.has_cached_digest) return -1;
        if (!a.has_cached_digest && b.has_cached_digest) return 1;
        return 0;
    });

    sortedTopics.forEach((topic) => {
        const li = document.createElement('li');
        li.className = 'topic-card';
        const currentTitle = state.topicSelectionHistory[0];
        if (topic.title === currentTitle) li.classList.add('active');

        let sourcesHTML = '';
        if (topic.source_counts) {
            for (const [source, sCount] of Object.entries(topic.source_counts)) {
                sourcesHTML += `<span class="source-bubble">${source} <span class="bubble-count">${sCount}</span></span>`;
            }
        } else {
            sourcesHTML = '<span class="source-bubble">Unknown</span>';
        }

        const cacheBadge = topic.has_cached_digest ? `<span class="cache-badge">Cached</span>` : '';

        li.innerHTML = `
            <div class="topic-header-row">
                <h4>${topic.title}</h4>
                ${cacheBadge}
            </div>
            <p class="desc">${topic.description}</p>
            <div class="meta">
                <div class="source-list">${sourcesHTML}</div>
            </div>
        `;

        li.addEventListener('click', () => {
            const histIdx = state.topicSelectionHistory.indexOf(topic.title);
            if (histIdx !== -1) state.topicSelectionHistory.splice(histIdx, 1);
            state.topicSelectionHistory.unshift(topic.title);
            renderTopics(topics);
            generateDigest(topic.originalIndex, topic.title);
        });

        list.appendChild(li);
    });
}

export function renderFeedHealth(stats) {
    const list = document.getElementById('feed-health-list');
    if (!list) return;
    list.innerHTML = '';
    if (!stats) return;

    Object.keys(stats).sort().forEach(source => {
        const item = stats[source];
        const hasError = !!item.error;
        let colorClass = 'status-ok';
        let icon = '✅';

        let descParts = [];
        if (item.new_count > 0 || item.cached_count > 0) {
            descParts.push(`${item.new_count || 0} new`);
            descParts.push(`${item.cached_count || 0} cached`);
        } else if (item.article_count > 0) {
            descParts.push(`${item.article_count} item(s)`);
        }

        let desc = descParts.length > 0 ? descParts.join(' / ') : '0 articles found';

        if (item.skipped_count > 0) {
            desc += ` / <span style="color:#f85149; font-weight:bold;">${item.skipped_count} skipped</span>`;
            if (colorClass === 'status-ok') colorClass = 'status-warn';
            if (icon === '✅') icon = '⚠️';
        }

        if (hasError) {
            colorClass = 'status-error';
            icon = '❌';
            desc = item.error;
        } else if (item.article_count === 0 && item.cached_count === 0) {
            colorClass = 'status-warn';
            icon = '⚠️';
            desc = '0 articles fetched';
        }

        const li = document.createElement('li');
        li.className = `source-article-card feed-health-card ${colorClass}`;
        li.innerHTML = `
            <div class="col-meta">
                <span class="health-icon">${icon}</span> <strong>${item.name}</strong>
            </div>
            <div class="health-desc" style="margin-top:4px; font-size:12px; color:var(--text-secondary); word-break: break-all;">${desc}</div>
        `;
        list.appendChild(li);
    });
}

export function handleTopicsRateLimit(seconds) {
    const loadingState = document.getElementById('loading-topics');
    const errorState = document.getElementById('error-topics');
    if (!loadingState || !errorState) return;

    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');

    let remaining = seconds || 60;
    const updateUI = () => {
        errorState.innerHTML = `
            <p style="color:var(--status-warn);">API Rate Limited.</p>
            <div style="font-size: 13px; font-weight: bold; margin-top: 10px;">
                Retrying in ${remaining}s...
            </div>
        `;
    };

    updateUI();
    const intv = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(intv);
            errorState.innerHTML = `<p>Retrying...</p>`;
            fetchTopics();
        } else {
            updateUI();
        }
    }, 1000);
}
