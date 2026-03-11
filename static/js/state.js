import { renderSourceArticles } from './digest.js';

export const state = {
    currentArticles: [],
    currentCitations: {},
    currentSort: 'number',
    currentDigestMarkdown: '',
    topicSelectionHistory: [],
    allTopics: [],
    lastSkippedArticles: [],
    targetDate: '',
    selectedManualTopic: null
};

export function setSort(type) {
    state.currentSort = type;
    document.getElementById('sort-num-btn')?.classList.toggle('active', type === 'number');
    document.getElementById('sort-cite-btn')?.classList.toggle('active', type === 'citations');
    renderSourceArticles(state.lastSkippedArticles);
}
