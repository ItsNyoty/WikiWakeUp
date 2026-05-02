# -*- coding: utf-8 -*-
#
# WikiWakeUp - Identify Wikipedia articles that need updating.
#
# Copyright (C) 2026 WikiWakeUp Contributors
#
# This program is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the Free
# Software Foundation, either version 3 of the License, or (at your option)
# any later version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
# FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
# more details.
#
# You should have received a copy of the GNU General Public License along
# with this program.  If not, see <http://www.gnu.org/licenses/>.

import flask
import os
import json
import logging
import yaml
from werkzeug.middleware.proxy_fix import ProxyFix
from requests_oauthlib import OAuth2Session
from analyzer import analyze_user
from database import init_db, log_analysis, get_admin_stats
import threading
import uuid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize database
init_db()

app = flask.Flask(__name__)

# Background task storage
# In a production environment with multiple workers, this should be in Redis/DB.
# On Toolforge with a single worker or shared memory, this works for simple cases.
analysis_jobs = {}

# --- Configuration ---
# Use ProxyFix to handle HTTPS behind Toolforge proxy
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Persistent Secret key for Flask sessions
# We try to load it from a file so it stays the same across restarts
secret_key_path = os.path.expanduser("~/secret.key")
if os.path.exists(secret_key_path):
    with open(secret_key_path, "rb") as f:
        app.secret_key = f.read()
else:
    new_key = os.urandom(32)
    app.secret_key = new_key
    try:
        with open(secret_key_path, "wb") as f:
            f.write(new_key)
        os.chmod(secret_key_path, 0o600)
    except Exception as e:
        logger.warning(f"Could not save secret key to {secret_key_path}: {e}")

# Allow HTTP for local development (OAuth2 requires HTTPS in production)
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = os.environ.get("OAUTHLIB_INSECURE_TRANSPORT", "1")

# OAuth 2.0 configuration
OAUTH_ENABLED = False
CLIENT_ID = ""
CLIENT_SECRET = ""

# MediaWiki OAuth 2.0 endpoints (Meta-Wiki)
MW_AUTHORIZE_URL = "https://meta.wikimedia.org/w/rest.php/oauth2/authorize"
MW_TOKEN_URL = "https://meta.wikimedia.org/w/rest.php/oauth2/access_token"
MW_PROFILE_URL = "https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile"

# Callback URL — auto-detected or configured
CALLBACK_URL = os.environ.get("OAUTH_CALLBACK_URL", "")

# Load config from YAML
config_paths = [
    os.path.expanduser("~/oauth_config.yaml"),
    os.path.join(os.path.dirname(__file__), "oauth_config.yaml"),
]

for config_path in config_paths:
    if os.path.exists(config_path):
        try:
            with open(config_path) as f:
                config = yaml.safe_load(f)
            CLIENT_ID = config.get("client_id", "")
            CLIENT_SECRET = config.get("client_secret", "")
            CALLBACK_URL = config.get("callback_url", CALLBACK_URL)
            if CLIENT_ID and CLIENT_SECRET:
                OAUTH_ENABLED = True
                logger.info(f"OAuth 2.0 config loaded from {config_path}")
            break
        except Exception as e:
            logger.warning(f"Failed to load config from {config_path}: {e}")

# Also check environment variables
if not OAUTH_ENABLED:
    CLIENT_ID = os.environ.get("OAUTH_CLIENT_ID", "")
    CLIENT_SECRET = os.environ.get("OAUTH_CLIENT_SECRET", "")
    if CLIENT_ID and CLIENT_SECRET:
        OAUTH_ENABLED = True
        logger.info("OAuth 2.0 config loaded from environment variables")

if not OAUTH_ENABLED:
    logger.info("OAuth not configured — running in manual username mode")


# --- OAuth 2.0 helpers ---

def get_callback_url():
    """Get the OAuth callback URL, auto-detecting from request if not configured."""
    if CALLBACK_URL:
        return CALLBACK_URL
    return flask.url_for("oauth_callback", _external=True)


def create_oauth_session(state=None, token=None):
    """Create an OAuth2Session for MediaWiki."""
    return OAuth2Session(
        CLIENT_ID,
        redirect_uri=get_callback_url(),
        state=state,
        token=token,
    )


def get_current_user():
    """Get the currently logged-in username from the session."""
    return flask.session.get("username")


# --- Routes ---

@app.route("/")
def index():
    """Serve the main page."""
    user = get_current_user()
    return flask.render_template(
        "index.html",
        oauth_enabled=OAUTH_ENABLED,
        logged_in=user is not None,
        username=user,
    )


@app.route("/login")
def login():
    """Initiate OAuth 2.0 login with MediaWiki."""
    if not OAUTH_ENABLED:
        return flask.redirect(flask.url_for("index"))

    try:
        oauth = create_oauth_session()
        authorization_url, state = oauth.authorization_url(MW_AUTHORIZE_URL)

        # Store state in session for CSRF protection
        flask.session["oauth_state"] = state

        logger.info(f"Redirecting to OAuth authorization: {authorization_url}")
        return flask.redirect(authorization_url)
    except Exception as e:
        logger.error(f"OAuth initiate failed: {e}", exc_info=True)
        return flask.redirect(flask.url_for("index"))


