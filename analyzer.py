# -*- coding: utf-8 -*-
"""
WikiWakeUp - Analyzer module.

Orchestrates the analysis of a Wikipedia user's contributions,
cross-wiki checks, and Wikidata synchronization to produce
a prioritized list of articles that may need updating.
"""

import logging
from datetime import datetime, timezone
from dateutil import parser as dateparser
from concurrent.futures import ThreadPoolExecutor, as_completed
from wiki_api import (
    get_user_contributions,
    aggregate_contributions,
    get_article_last_revision,
    check_crosswiki_growth,
    check_wikidata_updates,
)
from database import get_hidden_articles

logger = logging.getLogger(__name__)


def analyze_article(article, target_domain="nl.wikipedia.org", compare_langs=None, report_func=None):
    """Deep analysis for a single article."""
    title = article["title"]
    try:
        # Get target article's last revision info
        nl_rev = get_article_last_revision(title, domain=target_domain)
        if not nl_rev:
            return None

        nl_last_edit = nl_rev["timestamp"]
        nl_edit_dt = dateparser.parse(nl_last_edit)
        if nl_edit_dt.tzinfo is None:
            nl_edit_dt = nl_edit_dt.replace(tzinfo=timezone.utc)

        now = datetime.now(timezone.utc)
        days_since = (now - nl_edit_dt).days

        reasons = []

        # Cross-wiki growth check
        try:
            crosswiki_reasons = check_crosswiki_growth(title, nl_last_edit, source_domain=target_domain, compare_langs=compare_langs)
            reasons.extend(crosswiki_reasons)
        except Exception as e:
            logger.warning(f"Cross-wiki check failed for {title}: {e}")

        # Wikidata sync check
        try:
            wikidata_reasons = check_wikidata_updates(title, nl_last_edit, domain=target_domain)
            reasons.extend(wikidata_reasons)
        except Exception as e:
            logger.warning(f"Wikidata check failed for {title}: {e}")

        # Calculate priority score with breakdown
        score_data = calculate_priority(days_since, reasons)

        return {
            "title": title,
            "last_edit_nl": nl_last_edit,
            "days_since_edit": days_since,
            "total_added_by_user": article["total_added"],
            "user_edit_count": article["edit_count"],
            "current_size": nl_rev["size"],
            "reasons": reasons,
            "priority_score": score_data["total"],
            "score_breakdown": score_data["breakdown"]
        }
    except Exception as e:
        logger.error(f"Error analyzing {title}: {e}")
        return None


def analyze_user(username, max_contribs=2500, top_n=100, target_wiki="nl.wikipedia.org", compare_langs=None, progress_callback=None):
    """
    Full analysis pipeline for a Wikipedia user.
    """
    if compare_langs is None:
        compare_langs = ["en", "de", "fr", "es"]

    target_domain = target_wiki
    if not target_domain.endswith(".wikipedia.org"):
        target_domain = f"{target_wiki}.wikipedia.org"

    def report(step, total, msg):
        if progress_callback:
            progress_callback(step, total, msg)
        logger.info(f"[{step}/{total}] {msg}")

    # Step 1: Fetch user contributions
    report(1, 4, f"Bijdragen ophalen van {username} op {target_domain}...")
    contributions = get_user_contributions(username, limit=max_contribs, domain=target_domain)
    if not contributions:
        return []

    # Step 2: Aggregate and pick top articles
    report(2, 4, "Artikelen analyseren...")
    aggregated = aggregate_contributions(contributions)
    
    # Filter out hidden articles
    hidden = get_hidden_articles(username)
    if hidden:
        report(2, 4, f"Filteren: {len(hidden)} verborgen artikelen overslaan...")
        aggregated = [a for a in aggregated if a["title"] not in hidden]

    top_articles = aggregated[:top_n]

    # Step 3: Deep analysis for each article (Parallelized)
    results = []
    total_articles = len(top_articles)
    
    report(3, 4, f"Deep analysis van {total_articles} artikelen...")

    # Use ThreadPoolExecutor to speed up API-bound tasks
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(analyze_article, art, target_domain=target_domain, compare_langs=compare_langs): art for art in top_articles}
        for i, future in enumerate(as_completed(futures)):
            res = future.result()
            if res:
                results.append(res)
            report(3, 4, f"Geanalyseerd: {i+1}/{total_articles} artikelen...")

    # Step 4: Sort by priority score
    report(4, 4, "Resultaten sorteren...")
    results.sort(key=lambda x: x["priority_score"], reverse=True)

    # Only return articles that have at least one reason or are stale (6+ months)
    flagged = [r for r in results if r["reasons"] or r["days_since_edit"] > 180]

    return flagged


def calculate_priority(days_since_edit, reasons):
    """
    Calculate a priority score with breakdown.
    """
    import math
    
    breakdown = {
        "staleness": 0.0,
        "wikidata": 0.0,
        "crosswiki": 0.0,
        "nowikidata": 0.0
    }

    # Time factor: logarithmic scaling, max ~40 points
    if days_since_edit > 0:
        time_score = min(40, math.log2(days_since_edit + 1) * 4)
        breakdown["staleness"] = round(time_score, 1)

    # Reason factors
    for reason in reasons:
        # Ensure msg is never undefined/missing
        if "msg" not in reason:
            reason["msg"] = f"Update gedetecteerd ({reason.get('type', 'onbekend')})"

        if reason["type"] == "wikidata":
            points = 30
            breakdown["wikidata"] += points
            reason["points"] = points
        elif reason["type"] == "crosswiki":
            growth = reason.get("growth_pct", 20)
            points = min(30, 15 + growth * 0.15)
            breakdown["crosswiki"] += points
            reason["points"] = round(points, 1)
        elif reason["type"] == "nowikidata":
            points = 15
            breakdown["nowikidata"] += points
            reason["points"] = points

    total = sum(breakdown.values())
    return {
        "total": round(total, 1),
        "breakdown": breakdown
    }
