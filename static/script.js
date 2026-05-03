// WikiWakeUp - Main Javascript logic

document.addEventListener('DOMContentLoaded', () => {
    const analyzeForm = document.getElementById('analyzeForm');
    const submitBtn = document.getElementById('submitBtn');
    const usernameInput = document.getElementById('usernameInput');
    const limitSelect = document.getElementById('limitSelect');
    const topSelect = document.getElementById('topSelect');
    const targetWikiSelect = document.getElementById('targetWikiSelect');
    
    const searchSection = document.getElementById('searchSection');
    const loadingSection = document.getElementById('loadingSection');
    const errorSection = document.getElementById('errorSection');
    const resultsSection = document.getElementById('resultsSection');
    const hiddenArticlesSection = document.getElementById('hiddenArticlesSection');
    
    const loadingMessage = document.getElementById('loadingMessage');
    const loadingBarFill = document.getElementById('loadingBarFill');
    const progressPercent = document.getElementById('progressPercent');
    const progressStep = document.getElementById('progressStep');
    const errorMessage = document.getElementById('errorMessage');
    
    const resultsTable = document.getElementById('resultsTable');
    const resultsBody = document.getElementById('resultsBody');
    const resultsTitle = document.getElementById('resultsTitle');
    const resultsSubtitle = document.getElementById('resultsSubtitle');
    const emptyState = document.getElementById('emptyState');
    
    const hiddenArticlesBody = document.getElementById('hiddenArticlesBody');
    const hiddenEmptyState = document.getElementById('hiddenEmptyState');
    
    const retryBtn = document.getElementById('retryBtn');
    const newSearchBtn = document.getElementById('newSearchBtn');
    const sortPriorityBtn = document.getElementById('sortPriority');
    const sortDateBtn = document.getElementById('sortDate');
    const viewHiddenBtn = document.getElementById('viewHiddenBtn');
    const backToSearchFromHidden = document.getElementById('backToSearchFromHidden');

    let currentResults = [];
    let pollingInterval = null;

    // Helper: Show specific section
    function showSection(section) {
        [searchSection, loadingSection, errorSection, resultsSection, hiddenArticlesSection].forEach(s => s.classList.add('hidden'));
        section.classList.remove('hidden');
    }

    // Helper: Format date
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString(window.WIKI_CONFIG.lang === 'nl' ? 'nl-NL' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // Poll job status
    function pollJobStatus(jobId) {
        fetch(`/api/status/${jobId}`)
            .then(res => res.json())
            .then(job => {
                if (job.status === 'pending' || job.status === 'running') {
                    // Update progress
                    loadingBarFill.style.width = `${job.progress}%`;
                    progressPercent.textContent = `${job.progress}%`;
                    loadingMessage.textContent = job.message;
                    progressStep.textContent = job.progress < 25 ? '1/4' : (job.progress < 50 ? '2/4' : (job.progress < 90 ? '3/4' : '4/4'));
                } else if (job.status === 'completed') {
                    clearInterval(pollingInterval);
                    renderResults(job.results);
                    showSection(resultsSection);
                } else if (job.status === 'failed') {
                    clearInterval(pollingInterval);
                    errorMessage.textContent = job.error || 'Error during analysis.';
                    showSection(errorSection);
                }
            })
            .catch(err => {
                clearInterval(pollingInterval);
                errorMessage.textContent = 'Error fetching status: ' + err.message;
                showSection(errorSection);
            });
    }

    // Handle Form Submit
    analyzeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let username = '';
        if (window.WIKI_CONFIG.loggedIn) {
            username = window.WIKI_CONFIG.username;
        } else if (usernameInput) {
            username = usernameInput.value.trim();
        }

        if (!username) return;

        const limit = limitSelect ? limitSelect.value : 10000;
        const top = topSelect ? topSelect.value : 100;
        const targetWiki = targetWikiSelect ? targetWikiSelect.value : 'nl.wikipedia.org';
        
        // Get compare langs from settings
        const compareLangs = Array.from(document.querySelectorAll('input[name="compare_lang"]:checked'))
                                  .map(cb => cb.value)
                                  .join(',') || 'en,de,fr,es';

        showSection(loadingSection);
        loadingBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
        loadingMessage.textContent = `Requesting analysis...`;

        try {
            const url = `/api/analyze?user=${encodeURIComponent(username)}&limit=${limit}&top=${top}&target_wiki=${targetWiki}&compare_langs=${compareLangs}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                errorMessage.textContent = data.error;
                showSection(errorSection);
                return;
            }

            // Start polling
            const jobId = data.job_id;
            pollingInterval = setInterval(() => pollJobStatus(jobId), 2000);

        } catch (err) {
            errorMessage.textContent = 'Error connecting to server.';
            showSection(errorSection);
        }
    });

    function renderResults(results) {
        currentResults = results;
        resultsBody.innerHTML = '';
        
        if (results.length === 0) {
            resultsTable.parentElement.classList.add('hidden');
            emptyState.classList.remove('hidden');
            resultsSubtitle.textContent = window.WIKI_CONFIG.lang === 'nl' ? 'Geen verouderde artikelen gevonden.' : 'No stale articles found.';
            return;
        }

        resultsTable.parentElement.classList.remove('hidden');
        emptyState.classList.add('hidden');
        resultsSubtitle.textContent = `${results.length} ${window.WIKI_CONFIG.lang === 'nl' ? 'artikelen gevonden.' : 'articles found.'}`;

        results.forEach((res, index) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-wm-bg-base transition-colors group';
            
            // Priority Class
            let priorityColor = 'text-wm-gray-secondary border-wm-gray-border';
            if (res.priority_score > 60) priorityColor = 'text-wm-red border-red-200 bg-red-50';
            else if (res.priority_score > 40) priorityColor = 'text-amber-600 border-amber-200 bg-amber-50';
            else if (res.priority_score > 20) priorityColor = 'text-wm-blue border-blue-200 bg-blue-50';

            const reasonsHtml = res.reasons.map(r => {
                let badgeClass = 'bg-gray-100 text-gray-700 border-gray-200';
                if (r.type === 'wikidata') badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                if (r.type === 'crosswiki') badgeClass = 'bg-purple-50 text-purple-700 border-purple-200';
                if (r.type === 'nowikidata') badgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
                
                return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mr-1.5 mb-1 border ${badgeClass}">${r.msg}</span>`;
            }).join('');

            const b = res.score_breakdown || {};
            const breakdownHtml = `
                <div class="text-[10px] space-y-1 p-1">
                    <div class="flex justify-between gap-4"><span>Time:</span><span class="font-bold text-gray-900">${b.staleness || 0}</span></div>
                    <div class="flex justify-between gap-4"><span>Wikidata:</span><span class="font-bold text-emerald-600">+${b.wikidata || 0}</span></div>
                    <div class="flex justify-between gap-4"><span>Cross-Wiki:</span><span class="font-bold text-purple-600">+${b.crosswiki || 0}</span></div>
                    <div class="flex justify-between gap-4"><span>Other:</span><span class="font-bold text-amber-600">+${b.nowikidata || 0}</span></div>
                </div>
            `;

            tr.innerHTML = `
                <td class="px-6 py-4 text-center text-wm-gray-secondary font-mono text-xs">${index + 1}</td>
                <td class="px-6 py-4" data-label="${window.WIKI_CONFIG.lang === 'nl' ? 'Artikel' : 'Article'}">
                    <a href="https://${targetWikiSelect.value}/wiki/${encodeURIComponent(res.title)}" target="_blank" 
                       class="text-wm-blue hover:underline font-bold transition-colors">
                        ${res.title}
                    </a>
                </td>
                <td class="px-6 py-4 text-wm-gray-secondary text-xs" data-label="${window.WIKI_CONFIG.lang === 'nl' ? 'Update' : 'Last update'}">${formatDate(res.last_edit_nl)}</td>
                <td class="px-6 py-4 text-center" data-label="Score">
                    <div class="relative group/score inline-block">
                        <span class="inline-block px-3 py-1 rounded-sm text-xs font-black border cursor-help ${priorityColor}">
                            ${res.priority_score}
                        </span>
                        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/score:block z-50">
                            <div class="bg-white border border-wm-gray-border rounded p-3 shadow-2xl min-w-[140px]">
                                ${breakdownHtml}
                            </div>
                            <div class="w-2 h-2 bg-white border-r border-b border-wm-gray-border rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4" data-label="${window.WIKI_CONFIG.lang === 'nl' ? 'Redenen' : 'Reasons'}">${reasonsHtml || `<span class="text-wm-gray-secondary italic text-xs">${window.WIKI_CONFIG.lang === 'nl' ? 'Verouderd (tijd)' : 'Stale (time)'}</span>`}</td>
                <td class="px-6 py-4 text-right actions-cell">
                    <button onclick="hideArticle('${res.title.replace(/'/g, "\\'")}')" class="p-1.5 text-wm-gray-secondary hover:text-wm-red transition-colors" title="Hide forever">
                        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    </button>
                </td>
            `;
            resultsBody.appendChild(tr);
        });
    }

    // Hide article function (global for onclick)
    window.hideArticle = async (title) => {
        if (!confirm(`Hide "${title}" forever from future analyses?`)) return;
        
        try {
            const res = await fetch('/api/hide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article: title })
            });
            if (res.ok) {
                currentResults = currentResults.filter(r => r.title !== title);
                renderResults(currentResults);
            }
        } catch (err) {
            console.error('Failed to hide article', err);
        }
    };

    // Unhide article
    window.unhideArticle = async (title) => {
        try {
            const res = await fetch('/api/unhide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article: title })
            });
            if (res.ok) {
                fetchHiddenArticles();
            }
        } catch (err) {
            console.error('Failed to unhide article', err);
        }
    };

    async function fetchHiddenArticles() {
        showSection(hiddenArticlesSection);
        hiddenArticlesBody.innerHTML = '<tr class="text-center"><td colspan="2" class="py-8 text-wm-gray-secondary">Loading...</td></tr>';
        
        try {
            const res = await fetch('/api/hidden');
            const data = await res.json();
            
            if (data.hidden && data.hidden.length > 0) {
                hiddenEmptyState.classList.add('hidden');
                hiddenArticlesBody.innerHTML = data.hidden.map(title => `
                    <tr class="hover:bg-wm-bg-base transition-colors">
                        <td class="px-6 py-4 font-bold text-wm-gray-base">${title}</td>
                        <td class="px-6 py-4 text-right">
                            <button onclick="unhideArticle('${title.replace(/'/g, "\\'")}')" class="text-xs font-bold text-wm-blue hover:underline">
                                Restore
                            </button>
                        </td>
                    </tr>
                `).join('');
            } else {
                hiddenArticlesBody.innerHTML = '';
                hiddenEmptyState.classList.remove('hidden');
            }
        } catch (err) {
            hiddenArticlesBody.innerHTML = '<tr class="text-center"><td colspan="2" class="py-8 text-wm-red">Error loading.</td></tr>';
        }
    }

    if (viewHiddenBtn) {
        viewHiddenBtn.addEventListener('click', fetchHiddenArticles);
    }
    
    if (backToSearchFromHidden) {
        backToSearchFromHidden.addEventListener('click', () => showSection(searchSection));
    }

    // Sorting
    function sortResults(criteria) {
        if (criteria === 'priority') {
            currentResults.sort((a, b) => b.priority_score - a.priority_score);
            sortPriorityBtn.classList.add('bg-wm-blue', 'text-white');
            sortPriorityBtn.classList.remove('text-wm-gray-secondary');
            sortDateBtn.classList.remove('bg-wm-blue', 'text-white');
            sortDateBtn.classList.add('text-wm-gray-secondary');
        } else {
            currentResults.sort((a, b) => new Date(b.last_edit_nl) - new Date(a.last_edit_nl));
            sortDateBtn.classList.add('bg-wm-blue', 'text-white');
            sortDateBtn.classList.remove('text-wm-gray-secondary');
            sortPriorityBtn.classList.remove('bg-wm-blue', 'text-white');
            sortPriorityBtn.classList.add('text-wm-gray-secondary');
        }
        renderResults(currentResults);
    }

    sortPriorityBtn.addEventListener('click', () => sortResults('priority'));
    sortDateBtn.addEventListener('click', () => sortResults('date'));
    
    retryBtn.addEventListener('click', () => showSection(searchSection));
    newSearchBtn.addEventListener('click', () => showSection(searchSection));
});