@app.route("/oauth-callback")
def oauth_callback():
    """Handle OAuth 2.0 callback from MediaWiki."""
    if not OAUTH_ENABLED:
        return flask.redirect(flask.url_for("index"))

    try:
        oauth = create_oauth_session(state=flask.session.get("oauth_state"))

        # Exchange authorization code for access token
        token = oauth.fetch_token(
            MW_TOKEN_URL,
            client_secret=CLIENT_SECRET,
            authorization_response=flask.request.url,
        )

        flask.session["oauth_token"] = token
        flask.session.pop("oauth_state", None)

        # Fetch user profile
        oauth_with_token = create_oauth_session(token=token)
        profile_resp = oauth_with_token.get(MW_PROFILE_URL)

        if profile_resp.ok:
            profile = profile_resp.json()
            flask.session["username"] = profile.get("username", "Unknown")
            logger.info(f"User logged in: {flask.session['username']}")
        else:
            # Fallback: try the Action API
            logger.warning(f"Profile endpoint returned {profile_resp.status_code}, trying Action API")
            userinfo_resp = oauth_with_token.get(
                "https://meta.wikimedia.org/w/api.php",
                params={"action": "query", "meta": "userinfo", "format": "json"},
            )
            if userinfo_resp.ok:
                data = userinfo_resp.json()
                username = data.get("query", {}).get("userinfo", {}).get("name", "Unknown")
                flask.session["username"] = username
                logger.info(f"User logged in (via userinfo): {username}")

        return flask.redirect(flask.url_for("index"))

    except Exception as e:
        logger.error(f"OAuth callback failed: {e}", exc_info=True)
        return flask.redirect(flask.url_for("index"))


@app.route("/logout")
def logout():
    """Log out by clearing the session."""
    username = flask.session.get("username", "unknown")
    flask.session.clear()
    logger.info(f"User logged out: {username}")
    return flask.redirect(flask.url_for("index"))


@app.route("/admin")
def admin():
    """Admin dashboard for specific users."""
    user = get_current_user()
    if user != "ItsNyoty":
        return "Toegang geweigerd.", 403
    
    stats = get_admin_stats()
    return flask.render_template("admin.html", stats=stats)


@app.route("/api/analyze")
def api_analyze():
    """
    API endpoint to analyze a user's contributions.

    If OAuth is enabled and user is logged in, automatically uses their username.
    Otherwise, requires a 'user' query parameter.

    Query params:
        user: Wikipedia username (required if not logged in)
        limit: Max contributions to fetch (default 2500, max 5000)
        top: Number of top articles to analyze (default 100, max 200)
    """
    # Determine which username to analyze
    if OAUTH_ENABLED and get_current_user():
        username = get_current_user()
    else:
        username = flask.request.args.get("user", "").strip()

    if not username:
        return flask.jsonify({"error": "Geen gebruikersnaam opgegeven. Log in of vul een naam in."}), 400

    try:
        limit = min(int(flask.request.args.get("limit", 2500)), 100000)
    except (ValueError, TypeError):
        limit = 2500

    try:
        top = min(int(flask.request.args.get("top", 100)), 1000)
    except (ValueError, TypeError):
        top = 100

    job_id = str(uuid.uuid4())
    analysis_jobs[job_id] = {"status": "pending", "progress": 0, "message": "Wachten in wachtrij..."}

    def run_analysis_task(jid, uname, lmt, tp):
        try:
            def progress_update(step, total_steps, msg):
                analysis_jobs[jid]["progress"] = int((step / total_steps) * 100)
                analysis_jobs[jid]["message"] = msg

            analysis_jobs[jid]["status"] = "running"
            results = analyze_user(uname, max_contribs=lmt, top_n=tp, progress_callback=progress_update)
            
            # Log to database
            try:
                log_analysis(uname, len(results), lmt, tp)
            except Exception as db_e:
                logger.warning(f"Failed to log to DB: {db_e}")

            analysis_jobs[jid]["status"] = "completed"
            analysis_jobs[jid]["results"] = results
            analysis_jobs[jid]["progress"] = 100
        except Exception as e:
            logger.error(f"Job {jid} failed: {e}", exc_info=True)
            analysis_jobs[jid]["status"] = "failed"
            analysis_jobs[jid]["error"] = str(e)

    thread = threading.Thread(target=run_analysis_task, args=(job_id, username, limit, top))
    thread.start()

    return flask.jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def api_status(job_id):
    """Check the status of a background analysis job."""
    job = analysis_jobs.get(job_id)
    if not job:
        return flask.jsonify({"error": "Taak niet gevonden"}), 404
    
    return flask.jsonify(job)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
