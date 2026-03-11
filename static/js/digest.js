import { state } from './state.js';
import { normalizeUrl } from './utils.js';
import { generateDigest } from './api.js';

export function renderSourceArticles(skippedArticles = []) {
    const list = document.getElementById('source-list-panel');
    const countLabel = document.getElementById('source-count');
    if (!list || !countLabel) return;
    list.innerHTML = '';

    if (!state.currentArticles || state.currentArticles.length === 0) {
        countLabel.innerText = '0 articles found';
        return;
    }

    const skippedSet = new Set((skippedArticles || []).map(sa => normalizeUrl(sa.link)));
    const scrapedCount = state.currentArticles.filter(a => !skippedSet.has(normalizeUrl(a.link))).length;

    countLabel.innerText = `${state.currentArticles.length} found (${scrapedCount} scraped / ${skippedSet.size} skipped)`;

    let sorted = state.currentArticles.map((art, idx) => ({
        ...art,
        originalIndex: idx + 1,
        citations: state.currentCitations[idx + 1] || 0,
        skipped: skippedSet.has(normalizeUrl(art.link))
    }));

    if (state.currentSort === 'citations') {
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

export function countCitations(text, articles) {
    const counts = {};
    const bracketRegex = /\[([^\]]+)\]/g;
    let match;
    while ((match = bracketRegex.exec(text)) !== null) {
        const content = match[1];
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

export function scrollToSource(n) {
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

export function linkifyCitations(container, articles) {
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

export function bindCitationLinks(articles) {
    const contentBox = document.getElementById('digest-content');
    if (!contentBox) return;

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

export function renderHeaderNav(markdown) {
    const navList = document.getElementById('header-nav-list');
    if (!navList) return;
    navList.innerHTML = '';

    const contentBox = document.getElementById('digest-content');
    if (!contentBox) return;

    const allHeaders = contentBox.querySelectorAll('h2, h3, h4');
    allHeaders.forEach((h, idx) => {
        h.id = `digest-h-${idx}`;
    });

    let headerCount = 0;
    allHeaders.forEach((h, idx) => {
        headerCount++;
        const level = h.tagName.toLowerCase();
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
                    top: targetTop - 40,
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
