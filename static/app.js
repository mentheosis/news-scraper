document.addEventListener('DOMContentLoaded', () => {
    fetchDates();
    const today = getLocalYYYYMMDD();
    fetchTopics(false, today); // Initial load: try cache for TODAY local

    // -- Mini Strip Navigation --
    document.getElementById('btn-show-topics').addEventListener('click', () => {
        toggleSidebar('sidebar', 'btn-show-topics');
    });

    document.getElementById('btn-show-headers').addEventListener('click', () => {
        toggleSidebar('headers-sidebar', 'btn-show-headers');
    });

    document.getElementById('btn-show-health').addEventListener('click', () => {
        toggleSidebar('secondary-sidebar', 'btn-show-health');
    });

    document.getElementById('btn-show-sources').addEventListener('click', () => {
        toggleSidebar('right-sidebar', 'btn-show-sources');
    });

    // -- Collapse Buttons --
    document.getElementById('collapse-topics-btn').addEventListener('click', () => {
        toggleSidebar('sidebar', 'btn-show-topics');
    });

    document.getElementById('collapse-headers-btn').addEventListener('click', () => {
        toggleSidebar('headers-sidebar', 'btn-show-headers');
    });

    document.getElementById('collapse-health-btn').addEventListener('click', () => {
        toggleSidebar('secondary-sidebar', 'btn-show-health');
    });

    document.getElementById('refresh-btn').addEventListener('click', () => {
        // Refresh always targets "Today"
        const dateSelect = document.getElementById('news-date-select');
        const today = getLocalYYYYMMDD();

        // If we are on another day, switch to today and refresh
        if (dateSelect.value !== today) {
            // Check if today is in the list, if not add it temporarily
            let found = false;
            for (let opt of dateSelect.options) {
                if (opt.value === today) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = today;
                opt.innerText = today + " (Today)";
                dateSelect.prepend(opt);
            }
            dateSelect.value = today;
        }

        fetchTopics(true, today);
    });

    document.getElementById('news-date-select').addEventListener('change', (e) => {
        fetchTopics(false, e.target.value);
    });

    document.getElementById('sort-num-btn').addEventListener('click', () => {
        setSort('number');
    });

    document.getElementById('sort-cite-btn').addEventListener('click', () => {
        setSort('citations');
    });

    document.querySelectorAll('.hot-take-btn.preset').forEach(btn => {
        btn.addEventListener('click', () => fetchHotTake(btn.dataset.name));
    });

    document.getElementById('hot-take-custom-btn').addEventListener('click', () => {
        const name = document.getElementById('hot-take-custom-input').value.trim();
        if (name) fetchHotTake(name);
    });

    document.getElementById('hot-take-custom-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const name = e.target.value.trim();
            if (name) fetchHotTake(name);
        }
    });

    document.getElementById('close-hot-take').addEventListener('click', closeHotTakeModal);
    document.getElementById('hot-take-backdrop').addEventListener('click', closeHotTakeModal);
});

async function fetchDates() {
    try {
        const res = await fetch('/api/dates');
        const data = await res.json();
        const select = document.getElementById('news-date-select');
        const today = getLocalYYYYMMDD();

        select.innerHTML = '';

        // Ensure today is always an option at the top if not already in cache
        if (!data.dates.includes(today)) {
            const opt = document.createElement('option');
            opt.value = today;
            opt.innerText = today + " (Today)";
            select.appendChild(opt);
        }

        data.dates.forEach(date => {
            const opt = document.createElement('option');
            opt.value = date;
            opt.innerText = date + (date === today ? " (Today)" : "");
            // Avoid duplicate today
            if (date === today) {
                select.innerHTML = ''; // Start over and let the loop handle it
            }
        });

        // Re-do the loop properly to avoid logic mess
        select.innerHTML = '';
        const allDates = [...data.dates];
        if (!allDates.includes(today)) allDates.unshift(today);
        else {
            // Ensure today is first if it was in the middle
            const idx = allDates.indexOf(today);
            allDates.splice(idx, 1);
            allDates.unshift(today);
        }

        allDates.forEach(date => {
            const opt = document.createElement('option');
            opt.value = date;
            opt.innerText = date + (date === today ? " (Today)" : "");
            select.appendChild(opt);
        });

        select.value = today;
    } catch (err) {
        console.error("Failed to fetch dates:", err);
    }
}

