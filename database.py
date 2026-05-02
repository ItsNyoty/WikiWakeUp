# -*- coding: utf-8 -*-
import os
import sqlite3
import pymysql
import logging

logger = logging.getLogger(__name__)

def get_db_connection():
    """Returns a database connection. Uses MariaDB on Toolforge, SQLite locally."""
    
    # Check if we are on Toolforge
    # Toolforge usually has replica.my.cnf or we can check environment
    if os.path.exists(os.path.expanduser("~/replica.my.cnf")):
        try:
            # On Toolforge, we can read credentials from replica.my.cnf
            # But for a tool-specific database, we usually have a dedicated user.
            # For now, let's assume we use the tool's database if configured.
            
            db_host = os.environ.get("DB_HOST", "tools.db.svc.wikimedia.cloud")
            db_user = os.environ.get("DB_USER")
            db_pass = os.environ.get("DB_PASS")
            db_name = os.environ.get("DB_NAME")
            
            if db_user and db_pass and db_name:
                return pymysql.connect(
                    host=db_host,
                    user=db_user,
                    password=db_pass,
                    database=db_name,
                    cursorclass=pymysql.cursors.DictCursor
                )
            else:
                # Fallback to local SQLite if environment not set
                logger.warning("DB environment variables not set on Toolforge, falling back to SQLite")
        except Exception as e:
            logger.error(f"Failed to connect to MariaDB: {e}")

    # Default to SQLite for local development or if MariaDB fails
    db_path = os.path.join(os.path.dirname(__file__), "wikiwakeup.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # For MariaDB/SQLite compatibility
    try:
        if isinstance(conn, sqlite3.Connection):
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS analysis_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    total_flagged INTEGER,
                    limit_count INTEGER,
                    top_count INTEGER
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS hidden_articles (
                    username TEXT NOT NULL,
                    article_title TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (username, article_title)
                )
            ''')
        else:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS analysis_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    total_flagged INT,
                    limit_count INT,
                    top_count INT
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS hidden_articles (
                    username VARCHAR(255) NOT NULL,
                    article_title VARCHAR(255) NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (username, article_title)
                )
            ''')
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
    finally:
        conn.close()

def log_analysis(username, total_flagged, limit_count, top_count):
    """Log an analysis run to the database."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO analysis_logs (username, total_flagged, limit_count, top_count) VALUES (%s, %s, %s, %s)" if not isinstance(conn, sqlite3.Connection) else
            "INSERT INTO analysis_logs (username, total_flagged, limit_count, top_count) VALUES (?, ?, ?, ?)",
            (username, total_flagged, limit_count, top_count)
        )
        conn.commit()
    except Exception as e:
        logger.error(f"Failed to log analysis: {e}")
    finally:
        conn.close()


def get_admin_stats():
    """Get summary statistics for the admin dashboard."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        
        # Total analyses
        cursor.execute("SELECT COUNT(*) as total FROM analysis_logs")
        total = cursor.fetchone()
        
        # Unique users
        cursor.execute("SELECT COUNT(DISTINCT username) as unique_users FROM analysis_logs")
        unique = cursor.fetchone()
        
        # Recent logs
        cursor.execute("SELECT * FROM analysis_logs ORDER BY timestamp DESC LIMIT 50")
        recent = cursor.fetchall()
        
        return {
            "total_analyses": total['total'] if isinstance(total, dict) else total[0],
            "unique_users": unique['unique_users'] if isinstance(unique, dict) else unique[0],
            "recent_logs": recent
        }
    except Exception as e:
        logger.error(f"Failed to get admin stats: {e}")
        return None
    finally:
        conn.close()


def hide_article(username, article_title):
    """Mark an article as hidden for a specific user."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT IGNORE INTO hidden_articles (username, article_title) VALUES (%s, %s)" if not isinstance(conn, sqlite3.Connection) else
            "INSERT OR IGNORE INTO hidden_articles (username, article_title) VALUES (?, ?)",
            (username, article_title)
        )
        conn.commit()
    finally:
        conn.close()


def unhide_article(username, article_title):
    """Remove an article from a user's hidden list."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM hidden_articles WHERE username = %s AND article_title = %s" if not isinstance(conn, sqlite3.Connection) else
            "DELETE FROM hidden_articles WHERE username = ? AND article_title = ?",
            (username, article_title)
        )
        conn.commit()
    finally:
        conn.close()


def get_hidden_articles(username):
    """Get all hidden articles for a user."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT article_title FROM hidden_articles WHERE username = %s" if not isinstance(conn, sqlite3.Connection) else
            "SELECT article_title FROM hidden_articles WHERE username = ?",
            (username,)
        )
        rows = cursor.fetchall()
        return [row['article_title'] if isinstance(row, dict) else row[0] for row in rows]
    finally:
        conn.close()
