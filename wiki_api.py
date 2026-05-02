# -*- coding: utf-8 -*-
"""
WikiWakeUp - MediaWiki & Wikidata API interaction module.

Provides functions to fetch user contributions, article metadata,
cross-wiki comparisons, and Wikidata statement checks.
"""

import requests
from datetime import datetime, timedelta, timezone
from dateutil import parser as dateparser
import logging
import time

logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "WikiWakeUp/1.0 (Toolforge; Contact: nyo@wikimedia.be)"
})

NL_API = "https://nl.wikipedia.org/w/api.php"
EN_API = "https://en.wikipedia.org/w/api.php"
DE_API = "https://de.wikipedia.org/w/api.php"
FR_API = "https://fr.wikipedia.org/w/api.php"
ES_API = "https://es.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

# Map of language codes to API URLs and labels
LANG_WIKIS = {
    "en": {"api": EN_API, "label": "EN-wiki"},
    "de": {"api": DE_API, "label": "DE-wiki"},
    "fr": {"api": FR_API, "label": "FR-wiki"},
    "es": {"api": ES_API, "label": "ES-wiki"},
}

# Wikidata properties that indicate date-based changes
DATE_PROPERTIES = {
    # Life events
    "P569": "Geboortedatum (date of birth)",
    "P570": "Overlijdensdatum (date of death)",
    "P26": "Echtgenoot (spouse)",
    # Career & positions
    "P39": "Functie (position held)",
    "P69": "Opleiding (educated at)",
    "P108": "Werkgever (employer)",
    "P54": "Lid van sportteam (member of sports team)",
    "P102": "Politieke partij (political party)",
    "P27": "Land van staatsburgerschap (citizenship)",
    # Awards & recognition
    "P166": "Onderscheiding (award received)",
    "P1344": "Deelname aan evenement (participant in)",
    # Organizations & entities
    "P571": "Oprichtingsdatum (inception)",
    "P576": "Opgeheven (dissolved/abolished)",
    "P1619": "Datum opening (date of official opening)",
    # Time-related
    "P580": "Startdatum (start time)",
    "P582": "Einddatum (end time)",
    "P585": "Tijdstip (point in time)",
    "P577": "Publicatiedatum (publication date)",
    # Work periods
    "P2031": "Werkperiode begin (work period start)",
    "P2032": "Werkperiode einde (work period end)",
    # Significant events
    "P793": "Belangrijke gebeurtenis (significant event)",
    "P1534": "Doodsoorzaak (cause of death)",
    "P509": "Doodsoorzaak (cause of death)",
    "P451": "Partner",
    "P1416": "Affiliatie (affiliation)",
    "P463": "Lid van (member of)",
    "P488": "Voorzitter (chairperson)",
    "P6": "Regeringsleider (head of government)",
    "P35": "Staatshoofd (head of state)",
    # External Links & Media
    "P856": "Officiële website",
    "P1581": "Officiële blog",
    "P2013": "Facebook-identificatiecode",
    "P2002": "X (Twitter) gebruikersnaam",
    "P2003": "Instagram-gebruikersnaam",
    "P1651": "YouTube video-identificatiecode",
    "P727": "WorldCat Identities-identificatiecode",
    # Affiliations & Honors
    "P166": "Onderscheiding ontvangen",
    "P1344": "Deelnemer aan",
    "P6379": "Heeft werk in de collectie",
    # Geography
    "P625": "Geografische coördinaten",
    "P131": "Gelegen in de administratieve eenheid",
    "P2044": "Hoogte boven zeeniveau",
    # Organizational
    "P749": "Moederorganisatie",
    "P355": "Dochterorganisatie",
    "P199": "Gelieerde onderneming",
    "P112": "Oprichter",
    "P169": "Chief Executive Officer",
}


# Global rate limiter: track last request time per domain
_last_request_time = {}
_MIN_REQUEST_INTERVAL = 0.05  # 50ms between requests to same domain


def _rate_limit(url):
    """Enforce a minimum interval between requests to the same domain."""
    from urllib.parse import urlparse
    domain = urlparse(url).netloc
    now = time.monotonic()
    last = _last_request_time.get(domain, 0)
    wait = _MIN_REQUEST_INTERVAL - (now - last)
    if wait > 0:
        time.sleep(wait)
    _last_request_time[domain] = time.monotonic()