function toggleSidebar(sidebarId, btnId) {
    const sidebar = document.getElementById(sidebarId);
    const btn = document.getElementById(btnId);

    // Toggle the target sidebar
    const isCollapsed = sidebar.classList.toggle('collapsed');

    // Update button active state
    if (btn) btn.classList.toggle('active', !isCollapsed);
}

function closeSidebar(sidebarId, btnId) {
    const sidebar = document.getElementById(sidebarId);
    const btn = document.getElementById(btnId);
    if (sidebar) sidebar.classList.add('collapsed');
    if (btn) btn.classList.remove('active');
}

let currentArticles = [];
let currentCitations = {};
let currentSort = 'number';
let currentDigestMarkdown = '';

async function fetchTopics(isRefresh = true, targetDate = '') {
    const topicList = document.getElementById('topic-list');
    const loadingState = document.getElementById('loading-topics');
    const errorState = document.getElementById('error-topics');
    const statusText = document.getElementById('status-text-topics');
    const topicsHeader = document.querySelector('.topics-header');

    const today = getLocalYYYYMMDD();
    if (!targetDate) {
        targetDate = document.getElementById('news-date-select').value || today;
    }

    // Hide depth/refresh for past dates
    if (topicsHeader) {
        if (targetDate !== today) {
            topicsHeader.classList.add('hidden');
        } else {
            topicsHeader.classList.remove('hidden');
        }
    }

    topicList.classList.add('hidden');
    errorState.classList.add('hidden');
    loadingState.classList.remove('hidden');

    if (!isRefresh) {
        statusText.innerText = `Loading reports for ${targetDate}...`;
    } else {
        statusText.innerText = "Clustering latest headlines...";
    }

    try {
        const limitVal = document.getElementById('feed-limit').value || 25;
        const res = await fetch(`/api/topics?limit=${limitVal}&refresh=${isRefresh}&date=${targetDate}`);

        if (res.status === 429) {
            const data = await res.json().catch(() => ({}));
            handleTopicsRateLimit(data.retry_after);
            return;
        }

        if (!res.ok) throw new Error(`Server error: ${res.status} ${res.statusText}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const rawEvent of events) {
                if (!rawEvent.trim()) continue;

                const lines = rawEvent.split(/\r?\n/);
                let eventType = 'message';
                let dataStr = '';

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('event: ')) {
                        eventType = trimmedLine.replace('event: ', '').trim();
                    } else if (trimmedLine.startsWith('data: ')) {
                        dataStr = trimmedLine.replace('data: ', '').trim();
                    }
                }

                if (dataStr) {
                    try {
                        const data = JSON.parse(dataStr);
                        if (eventType === 'progress') {
                            statusText.innerText = data.message;
                        } else if (eventType === 'error') {
                            if (data.error === "API Rate Limited") {
                                handleTopicsRateLimit(data.retry_after);
                            } else {
                                throw new Error(data.message || "Failed to load topics");
                            }
                            return;
                        } else if (eventType === 'result') {
                            window.allTopics = data.clusters;
                            renderTopics(window.allTopics);
                            renderFeedHealth(data.feed_stats);

                            loadingState.classList.add('hidden');
                            topicList.classList.remove('hidden');
                        }
                    } catch (parseErr) {
                        console.error("SSE Parse Error:", parseErr, "Raw Event:", rawEvent, "Extracted DataStr:", dataStr);
                        throw parseErr;
                    }
                }
            }
        }
    } catch (err) {
        console.error("fetchTopics error:", err);
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        errorState.innerHTML = `
            <p style="color:var(--status-err); font-weight:bold;">Failed to load topics</p>
            <p style="font-size:12px; margin-bottom:10px;">${err.message}</p>
            <button class="retry-btn" onclick="fetchTopics(true)">Try Again</button>
        `;
    }
}

let topicSelectionHistory = [];

function renderTopics(topics) {
    const list = document.getElementById('topic-list');
    list.innerHTML = ''; // Clear existing

    if (!topics || topics.length === 0) {
        list.innerHTML = `<li class="empty-list">No major topics found today.</li>`;
        return;
    }

    // Map with original index before sorting
    const enrichedTopics = topics.map((t, i) => ({ ...t, originalIndex: i }));

    // Sort: Selection History first (most recent at top), then Cached Digest, then the rest
    const sortedTopics = enrichedTopics.sort((a, b) => {
        const indexA = topicSelectionHistory.indexOf(a.title);
        const indexB = topicSelectionHistory.indexOf(b.title);

        // If both are in history, sort by most recent (lower index in history array)
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        // If only A is in history, it comes first
        if (indexA !== -1) return -1;
        // If only B is in history, it comes first
        if (indexB !== -1) return 1;

        // Fallback for non-selected topics: Cached vs Non-cached
        if (a.has_cached_digest && !b.has_cached_digest) return -1;
        if (!a.has_cached_digest && b.has_cached_digest) return 1;

        return 0;
    });

    sortedTopics.forEach((topic) => {
        const li = document.createElement('li');
        li.className = 'topic-card';
        // Active state should still highlight the current one
        const currentTitle = topicSelectionHistory[0];
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
            // Update selection history: move clicked title to front
            const histIdx = topicSelectionHistory.indexOf(topic.title);
            if (histIdx !== -1) {
                topicSelectionHistory.splice(histIdx, 1);
            }
            topicSelectionHistory.unshift(topic.title);

            // Immediate re-render to move to top and preserve history order
            renderTopics(topics);
            generateDigest(topic.originalIndex, topic.title);
        });

        list.appendChild(li);
    });
}

async function generateDigest(topicIdx, title) {
    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-digest');
    const digestView = document.getElementById('digest-view');
    const contentBox = document.getElementById('digest-content');
    const titleBox = document.getElementById('digest-title');
    const rightSidebar = document.getElementById('right-sidebar');

    // UI transitions
    emptyState.classList.add('hidden');
    digestView.classList.add('hidden');

    // Auto-open Navigation Sidebar
    const navSidebar = document.getElementById('headers-sidebar');
    if (navSidebar && navSidebar.classList.contains('collapsed')) {
        navSidebar.classList.remove('collapsed');
        const btnH = document.getElementById('btn-show-headers');
        if (btnH) btnH.classList.add('active');
    }

    // Reset sidebars/panels
    loadingState.classList.remove('hidden');
    contentBox.innerHTML = '';
    currentDigestMarkdown = '';
    closeHotTakeModal();

    // Clear Navigation Panel
    const navList = document.getElementById('header-nav-list');
    if (navList) {
        navList.innerHTML = '<div class="empty-nav-msg">Generating navigation...</div>';
    }

    // Clear Sources Panel
    const sourceList = document.getElementById('source-list-panel');
    if (sourceList) {
        sourceList.innerHTML = '<li class="empty-list">Loading source articles...</li>';
    }
    const sourceCount = document.getElementById('source-count');
    if (sourceCount) {
        sourceCount.innerText = '0 articles processed';
    }

    document.getElementById('loading-status-text').innerText = `Preparing sources for: ${title}...`;
    document.getElementById('progress-step').innerText = "Initializing...";

    const targetDate = document.getElementById('news-date-select').value || getLocalYYYYMMDD();
    try {
        const response = await fetch(`/api/digest?topicId=${topicIdx}&date=${targetDate}`, { method: 'POST' });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process SSE chunks
            const events = buffer.split('\n\n');
            buffer = events.pop(); // Keep partial chunk in buffer

            for (const rawEvent of events) {
                if (!rawEvent.trim()) continue;

                const lines = rawEvent.split('\n');
                let eventType = 'message';
                let dataStr = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.replace('event: ', '').trim();
                    } else if (line.startsWith('data: ')) {
                        dataStr = line.replace('data: ', '').trim();
                    }
                }

                if (dataStr) {
                    const data = JSON.parse(dataStr);

                    if (eventType === 'progress') {
                        document.getElementById('progress-step').innerText = `Step ${data.step} of 3`;
                        document.getElementById('loading-status-text').innerText = data.message;
                    } else if (eventType === 'error') {
                        if (data.error === "API Rate Limited") {
                            handleDigestRateLimit(data.retry_after, () => generateDigest(topicIdx, title));
                        } else if (data.error === "API Overloaded") {
                            loadingState.classList.add('hidden');
                            digestView.classList.remove('hidden');
                            contentBox.innerHTML = `
                                <div class="error-state">
                                    <p style="color:var(--status-warn); font-weight:bold; font-size:16px;">${data.message}</p>
                                    <button class="retry-btn" style="margin-top:20px;" onclick="generateDigest(${topicIdx}, '${title.replace(/'/g, "\\'")}')">Try Synthesis Again</button>
                                </div>
                            `;
                            document.getElementById('loading-status-text').innerText = "Gemini is busy";
                        } else {
                            throw new Error(data.message || "Failed to generate digest");
                        }
                        return;
                    } else if (eventType === 'result') {
                        // Render final result
                        currentDigestMarkdown = data.digest;
                        titleBox.innerText = data.title;
                        contentBox.innerHTML = marked.parse(data.digest);

                        if (data.articles) {
                            linkifyCitations(contentBox, data.articles);
                        }

                        // Generate Navigation Headers
                        renderHeaderNav(data.digest);

                        loadingState.classList.add('hidden');
                        digestView.classList.remove('hidden');

                        if (data.articles) {
                            currentArticles = data.articles;
                            currentCitations = countCitations(data.digest, data.articles);
                            window.lastSkippedArticles = data.skipped_articles || [];
                            renderSourceArticles(window.lastSkippedArticles);

                            if (data.feed_stats) {
                                renderFeedHealth(data.feed_stats);
                            }

                            document.getElementById('digest-sources-panel').classList.remove('hidden');

                            // Automatically show sources when digest is ready
                            const rs = document.getElementById('right-sidebar');
                            if (rs) {
                                rs.classList.remove('collapsed');
                                const btnS = document.getElementById('btn-show-sources');
                                if (btnS) btnS.classList.add('active');
                            }

                            bindCitationLinks(data.articles);
                        }

                        // Update cache state in UI without refresh
                        if (window.allTopics && window.allTopics[topicIdx]) {
                            window.allTopics[topicIdx].has_cached_digest = true;
                            renderTopics(window.allTopics);
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error(err);
        loadingState.classList.add('hidden');
        digestView.classList.remove('hidden');
        // Keep right sidebar state as is or hide it
        document.getElementById('digest-sources-panel').classList.add('hidden');
        titleBox.innerText = 'Error Generating Digest';
        contentBox.innerHTML = `<div class="error-box"><p>${err.message}</p></div>`;
    }
}

function renderFeedHealth(stats) {
    const list = document.getElementById('feed-health-list');
    list.innerHTML = '';

    if (!stats) return;

    Object.keys(stats).sort().forEach(source => {
        const item = stats[source];
        const hasError = !!item.error;
        let colorClass = 'status-ok';
        let icon = '✅';

        // Build description: prioritize "N new / M cached" if available
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

function renderSourceArticles(skippedArticles = []) {
    const list = document.getElementById('source-list-panel');
    const countLabel = document.getElementById('source-count');
    list.innerHTML = '';

    if (!currentArticles || currentArticles.length === 0) {
        countLabel.innerText = '0 articles found';
        return;
    }

    // Determine how many were actually scraped vs skipped
    const normalizeUrl = (u) => (u || '').split('?')[0].split('#')[0].trim();
    const skippedSet = new Set((skippedArticles || []).map(sa => normalizeUrl(sa.link)));
    const scrapedCount = currentArticles.filter(a => !skippedSet.has(normalizeUrl(a.link))).length;

    countLabel.innerText = `${currentArticles.length} found (${scrapedCount} scraped / ${skippedSet.size} skipped)`;

    // Map cluster articles to their original index, citation count, and skipped status
    let sorted = currentArticles.map((art, idx) => ({
        ...art,
        originalIndex: idx + 1,
        citations: currentCitations[idx + 1] || 0,
        skipped: skippedSet.has(normalizeUrl(art.link))
    }));

    if (currentSort === 'citations') {
        sorted.sort((a, b) => b.citations - a.citations || a.originalIndex - b.originalIndex);
    } else {
        sorted.sort((a, b) => a.originalIndex - b.originalIndex);
    }

    sorted.forEach((art) => {
        const li = document.createElement('li');
        li.className = 'source-article-card' + (art.skipped ? ' skipped' : '');
        li.id = `source-card-${art.originalIndex}`;

        const citationBadge = (art.citations > 0 && !art.skipped)
            ? `<span class="citation-badge">${art.citations} cit.</span>`
            : '';

        const statusText = art.skipped ? ' [SKIPPED/PAYWALL]' : '';

        const pubDate = art.published ? new Date(art.published).toLocaleDateString() : 'Unknown';
        const fetchDate = art.fetch_date || 'N/A';

        li.innerHTML = `
            <div class="col-meta">
                <span class="article-ref">[Article ${art.originalIndex}]</span> 
                <strong>${art.source_name || ''}</strong>
                ${citationBadge}
                ${statusText}
            </div>
            <a href="${art.link}" target="_blank" class="col-title">${art.title}</a>
            <div class="article-dates-row" style="margin-top: 6px; font-size: 11px; opacity: 0.8; display: flex; gap: 15px;">
                <span>📅 Published: ${pubDate}</span>
                <span>📥 Discovered: ${fetchDate}</span>
            </div>
        `;
        list.appendChild(li);
    });
}

function setSort(type) {
    currentSort = type;
    document.getElementById('sort-num-btn').classList.toggle('active', type === 'number');
    document.getElementById('sort-cite-btn').classList.toggle('active', type === 'citations');
    renderSourceArticles(window.lastSkippedArticles || []);
}

function countCitations(text, articles) {
    const counts = {};
    const bracketRegex = /\[([^\]]+)\]/g;
    let match;
    while ((match = bracketRegex.exec(text)) !== null) {
        const content = match[1];
        // Only process if it looks like a citation (contains "Article" or only digits/commas/spaces)
        if (!/article/i.test(content) && !/^[\d\s,]+$/.test(content)) continue;

        const nums = (content.match(/\d+/g) || []).map(n => parseInt(n));
        nums.forEach(n => {
            if (!isNaN(n) && n >= 1 && n <= (articles ? articles.length : 999)) {
                counts[n] = (counts[n] || 0) + 1;
            }
        });
    }
    return counts;
}

function scrollToSource(n) {
    const allCards = document.querySelectorAll('.source-article-card');
    allCards.forEach(c => c.classList.remove('highlight'));

    const card = document.getElementById(`source-card-${n}`);
    if (card) {
        const rs = document.getElementById('right-sidebar');
        if (rs && rs.classList.contains('collapsed')) {
            rs.classList.remove('collapsed');
            const btnS = document.getElementById('btn-show-sources');
            if (btnS) btnS.classList.add('active');
        }
        card.classList.add('highlight');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function linkifyCitations(container, articles) {
    const bracketRegex = /\[([^\]]+)\]/g;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        if (bracketRegex.test(node.textContent)) textNodes.push(node);
        bracketRegex.lastIndex = 0;
    }

    textNodes.forEach(textNode => {
        const parent = textNode.parentNode;
        const text = textNode.textContent;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        bracketRegex.lastIndex = 0;
        let match;

        while ((match = bracketRegex.exec(text)) !== null) {
            const content = match[1];
            // Only process if it looks like a citation (contains "Article" or only digits/commas/spaces)
            if (!/article/i.test(content) && !/^[\d\s,]+$/.test(content)) {
                continue;
            }

            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }

            const nums = (content.match(/\d+/g) || []).map(n => parseInt(n)).filter(n => n >= 1 && n <= articles.length);

            if (nums.length === 0) {
                fragment.appendChild(document.createTextNode(match[0]));
            } else {
                fragment.appendChild(document.createTextNode('['));
                nums.forEach((n, i) => {
                    if (i > 0) fragment.appendChild(document.createTextNode(', '));
                    const span = document.createElement('span');
                    span.className = 'citation-link';
                    span.dataset.article = n;
                    span.textContent = n;
                    span.addEventListener('click', () => scrollToSource(n));
                    fragment.appendChild(span);
                });
                fragment.appendChild(document.createTextNode(']'));
            }

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        parent.replaceChild(fragment, textNode);
    });
}

function bindCitationLinks(articles) {
    const contentBox = document.getElementById('digest-content');

    contentBox.querySelectorAll('a').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            const sourceIdx = articles.findIndex(a => a.link === href || (a.link && href.includes(a.link)));

            if (sourceIdx !== -1) {
                e.preventDefault();
                scrollToSource(sourceIdx + 1);
            }
        });
    });
}

function handleTopicsRateLimit(seconds) {
    const loadingState = document.getElementById('loading-topics');
    const errorState = document.getElementById('error-topics');

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

function handleDigestRateLimit(seconds, retryCallback) {
    const loadingState = document.getElementById('loading-digest');
    const digestView = document.getElementById('digest-view');
    const titleBox = document.getElementById('digest-title');
    const contentBox = document.getElementById('digest-content');

    loadingState.classList.add('hidden');
    digestView.classList.remove('hidden');

    let remaining = seconds || 60;

    const updateUI = () => {
        contentBox.innerHTML = `
            <div class="rate-limit-state">
                <p style="color:var(--status-warn); font-weight:bold;">Gemini Rate Limit Exceeded</p>
                <p>Synthesis will resume automatically in <strong>${remaining}s</strong>...</p>
                <div class="progress-bar-container" style="margin-top:15px;">
                    <div class="progress-bar-fill" style="width: ${(1 - remaining / (seconds || 60)) * 100}%"></div>
                </div>
            </div>
        `;
    };

    updateUI();
    const intv = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(intv);
            retryCallback();
        } else {
            updateUI();
        }
    }, 1000);
}

function closeHotTakeModal() {
    document.getElementById('hot-take-modal').classList.add('hidden');
}

async function fetchHotTake(name) {
    if (!currentDigestMarkdown || !name) return;

    const modal = document.getElementById('hot-take-modal');
    const loading = document.getElementById('hot-take-loading');
    const content = document.getElementById('hot-take-content');
    const authorName = document.getElementById('hot-take-author-name');

    authorName.innerText = name;
    content.innerHTML = '';
    content.classList.add('hidden');
    loading.classList.remove('hidden');
    modal.classList.remove('hidden');

    // Highlight matching preset button (if any), clear others
    document.querySelectorAll('.hot-take-btn.preset').forEach(b => {
        b.classList.toggle('active', b.dataset.name === name);
    });

    try {
        const res = await fetch(`/api/hot-take?name=${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ digest: currentDigestMarkdown }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Server error ${res.status}`);
        }

        const data = await res.json();
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        content.innerHTML = marked.parse(data.take);
    } catch (err) {
        loading.classList.add('hidden');
        content.classList.remove('hidden');
        content.innerHTML = `<p style="color:#f85149;">Failed to generate hot take: ${err.message}</p>`;
    }
}

function renderHeaderNav(markdown) {
    const navList = document.getElementById('header-nav-list');
    navList.innerHTML = '';

    const contentBox = document.getElementById('digest-content');

    // First pass: inject IDs into headers in the rendered DOM
    const allHeaders = contentBox.querySelectorAll('h2, h3, h4');
    allHeaders.forEach((h, idx) => {
        h.id = `digest-h-${idx}`;
    });

    let headerCount = 0;
    allHeaders.forEach((h, idx) => {
        headerCount++;
        const level = h.tagName.toLowerCase(); // 'h1', 'h2', 'h3'
        const title = h.innerText.replace(/\[(?:Article\s+)?[\d,\s]+\]/gi, '').trim();

        const li = document.createElement('li');
        li.className = `header-nav-item ${level}`;
        li.innerText = title;
        li.addEventListener('click', () => {
            const target = document.getElementById(`digest-h-${idx}`);
            const container = document.querySelector('.main-content');
            if (target && container) {
                const targetTop = target.offsetTop;
                container.scrollTo({
                    top: targetTop - 40, // Offset for some breathing room
                    behavior: 'smooth'
                });
                document.querySelectorAll('.header-nav-item').forEach(n => n.classList.remove('active'));
                li.classList.add('active');
            }
        });
        navList.appendChild(li);
    });

    if (headerCount === 0) {
        navList.innerHTML = `<div class="empty-nav-msg">No headers found in this digest.</div>`;
    }
}

function getLocalYYYYMMDD() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localTime = new Date(now.getTime() - (offset * 60 * 1000));
    return localTime.toISOString().split('T')[0];
}
