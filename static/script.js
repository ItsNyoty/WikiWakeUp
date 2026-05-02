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
    
    const retryBtn = document.getElementById('retryBtn');
    const newSearchBtn = document.getElementById('newSearchBtn');
    const sortPriorityBtn = document.getElementById('sortPriority');
    const sortDateBtn = document.getElementById('sortDate');

    let currentResults = [];
    let pollingInterval = null;

    // Helper: Show specific section
    function showSection(section) {
        [searchSection, loadingSection, errorSection, resultsSection].forEach(s => s.classList.add('hidden'));
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
                let badgeClass = 'bg-gray-800 text-gray-400';
                if (r.type === 'wikidata') badgeClass = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                if (r.type === 'crosswiki') badgeClass = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
                if (r.type === 'nowikidata') badgeClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                
                return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold mr-1.5 mb-1 ${badgeClass}">${r.msg}</span>`;
            }).join('');

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
                    <span class="inline-block px-3 py-1 rounded-full text-xs font-black border ${priorityClass}">
                        ${res.priority_score}
                    </span>
                </td>
                <td class="px-6 py-5">${reasonsHtml || '<span class="text-gray-600 italic text-xs">Stale content (tijd)</span>'}</td>
            `;
            resultsBody.appendChild(tr);
        });
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
