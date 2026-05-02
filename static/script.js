/**
 * WikiWakeUp — Frontend Logic
 * Handles form submission, API calls, loading states, and result rendering.
 */

(function () {
    'use strict';

    // --- DOM Elements ---
    const form = document.getElementById('analyzeForm');
    const usernameInput = document.getElementById('usernameInput'); // null when OAuth logged in
    const submitBtn = document.getElementById('submitBtn');
    const limitSelect = document.getElementById('limitSelect');
    const topSelect = document.getElementById('topSelect');

    // --- Config from server ---
    const config = window.WIKI_CONFIG || {};

    const searchSection = document.getElementById('searchSection');
    const loadingSection = document.getElementById('loadingSection');
    const errorSection = document.getElementById('errorSection');
    const resultsSection = document.getElementById('resultsSection');

    const loadingTitle = document.getElementById('loadingTitle');
    const loadingMessage = document.getElementById('loadingMessage');
    const loadingBarFill = document.getElementById('loadingBarFill');

    const errorMessage = document.getElementById('errorMessage');
    const retryBtn = document.getElementById('retryBtn');

    const resultsTitle = document.getElementById('resultsTitle');
    const resultsSubtitle = document.getElementById('resultsSubtitle');
    const resultsBody = document.getElementById('resultsBody');
    const emptyState = document.getElementById('emptyState');
    const tableWrapper = document.getElementById('tableWrapper');

    const sortPriorityBtn = document.getElementById('sortPriority');
    const sortDateBtn = document.getElementById('sortDate');
    const newSearchBtn = document.getElementById('newSearchBtn');

    let currentResults = [];
    let loadingInterval = null;

    // --- Completion Sound (Web Audio API) ---
    function playCompletionSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const now = ctx.currentTime;

            // Pleasant two-tone chime
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + i * 0.15);
                gain.gain.linearRampToValueAtTime(0.15, now + i * 0.15 + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
                osc.start(now + i * 0.15);
                osc.stop(now + i * 0.15 + 0.45);
            });
        } catch (e) {
            // Audio not supported, silently ignore
        }
    }

    function playErrorSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.value = 220;
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        } catch (e) {
            // Audio not supported, silently ignore
        }
    }

    // --- Section Visibility ---
    function showSection(section) {
        [searchSection, loadingSection, errorSection, resultsSection].forEach(s => {
            s.classList.add('hidden');
        });
        section.classList.remove('hidden');
    }

    // --- Loading Animation ---
    const loadingMessages = [
        'Bijdragen ophalen van de Wikipedia API...',
        'Artikelen identificeren met groot aandeel...',
        'Taalversies vergelijken (EN, DE)...',
        'Wikidata statements controleren...',
        'Groei op andere wiki\'s berekenen...',
        'Prioriteitsscores berekenen...',
        'Resultaten sorteren...',
    ];

    function startLoadingAnimation() {
        let step = 0;
        let progress = 0;
        loadingBarFill.style.width = '0%';

        loadingInterval = setInterval(() => {
            step = Math.min(step + 1, loadingMessages.length - 1);
            loadingMessage.textContent = loadingMessages[step];

            progress = Math.min(progress + Math.random() * 12 + 3, 90);
            loadingBarFill.style.width = progress + '%';
        }, 3000);
    }

    function stopLoadingAnimation() {
        if (loadingInterval) {
            clearInterval(loadingInterval);
            loadingInterval = null;
        }
        loadingBarFill.style.width = '100%';
    }

    // --- Format Date ---
    function formatDate(isoString) {
        const d = new Date(isoString);
        return d.toLocaleDateString('nl-NL', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    }

    // --- Days Badge ---
    function getDaysBadgeClass(days) {
        if (days < 180) return 'green';
        if (days < 365) return 'amber';
        return 'red';
    }

    // --- Score Color ---
    function getScoreGradient(score, maxScore) {
        const ratio = Math.min(score / Math.max(maxScore, 1), 1);
        if (ratio < 0.4) return '#34d399';
        if (ratio < 0.7) return '#fbbf24';
        return '#f87171';
    }

    // --- Render Results ---
    function renderResults(articles, username) {
        resultsBody.innerHTML = '';

        if (!articles || articles.length === 0) {
            emptyState.classList.remove('hidden');
            tableWrapper.classList.add('hidden');
            resultsTitle.textContent = `Resultaten voor ${username}`;
            resultsSubtitle.textContent = 'Geen artikelen gevonden die een update nodig hebben.';
            return;
        }

        emptyState.classList.add('hidden');
        tableWrapper.classList.remove('hidden');

        resultsTitle.textContent = `Resultaten voor ${username}`;
        resultsSubtitle.textContent = `${articles.length} artikel${articles.length !== 1 ? 'en' : ''} gemarkeerd voor mogelijke update`;

        const maxScore = Math.max(...articles.map(a => a.priority_score), 1);

        articles.forEach((article, index) => {
            const tr = document.createElement('tr');
            tr.className = 'animate-fadeInRow';
            tr.style.animationDelay = `${index * 0.04}s`;

            // Rank
            const tdRank = document.createElement('td');
            tdRank.className = 'px-4 py-3 text-center text-xs font-bold text-gray-500';
            tdRank.textContent = index + 1;
            tr.appendChild(tdRank);

            // Article name
            const tdArticle = document.createElement('td');
            tdArticle.className = 'px-4 py-3';
            const link = document.createElement('a');
            link.href = `https://nl.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
            link.target = '_blank';
            link.rel = 'noopener';
            link.className = 'text-blue-400 hover:text-purple-400 font-medium transition-colors duration-150 no-underline hover:underline';
            link.textContent = article.title;
            tdArticle.appendChild(link);
            tr.appendChild(tdArticle);

            // Last edit date
            const tdDate = document.createElement('td');
            tdDate.className = 'px-4 py-3 text-gray-400 text-xs whitespace-nowrap';
            tdDate.textContent = formatDate(article.last_edit_nl);
            tr.appendChild(tdDate);

            // Days since edit
            const tdDays = document.createElement('td');
            tdDays.className = 'px-4 py-3 hidden sm:table-cell';
            const daysBadge = document.createElement('span');
            daysBadge.className = `days-badge ${getDaysBadgeClass(article.days_since_edit)}`;
            daysBadge.textContent = `${article.days_since_edit}d`;
            tdDays.appendChild(daysBadge);
            tr.appendChild(tdDays);

            // Score
            const tdScore = document.createElement('td');
            tdScore.className = 'px-4 py-3 hidden md:table-cell';
            const scoreWrapper = document.createElement('div');
            scoreWrapper.className = 'flex items-center gap-2';

            const scoreBar = document.createElement('div');
            scoreBar.className = 'score-bar-bg flex-1 bg-gray-800 min-w-[40px]';
            const scoreFill = document.createElement('div');
            scoreFill.className = 'score-bar-fill';
            const pct = (article.priority_score / maxScore) * 100;
            scoreFill.style.background = getScoreGradient(article.priority_score, maxScore);
            setTimeout(() => { scoreFill.style.width = pct + '%'; }, index * 40 + 100);
            scoreBar.appendChild(scoreFill);

            const scoreVal = document.createElement('span');
            scoreVal.className = 'text-xs font-semibold text-gray-400 min-w-[28px] text-right';
            scoreVal.textContent = article.priority_score;

            scoreWrapper.appendChild(scoreBar);
            scoreWrapper.appendChild(scoreVal);
            tdScore.appendChild(scoreWrapper);
            tr.appendChild(tdScore);

            // Reasons
            const tdReason = document.createElement('td');
            tdReason.className = 'px-4 py-3';
            if (article.reasons && article.reasons.length > 0) {
                article.reasons.forEach(r => {
                    const tag = document.createElement('span');
                    tag.className = `reason-tag ${r.type}`;
                    tag.textContent = r.message;
                    tag.title = r.message;
                    tdReason.appendChild(tag);
                });
            }
            // Add stale tag if > 180 days and no other substantive reason
            const hasSubstantiveReason = article.reasons && article.reasons.some(r => r.type !== 'nowikidata');
            if (article.days_since_edit > 180 && !hasSubstantiveReason) {
                const tag = document.createElement('span');
                tag.className = 'reason-tag stale';
                if (article.days_since_edit > 365) {
                    const years = Math.floor(article.days_since_edit / 365);
                    tag.textContent = `Niet bewerkt in ${years}+ jaar`;
                } else {
                    tag.textContent = `${article.days_since_edit} dagen niet bewerkt`;
                }
                tdReason.appendChild(tag);
            }
            tr.appendChild(tdReason);

            resultsBody.appendChild(tr);
        });
    }

    // --- Sort ---
    function sortResults(by) {
        if (by === 'priority') {
            currentResults.sort((a, b) => b.priority_score - a.priority_score);
            sortPriorityBtn.classList.add('active');
            sortDateBtn.classList.remove('active');
        } else if (by === 'date') {
            currentResults.sort((a, b) => b.days_since_edit - a.days_since_edit);
            sortDateBtn.classList.add('active');
            sortPriorityBtn.classList.remove('active');
        }
        renderResults(currentResults, resultsTitle.textContent.replace('Resultaten voor ', ''));
    }

    // --- API Call ---
    async function analyzeUser(username, limit, top) {
        showSection(loadingSection);
        startLoadingAnimation();

        try {
            const params = new URLSearchParams({ limit, top });
            // Only add user param if not OAuth-logged-in (server auto-detects)
            if (username) {
                params.set('user', username);
            }
            const response = await fetch(`/api/analyze?${params}`);
            const data = await response.json();

            stopLoadingAnimation();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            currentResults = data.articles || [];
            showSection(resultsSection);
            renderResults(currentResults, data.username);
            playCompletionSound();

        } catch (error) {
            stopLoadingAnimation();
            showSection(errorSection);
            errorMessage.textContent = error.message || 'Onbekende fout opgetreden.';
            playErrorSound();
        }
    }

    // --- Event Listeners ---
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        let username = '';
        if (config.loggedIn && config.username) {
            username = ''; // Server will use session username
        } else if (usernameInput) {
            username = usernameInput.value.trim();
            if (!username) return;
        }
        const limit = limitSelect.value;
        const top = topSelect.value;
        analyzeUser(username, limit, top);
    });

    retryBtn.addEventListener('click', function () {
        showSection(searchSection);
        if (usernameInput) usernameInput.focus();
    });

    newSearchBtn.addEventListener('click', function () {
        showSection(searchSection);
        if (usernameInput) {
            usernameInput.value = '';
            usernameInput.focus();
        }
    });

    sortPriorityBtn.addEventListener('click', () => sortResults('priority'));
    sortDateBtn.addEventListener('click', () => sortResults('date'));

    // --- Focus on load ---
    if (usernameInput) usernameInput.focus();

})();