def _api_get(url, params, max_retries=5):
    """Make a GET request to a MediaWiki API with retries and rate limiting."""
    params["format"] = "json"
    for attempt in range(max_retries):
        try:
            _rate_limit(url)
            resp = SESSION.get(url, params=params, timeout=30)
            # Handle 429 with exponential backoff
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 2 * (attempt + 1)))
                logger.warning(f"Rate limited (429), waiting {retry_after}s...")
                time.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            logger.warning(f"API request failed (attempt {attempt+1}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))
            else:
                raise
    return {}


def get_user_contributions(username, limit=500):
    """
    Fetch the last `limit` contributions for a user on nlwiki.
    Returns a list of contribution dicts with title, sizediff, timestamp, etc.
    """
    contributions = []
    params = {
        "action": "query",
        "list": "usercontribs",
        "ucuser": username,
        "uclimit": min(limit, 500),
        "ucnamespace": "0",  # Main namespace only
        "ucprop": "title|timestamp|sizediff|size|comment",
        "ucdir": "older",
    }

    while len(contributions) < limit:
        data = _api_get(NL_API, params.copy())
        if "query" not in data or "usercontribs" not in data["query"]:
            break

        contribs = data["query"]["usercontribs"]
        contributions.extend(contribs)

        if "continue" in data and len(contributions) < limit:
            params["uccontinue"] = data["continue"]["uccontinue"]
        else:
            break

    return contributions[:limit]


def aggregate_contributions(contributions):
    """
    Aggregate contributions per article.
    Returns a dict: { title: { total_added, edit_count, last_edit, first_edit } }
    sorted by total_added descending.
    """
    articles = {}
    for c in contributions:
        title = c["title"]
        sizediff = c.get("sizediff", 0)
        timestamp = c["timestamp"]

        if title not in articles:
            articles[title] = {
                "title": title,
                "total_added": 0,
                "edit_count": 0,
                "last_edit": timestamp,
                "first_edit": timestamp,
            }

        # Only count positive contributions for ranking
        if sizediff > 0:
            articles[title]["total_added"] += sizediff
        articles[title]["edit_count"] += 1

        # Track earliest and latest edits
        if timestamp > articles[title]["last_edit"]:
            articles[title]["last_edit"] = timestamp
        if timestamp < articles[title]["first_edit"]:
            articles[title]["first_edit"] = timestamp

    # Sort by total_added descending
    sorted_articles = sorted(
        articles.values(), key=lambda x: x["total_added"], reverse=True
    )
    return sorted_articles


def get_article_last_revision(title, api_url=NL_API):
    """Get the last revision timestamp and size for an article. Returns None if it's a redirect."""
    params = {
        "action": "query",
        "titles": title,
        "prop": "revisions|info",
        "rvprop": "timestamp|size|ids",
        "rvlimit": "1",
    }
    data = _api_get(api_url, params)
    pages = data.get("query", {}).get("pages", {})
    for page_id, page_data in pages.items():
        if page_id == "-1":
            return None
        
        # Skip redirects
        if "redirect" in page_data:
            logger.info(f"Skipping redirect: {title}")
            return None

        revs = page_data.get("revisions", [])
        if revs:
            return {
                "timestamp": revs[0]["timestamp"],
                "size": revs[0]["size"],
                "revid": revs[0]["revid"],
                "title": page_data.get("title", title),
            }
    return None


def get_langlinks(title):
    """Get English, German, French, and Spanish interwiki links for a NL article."""
    params = {
        "action": "query",
        "titles": title,
        "prop": "langlinks",
        "lllang": "en|de|fr|es",
        "lllimit": "20",
    }
    data = _api_get(NL_API, params)
    pages = data.get("query", {}).get("pages", {})
    links = {}
    for page_id, page_data in pages.items():
        for ll in page_data.get("langlinks", []):
            lang = ll["lang"]
            links[lang] = ll["*"]
    return links


def get_article_size_at_date(title, date_str, api_url):
    """
    Get the size of an article at or before a given date.
    Uses rvstart to find the revision closest to that date.
    """
    params = {
        "action": "query",
        "titles": title,
        "prop": "revisions",
        "rvprop": "size|timestamp",
        "rvlimit": "1",
        "rvdir": "older",
        "rvstart": date_str,
    }
    data = _api_get(api_url, params)
    pages = data.get("query", {}).get("pages", {})
    for page_id, page_data in pages.items():
        if page_id == "-1":
            return None
        revs = page_data.get("revisions", [])
        if revs:
            return revs[0]["size"]
    return None


def check_crosswiki_growth(title, nl_last_edit_ts):
    """
    Compare the growth of EN/DE/FR/ES versions vs. NL in the last 6 months.
    Returns a list of reasons if a foreign wiki has grown significantly.
    """
    reasons = []
    langlinks = get_langlinks(title)

    now = datetime.now(timezone.utc)
    six_months_ago = (now - timedelta(days=180)).strftime("%Y-%m-%dT%H:%M:%SZ")

    for lang, foreign_title in langlinks.items():
        wiki_info = LANG_WIKIS.get(lang)
        if not wiki_info:
            continue

        api_url = wiki_info["api"]
        lang_label = wiki_info["label"]

        # Get current size of the foreign article
        foreign_current = get_article_last_revision(foreign_title, api_url)
        if not foreign_current:
            continue

        # Get the size 6 months ago
        foreign_old_size = get_article_size_at_date(
            foreign_title, six_months_ago, api_url
        )

        if foreign_old_size and foreign_old_size > 0:
            current_size = foreign_current["size"]
            growth = (current_size - foreign_old_size) / foreign_old_size

            if growth >= 0.20:
                # Check if NL has been stale (no edit since 6 months)
                nl_edit_dt = dateparser.parse(nl_last_edit_ts)
                six_months_ago_dt = now - timedelta(days=180)

                if nl_edit_dt < six_months_ago_dt:
                    growth_pct = round(growth * 100)
                    reasons.append({
                        "type": "crosswiki",
                        "lang": lang_label,
                        "message": f"{lang_label} is {growth_pct}% gegroeid in 6 maanden, NL-artikel stilgevallen",
                        "growth_pct": growth_pct,
                        "foreign_title": foreign_title,
                    })

    return reasons


def get_wikidata_entity_id(title):
    """Get the Wikidata entity ID for a NL Wikipedia article."""
    params = {
        "action": "query",
        "titles": title,
        "prop": "pageprops",
        "ppprop": "wikibase_item",
    }
    data = _api_get(NL_API, params)
    pages = data.get("query", {}).get("pages", {})
    for page_id, page_data in pages.items():
        return page_data.get("pageprops", {}).get("wikibase_item")
    return None


def check_wikidata_updates(title, nl_last_edit_ts):
    """
    Check if Wikidata has newer date-based statements than the NL article's
    last edit. E.g., if P570 (death date) was added after the NL article
    was last edited.
    """
    reasons = []
    entity_id = get_wikidata_entity_id(title)
    if not entity_id:
        # Flag as "no Wikidata item linked"
        reasons.append({
            "type": "nowikidata",
            "property": "",
            "message": "Geen Wikidata-item gekoppeld",
            "date": "",
            "entity_id": "",
        })
        return reasons

    params = {
        "action": "wbgetentities",
        "ids": entity_id,
        "props": "claims",
        "languages": "nl|en",
    }
    data = _api_get(WIKIDATA_API, params)
    entities = data.get("entities", {})
    entity = entities.get(entity_id, {})
    claims = entity.get("claims", {})

    nl_edit_dt = dateparser.parse(nl_last_edit_ts)

    for prop_id, prop_label in DATE_PROPERTIES.items():
        if prop_id not in claims:
            continue

        for claim in claims[prop_id]:
            mainsnak = claim.get("mainsnak", {})
            datavalue = mainsnak.get("datavalue", {})

            # Check the time value in the claim
            if datavalue.get("type") == "time":
                time_val = datavalue.get("value", {}).get("time", "")
                try:
                    # Wikidata time format: +2024-01-15T00:00:00Z
                    clean_time = time_val.lstrip("+-")
                    claim_dt = dateparser.parse(clean_time)
                    if claim_dt.tzinfo is None:
                        claim_dt = claim_dt.replace(tzinfo=timezone.utc)
                    nl_edit_aware = nl_edit_dt if nl_edit_dt.tzinfo else nl_edit_dt.replace(tzinfo=timezone.utc)

                    if claim_dt > nl_edit_aware:
                        reasons.append({
                            "type": "wikidata",
                            "property": prop_id,
                            "message": f"Wikidata: {prop_label} bijgewerkt ({clean_time[:10]})",
                            "date": clean_time[:10],
                            "entity_id": entity_id,
                        })
                except (ValueError, TypeError):
                    pass

            # Also check qualifiers for end dates (e.g., P39 with P582 end time)
            qualifiers = claim.get("qualifiers", {})
            if "P582" in qualifiers:  # P582 = end time
                for qual in qualifiers["P582"]:
                    qual_dv = qual.get("datavalue", {})
                    if qual_dv.get("type") == "time":
                        time_val = qual_dv.get("value", {}).get("time", "")
                        try:
                            clean_time = time_val.lstrip("+-")
                            qual_dt = dateparser.parse(clean_time)
                            if qual_dt.tzinfo is None:
                                qual_dt = qual_dt.replace(tzinfo=timezone.utc)
                            nl_edit_aware = nl_edit_dt if nl_edit_dt.tzinfo else nl_edit_dt.replace(tzinfo=timezone.utc)

                            if qual_dt > nl_edit_aware:
                                reasons.append({
                                    "type": "wikidata",
                                    "property": prop_id,
                                    "message": f"Wikidata: {prop_label} — einde functie/status ({clean_time[:10]})",
                                    "date": clean_time[:10],
                                    "entity_id": entity_id,
                                })
                        except (ValueError, TypeError):
                            pass

    # Deduplicate reasons
    seen = set()
    unique_reasons = []
    for r in reasons:
        key = (r["property"], r.get("date", ""))
        if key not in seen:
            seen.add(key)
            unique_reasons.append(r)

    return unique_reasons
