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
    const loadingState = document.getElementById('loading-topics');
    if (!list) return;

    list.innerHTML = '';
    if (loadingState) loadingState.classList.add('hidden');
    list.classList.remove('hidden');

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

    // Calculate totals
    let totalDiscovered = 0;
    let totalCompressed = 0;
    let totalRecent = 0;
    Object.values(stats).forEach(item => {
        totalDiscovered += item.total_discovered || 0;
        totalCompressed += item.total_compressed || 0;
        totalRecent += item.recent_count || 0;
    });

    // Add Total Summary Card at top
    const totalLi = document.createElement('li');
    totalLi.className = 'source-article-card feed-health-card status-ok';
    totalLi.style.padding = '10px 12px';
    totalLi.style.background = 'rgba(255, 255, 255, 0.05)';
    totalLi.style.border = '1px solid var(--border-color)';
    totalLi.style.marginBottom = '12px';
    totalLi.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <span class="health-icon">📊</span> 
            <strong style="font-size: 14px;">Global Cache Total</strong>
        </div>
        <div class="health-stats-grid" style="display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; font-size: 11px; margin-top: 8px;">
            <span style="color: var(--text-secondary)">Articles Discovered:</span>
            <strong style="text-align: right">${totalDiscovered}</strong>
            <span style="color: var(--text-secondary)">Summaries Compressed:</span>
            <strong style="text-align: right">${totalCompressed}</strong>
            <span style="color: var(--text-secondary)">New (Last 24h):</span>
            <strong style="text-align: right">${totalRecent}</strong>
        </div>
    `;
    list.appendChild(totalLi);

    Object.keys(stats).sort().forEach(source => {
        const item = stats[source];
        const hasError = !!item.error;
        let colorClass = 'status-ok';
        let icon = '✅';

        const statsHtml = `
            <div class="health-stats-grid" style="display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; font-size: 11px; margin-top: 6px;">
                <span style="color: var(--text-secondary)">Total History:</span>
                <strong style="text-align: right">${item.total_discovered || 0}</strong>
                <span style="color: var(--text-secondary)">Compressed:</span>
                <strong style="text-align: right">${item.total_compressed || 0}</strong>
                <span style="color: var(--text-secondary)">Last 24h:</span>
                <strong style="text-align: right">${item.recent_count || 0}</strong>
            </div>
        `;

        let runInfo = '';
        if (item.new_count > 0 || item.cached_count > 0) {
            runInfo = `<div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid var(--border-color); font-size: 10px; opacity: 0.7;">
                Latest: ${item.new_count || 0} new / ${item.cached_count || 0} cached
            </div>`;
        } else if (hasError) {
            runInfo = `<div style="margin-top: 6px; color: #f85149; font-size: 11px;">${item.error}</div>`;
        }

        const li = document.createElement('li');
        li.className = `source-article-card feed-health-card ${colorClass}`;
        li.style.padding = '8px 12px';
        li.innerHTML = `
            <div class="col-meta" style="display: flex; align-items: center; gap: 8px;">
                <span class="health-icon">${icon}</span> 
                <strong style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</strong>
            </div>
            ${statsHtml}
            ${item.source_breakdown ? `
                <div style="margin-top: 8px; font-size: 10px; border-top: 1px dashed var(--border-color); padding-top: 6px;">
                    <div style="opacity: 0.6; margin-bottom: 4px;">Domain Breakdown:</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                        ${Object.entries(item.source_breakdown).sort((a, b) => b[1] - a[1]).map(([domain, count]) => `
                            <span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1)">
                                ${domain}: <strong>${count}</strong>
                            </span>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            ${runInfo}
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
