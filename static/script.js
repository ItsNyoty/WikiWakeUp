// WikiWakeUp - Main Javascript logic

document.addEventListener('DOMContentLoaded', () => {
    const analyzeForm = document.getElementById('analyzeForm');
    const submitBtn = document.getElementById('submitBtn');
    const usernameInput = document.getElementById('usernameInput');
    const limitSelect = document.getElementById('limitSelect');
    const topSelect = document.getElementById('topSelect');
    
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
        return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
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
                    
                    // Estimate steps based on message
                    if (job.message.includes('Bijdragen')) progressStep.textContent = 'STAP 1/4';
                    else if (job.message.includes('Deep analysis') || job.message.includes('controleren')) progressStep.textContent = 'STAP 3/4';
                    else if (job.message.includes('sorteren')) progressStep.textContent = 'STAP 4/4';
                    
                } else if (job.status === 'completed') {
                    clearInterval(pollingInterval);
                    renderResults(job.results);
                    showSection(resultsSection);
                } else if (job.status === 'failed') {
                    clearInterval(pollingInterval);
                    errorMessage.textContent = job.error || 'Er is een onbekende fout opgetreden tijdens de analyse.';
                    showSection(errorSection);
                }
            })
            .catch(err => {
                clearInterval(pollingInterval);
                errorMessage.textContent = 'Fout bij het ophalen van de status: ' + err.message;
                showSection(errorSection);
            });
    }

    // Handle Form Submit
    analyzeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let username = '';
        if (window.WIKI_CONFIG.loggedIn) {
            username = window.WIKI_CONFIG.username;
        } else {
            username = usernameInput.value.trim();
        }

        if (!username) return;

        const limit = limitSelect.value;
        const top = topSelect.value;

        showSection(loadingSection);
        loadingBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
        progressStep.textContent = 'STAP 1/4';
        loadingMessage.textContent = `Bezig met aanvragen van analyse voor ${username}...`;

        try {
            const response = await fetch(`/api/analyze?user=${encodeURIComponent(username)}&limit=${limit}&top=${top}`);
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
            errorMessage.textContent = 'Er is een fout opgetreden bij het verbinden met de server.';
            showSection(errorSection);
        }
    });

    function renderResults(results) {
        currentResults = results;
        resultsBody.innerHTML = '';
        
        if (results.length === 0) {
            resultsTable.classList.add('hidden');
            emptyState.classList.remove('hidden');
            resultsSubtitle.textContent = 'Geen verouderde artikelen gevonden.';
            return;
        }

        resultsTable.classList.remove('hidden');
        emptyState.classList.add('hidden');
        resultsSubtitle.textContent = `${results.length} artikelen gevonden die mogelijk een update nodig hebben.`;

        results.forEach((res, index) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-800/40 transition-colors group';
            
            // Priority Class
            let priorityClass = 'text-gray-400 bg-gray-800/50';
            if (res.priority_score > 60) priorityClass = 'text-red-400 bg-red-500/10 border-red-500/20';
            else if (res.priority_score > 40) priorityClass = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            else if (res.priority_score > 20) priorityClass = 'text-blue-400 bg-blue-500/10 border-blue-500/20';

            const reasonsHtml = res.reasons.map(r => {
                let badgeClass = 'bg-gray-100 text-gray-700 border-gray-200';
                if (r.type === 'wikidata') badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                if (r.type === 'crosswiki') badgeClass = 'bg-purple-50 text-purple-700 border-purple-200';
                if (r.type === 'nowikidata') badgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
                
                return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mr-1.5 mb-1 border ${badgeClass}">${r.msg}</span>`;
            }).join('');

            // Score breakdown tooltip content
            const b = res.score_breakdown || {};
            const breakdownHtml = `
                <div class="text-[10px] space-y-1 p-1">
                    <div class="flex justify-between gap-4"><span>Staleness:</span><span class="font-bold text-white">${b.staleness || 0}</span></div>
                    <div class="flex justify-between gap-4"><span>Wikidata:</span><span class="font-bold text-emerald-400">+${b.wikidata || 0}</span></div>
                    <div class="flex justify-between gap-4"><span>Cross-Wiki:</span><span class="font-bold text-purple-400">+${b.crosswiki || 0}</span></div>
                    <div class="flex justify-between gap-4"><span>No Wikidata:</span><span class="font-bold text-amber-400">+${b.nowikidata || 0}</span></div>
                </div>
            `;

            tr.innerHTML = `
                <td class="px-6 py-5 text-center text-gray-600 font-mono text-xs">${index + 1}</td>
                <td class="px-6 py-5">
                    <a href="https://nl.wikipedia.org/wiki/${encodeURIComponent(res.title)}" target="_blank" 
                       class="text-blue-400 hover:text-blue-300 font-bold transition-colors">
                        ${res.title}
                    </a>
                </td>
                <td class="px-6 py-5 text-gray-400 text-xs">${formatDate(res.last_edit_nl)}</td>
                <td class="px-6 py-5 text-gray-500 text-xs hidden lg:table-cell">${res.days_since_edit}d</td>
                <td class="px-6 py-5 text-center">
                    <div class="relative group/score inline-block">
                        <span class="inline-block px-3 py-1 rounded-full text-xs font-black border cursor-help ${priorityClass}">
                            ${res.priority_score}
                        </span>
                        <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/score:block z-50">
                            <div class="bg-gray-950 border border-gray-800 rounded-lg p-3 shadow-2xl min-w-[140px]">
                                ${breakdownHtml}
                            </div>
                            <div class="w-2 h-2 bg-gray-950 border-r border-b border-gray-800 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-5">${reasonsHtml || '<span class="text-gray-600 italic text-xs">Stale content (tijd)</span>'}</td>
                <td class="px-6 py-5 text-right">
                    <button onclick="hideArticle('${res.title.replace(/'/g, "\\'")}')" class="p-1.5 text-gray-700 hover:text-red-400 transition-colors" title="Verberg dit artikel permanent">
                        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    </button>
                </td>
            `;
            resultsBody.appendChild(tr);
        });
    }

    // Hide article function (global for onclick)
    window.hideArticle = async (title) => {
        if (!confirm(`Weet je zeker dat je "${title}" permanent wilt verbergen voor toekomstige analyses?`)) return;
        
        try {
            const res = await fetch('/api/hide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article: title })
            });
            if (res.ok) {
                // Remove from current view
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
        hiddenArticlesBody.innerHTML = '<tr class="text-center"><td colspan="2" class="py-8 text-gray-500">Laden...</td></tr>';
        
        try {
            const res = await fetch('/api/hidden');
            const data = await res.json();
            
            if (data.hidden && data.hidden.length > 0) {
                hiddenEmptyState.classList.add('hidden');
                hiddenArticlesBody.innerHTML = data.hidden.map(title => `
                    <tr class="hover:bg-gray-800/40 transition-colors">
                        <td class="px-6 py-4 font-medium text-gray-300">${title}</td>
                        <td class="px-6 py-4 text-right">
                            <button onclick="unhideArticle('${title.replace(/'/g, "\\'")}')" class="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors">
                                Herstellen
                            </button>
                        </td>
                    </tr>
                `).join('');
            } else {
                hiddenArticlesBody.innerHTML = '';
                hiddenEmptyState.classList.remove('hidden');
            }
        } catch (err) {
            hiddenArticlesBody.innerHTML = '<tr class="text-center"><td colspan="2" class="py-8 text-red-400">Fout bij laden.</td></tr>';
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
            sortPriorityBtn.classList.add('bg-blue-600', 'text-white');
            sortPriorityBtn.classList.remove('text-gray-500');
            sortDateBtn.classList.remove('bg-blue-600', 'text-white');
            sortDateBtn.classList.add('text-gray-500');
        } else {
            currentResults.sort((a, b) => new Date(b.last_edit_nl) - new Date(a.last_edit_nl));
            sortDateBtn.classList.add('bg-blue-600', 'text-white');
            sortDateBtn.classList.remove('text-gray-500');
            sortPriorityBtn.classList.remove('bg-blue-600', 'text-white');
            sortPriorityBtn.classList.add('text-gray-500');
        }
        renderResults(currentResults);
    }

    sortPriorityBtn.addEventListener('click', () => sortResults('priority'));
    sortDateBtn.addEventListener('click', () => sortResults('date'));
    
    retryBtn.addEventListener('click', () => showSection(searchSection));
    newSearchBtn.addEventListener('click', () => showSection(searchSection));
});
