import base64
import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import StudyServiceConfig
from .study_models import (
    CompletionCodeVerifyResponse,
    StudyCompleteResponse,
    StudyEventBatchResponse,
    StudyEventInput,
    StudyLaunchRequest,
    StudyResponseInput,
    StudySessionResponse,
)


BACKEND_DIR = Path(__file__).resolve().parents[1]
COMPLETION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class StudyCapacityError(RuntimeError):
    """Raised when every configured experimental cell is full."""


class InvalidStudyTokenError(RuntimeError):
    """Raised when a request does not identify an active study session."""


class StudyValidationError(RuntimeError):
    """Raised when a transition or completion request is incomplete."""


class StudyService:
    """SQLite-backed assignment and experiment-data service.

    Every mutating method uses a fresh connection and a database-level
    ``BEGIN IMMEDIATE`` transaction. This lets multiple ASGI workers coordinate
    cell allocation without relying on a process-local Python lock.
    """

    def __init__(
        self,
        config: StudyServiceConfig,
        database_path: Path | None = None,
        token_secret: bytes | None = None,
    ):
        self.config = config
        configured_path = Path(os.getenv("VEP_STUDY_DB_PATH", config.database_path))
        self.database_path = database_path or (
            configured_path if configured_path.is_absolute() else BACKEND_DIR / configured_path
        )
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.token_secret = token_secret or self._load_or_create_secret()
        self._initialize_database()

    def launch(self, request: StudyLaunchRequest) -> StudySessionResponse:
        """Return an existing assignment or atomically allocate a balanced cell."""

        identity = f"entry:{request.entry_token}" if request.entry_token else f"client:{request.client_nonce}"
        session_token = self._derive_session_token(identity)
        token_hash = _sha256(session_token)
        # A referral token identifies one questionnaire entry. The browser
        # nonce is folded in only when no referral exists, allowing a shared
        # laboratory browser to run multiple independently linked sessions.
        nonce_identity = (
            f"{request.client_nonce}:{request.entry_token}"
            if request.entry_token
            else request.client_nonce
        )
        nonce_hash = _sha256(nonce_identity)
        entry_hash = _sha256(request.entry_token) if request.entry_token else None
        now = _utc_now()

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if entry_hash:
                existing = connection.execute(
                    "SELECT * FROM study_sessions WHERE entry_token_hash = ?",
                    (entry_hash,),
                ).fetchone()
            else:
                existing = connection.execute(
                    "SELECT * FROM study_sessions WHERE client_nonce_hash = ?",
                    (nonce_hash,),
                ).fetchone()
            if existing:
                connection.commit()
                return self._session_response(existing, session_token=session_token)

            cell = self._choose_balanced_cell(connection)
            if cell is None:
                connection.rollback()
                raise StudyCapacityError("All configured study cells have reached capacity")

            profile, condition = cell
            session_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO study_sessions (
                    session_id, client_nonce_hash, entry_token_hash, session_token_hash,
                    profile, disclosure_condition, language, status, phase,
                    question_config_version, assigned_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'assignment_locked', ?, ?)
                """,
                (
                    session_id,
                    nonce_hash,
                    entry_hash,
                    token_hash,
                    profile,
                    condition,
                    request.language,
                    self.config.question_config_version,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM study_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            connection.commit()
        return self._session_response(row, session_token=session_token)

    def get_session(self, session_token: str) -> StudySessionResponse:
        with self._connect() as connection:
            row = self._require_session(connection, session_token)
        return self._session_response(row)

    def confirm_start(self, session_token: str) -> StudySessionResponse:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = self._require_session(connection, session_token)
            if row["status"] != "active":
                connection.rollback()
                raise StudyValidationError("Only active sessions can be started")
            connection.execute(
                """
                UPDATE study_sessions
                SET started_at = COALESCE(started_at, ?), phase = 'attention_prompt_3s'
                WHERE session_id = ?
                """,
                (now, row["session_id"]),
            )
            updated = connection.execute(
                "SELECT * FROM study_sessions WHERE session_id = ?",
                (row["session_id"],),
            ).fetchone()
            connection.commit()
        return self._session_response(updated)

    def update_phase(self, session_token: str, phase: str) -> StudySessionResponse:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = self._require_session(connection, session_token)
            if row["status"] != "active":
                connection.rollback()
                raise StudyValidationError("Completed sessions cannot change phase")
            connection.execute(
                "UPDATE study_sessions SET phase = ? WHERE session_id = ?",
                (phase, row["session_id"]),
            )
            updated = connection.execute(
                "SELECT * FROM study_sessions WHERE session_id = ?",
                (row["session_id"],),
            ).fetchone()
            connection.commit()
        return self._session_response(updated)

    def append_events(
        self,
        session_token: str,
        events: list[StudyEventInput],
    ) -> StudyEventBatchResponse:
        if len(events) > self.config.event_batch_limit:
            raise StudyValidationError(
                f"Event batch exceeds configured limit of {self.config.event_batch_limit}"
            )

        accepted = 0
        now = _utc_now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            session = self._require_session(connection, session_token)
            for event in events:
                cursor = connection.execute(
                    """
                    INSERT OR IGNORE INTO study_events (
                        session_id, event_id, seq, event_type, phase, payload_json,
                        client_timestamp, server_timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session["session_id"],
                        event.event_id,
                        event.seq,
                        event.event_type,
                        event.phase,
                        json.dumps(event.payload, ensure_ascii=False, separators=(",", ":")),
                        event.client_timestamp,
                        now,
                    ),
                )
                accepted += max(cursor.rowcount, 0)
            last_seq = connection.execute(
                "SELECT COALESCE(MAX(seq), -1) FROM study_events WHERE session_id = ?",
                (session["session_id"],),
            ).fetchone()[0]
            connection.commit()
        return StudyEventBatchResponse(
            accepted=accepted,
            duplicates=len(events) - accepted,
            last_seq=last_seq,
        )

    def save_responses(
        self,
        session_token: str,
        responses: list[StudyResponseInput],
    ) -> int:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            session = self._require_session(connection, session_token)
            for response in responses:
                connection.execute(
                    """
                    INSERT INTO study_responses (
                        session_id, phase, question_id, response_json,
                        response_time_ms, q2_asked, skip_reason, submitted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id, phase, question_id) DO UPDATE SET
                        response_json = excluded.response_json,
                        response_time_ms = excluded.response_time_ms,
                        q2_asked = excluded.q2_asked,
                        skip_reason = excluded.skip_reason,
                        submitted_at = excluded.submitted_at
                    """,
                    (
                        session["session_id"],
                        response.phase,
                        response.question_id,
                        json.dumps(response.response_value, ensure_ascii=False),
                        response.response_time_ms,
                        None if response.q2_asked is None else int(response.q2_asked),
                        response.skip_reason,
                        now,
                    ),
                )
            connection.commit()
        return len(responses)

    def complete(self, session_token: str) -> StudyCompleteResponse:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            session = self._require_session(connection, session_token)
            if session["status"] == "completed" and session["completion_code"]:
                connection.commit()
                return self._complete_response(session)

            observed = {
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT event_type FROM study_events WHERE session_id = ?",
                    (session["session_id"],),
                ).fetchall()
            }
            missing = set(self.config.required_completion_events) - observed
            if missing:
                connection.rollback()
                raise StudyValidationError(
                    "Session is missing required completion events: " + ", ".join(sorted(missing))
                )

            completion_code = self._unique_completion_code(connection)
            completed_at = _utc_now()
            connection.execute(
                """
                UPDATE study_sessions
                SET status = 'completed', phase = 'completion_code_issued',
                    completed_at = ?, completion_code = ?
                WHERE session_id = ?
                """,
                (completed_at, completion_code, session["session_id"]),
            )
            updated = connection.execute(
                "SELECT * FROM study_sessions WHERE session_id = ?",
                (session["session_id"],),
            ).fetchone()
            connection.commit()
        return self._complete_response(updated)

    def verify_completion_code(self, completion_code: str) -> CompletionCodeVerifyResponse:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT session_id, profile, disclosure_condition, completed_at
                FROM study_sessions
                WHERE completion_code = ? AND status = 'completed'
                """,
                (completion_code.strip().upper(),),
            ).fetchone()
        if not row:
            return CompletionCodeVerifyResponse(valid=False)
        return CompletionCodeVerifyResponse(
            valid=True,
            session_id=row["session_id"],
            profile=row["profile"],
            disclosure_condition=row["disclosure_condition"],
            completed_at=row["completed_at"],
        )

    def completion_record(self, completion_code: str) -> dict[str, Any] | None:
        """Return one completed session and its linked evidence for auditing."""

        normalized = completion_code.strip().upper()
        with self._connect() as connection:
            session = connection.execute(
                "SELECT * FROM study_sessions WHERE completion_code = ? AND status = 'completed'",
                (normalized,),
            ).fetchone()
            if not session:
                return None
            responses = connection.execute(
                "SELECT * FROM study_responses WHERE session_id = ? ORDER BY phase, question_id",
                (session["session_id"],),
            ).fetchall()
            events = connection.execute(
                "SELECT * FROM study_events WHERE session_id = ? ORDER BY seq",
                (session["session_id"],),
            ).fetchall()

        response_rows = [dict(row) for row in responses]
        event_rows = [dict(row) for row in events]
        for row in response_rows:
            row["response"] = json.loads(row.pop("response_json"))
        for row in event_rows:
            row["payload"] = json.loads(row.pop("payload_json"))
        return {
            "session": dict(session),
            "responses": response_rows,
            "events": event_rows,
        }

    def pool_summary(self) -> dict[str, Any]:
        with self._connect() as connection:
            counts = {
                (row["profile"], row["disclosure_condition"]): row["participant_count"]
                for row in connection.execute(
                    """
                    SELECT profile, disclosure_condition, COUNT(*) AS participant_count
                    FROM study_sessions
                    WHERE status != 'invalid'
                    GROUP BY profile, disclosure_condition
                    """
                ).fetchall()
            }
        cells = []
        for profile, conditions in self.config.cell_capacities.items():
            for condition, capacity in conditions.items():
                assigned = counts.get((profile, condition), 0)
                cells.append(
                    {
                        "profile": profile,
                        "disclosure_condition": condition,
                        "assigned": assigned,
                        "capacity": capacity,
                        "remaining": max(0, capacity - assigned),
                    }
                )
        return {"cells": cells, "total_assigned": sum(cell["assigned"] for cell in cells)}

    def export_archive(self) -> bytes:
        """Build a reproducible ZIP containing sessions, responses, and raw events."""

        with self._connect() as connection:
            sessions = connection.execute("SELECT * FROM study_sessions ORDER BY assigned_at").fetchall()
            responses = connection.execute(
                "SELECT * FROM study_responses ORDER BY session_id, phase, question_id"
            ).fetchall()
            events = connection.execute(
                "SELECT * FROM study_events ORDER BY session_id, seq"
            ).fetchall()

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("study_sessions.csv", _rows_to_csv(sessions))
            archive.writestr("study_responses.csv", _rows_to_csv(responses))
            archive.writestr(
                "study_events.jsonl",
                "".join(json.dumps(dict(row), ensure_ascii=False) + "\n" for row in events),
            )
            archive.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "exported_at": _utc_now(),
                        "question_config_version": self.config.question_config_version,
                        "session_count": len(sessions),
                        "response_count": len(responses),
                        "event_count": len(events),
                        "pool": self.pool_summary(),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )
        return output.getvalue()

    def _choose_balanced_cell(self, connection: sqlite3.Connection) -> tuple[str, str] | None:
        counts = {
            (row["profile"], row["disclosure_condition"]): row["participant_count"]
            for row in connection.execute(
                """
                SELECT profile, disclosure_condition, COUNT(*) AS participant_count
                FROM study_sessions
                WHERE status != 'invalid'
                GROUP BY profile, disclosure_condition
                """
            ).fetchall()
        }
        available: list[tuple[int, str, str]] = []
        for profile, conditions in self.config.cell_capacities.items():
            for condition, capacity in conditions.items():
                count = counts.get((profile, condition), 0)
                if count < capacity:
                    available.append((count, profile, condition))
        if not available:
            return None
        minimum = min(item[0] for item in available)
        balanced = [(profile, condition) for count, profile, condition in available if count == minimum]
        return secrets.choice(balanced)

    def _require_session(
        self,
        connection: sqlite3.Connection,
        session_token: str,
    ) -> sqlite3.Row:
        row = connection.execute(
            "SELECT * FROM study_sessions WHERE session_token_hash = ?",
            (_sha256(session_token),),
        ).fetchone()
        if not row:
            raise InvalidStudyTokenError("Invalid or expired study session token")
        return row

    def _unique_completion_code(self, connection: sqlite3.Connection) -> str:
        for _ in range(20):
            suffix = "".join(
                secrets.choice(COMPLETION_ALPHABET)
                for _ in range(self.config.completion_code_length)
            )
            candidate = f"{self.config.completion_code_prefix}-{suffix}"
            exists = connection.execute(
                "SELECT 1 FROM study_sessions WHERE completion_code = ?",
                (candidate,),
            ).fetchone()
            if not exists:
                return candidate
        raise RuntimeError("Unable to generate a unique completion code")

    def _derive_session_token(self, identity: str) -> str:
        digest = hmac.new(self.token_secret, identity.encode("utf-8"), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    def _load_or_create_secret(self) -> bytes:
        secret_path = self.database_path.with_suffix(self.database_path.suffix + ".secret")
        if secret_path.exists():
            return secret_path.read_bytes()
        secret = secrets.token_bytes(32)
        try:
            descriptor = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as file:
                file.write(secret)
            return secret
        except FileExistsError:
            return secret_path.read_bytes()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS study_sessions (
                    session_id TEXT PRIMARY KEY,
                    client_nonce_hash TEXT NOT NULL UNIQUE,
                    entry_token_hash TEXT UNIQUE,
                    session_token_hash TEXT NOT NULL UNIQUE,
                    profile TEXT NOT NULL CHECK(profile IN ('A', 'B', 'C', 'D')),
                    disclosure_condition TEXT NOT NULL CHECK(disclosure_condition IN ('M', 'S', 'V')),
                    language TEXT NOT NULL CHECK(language IN ('en', 'zh')),
                    status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'abandoned', 'invalid')),
                    phase TEXT NOT NULL,
                    question_config_version TEXT NOT NULL,
                    assigned_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    completion_code TEXT UNIQUE
                );

                CREATE TABLE IF NOT EXISTS study_events (
                    session_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    client_timestamp TEXT,
                    server_timestamp TEXT NOT NULL,
                    PRIMARY KEY(session_id, event_id),
                    UNIQUE(session_id, seq),
                    FOREIGN KEY(session_id) REFERENCES study_sessions(session_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS study_responses (
                    session_id TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    question_id TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    response_time_ms INTEGER,
                    q2_asked INTEGER,
                    skip_reason TEXT,
                    submitted_at TEXT NOT NULL,
                    PRIMARY KEY(session_id, phase, question_id),
                    FOREIGN KEY(session_id) REFERENCES study_sessions(session_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_cell
                ON study_sessions(profile, disclosure_condition, status);
                CREATE INDEX IF NOT EXISTS idx_events_session_seq
                ON study_events(session_id, seq);
                """
            )

    @staticmethod
    def _session_response(
        row: sqlite3.Row,
        session_token: str | None = None,
    ) -> StudySessionResponse:
        return StudySessionResponse(
            session_id=row["session_id"],
            session_token=session_token,
            profile=row["profile"],
            disclosure_condition=row["disclosure_condition"],
            status=row["status"],
            phase=row["phase"],
            question_config_version=row["question_config_version"],
            completion_code=row["completion_code"],
        )

    @staticmethod
    def _complete_response(row: sqlite3.Row) -> StudyCompleteResponse:
        return StudyCompleteResponse(
            session_id=row["session_id"],
            completion_code=row["completion_code"],
            profile=row["profile"],
            disclosure_condition=row["disclosure_condition"],
            completed_at=row["completed_at"],
        )


def _sha256(value: str | None) -> str | None:
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rows_to_csv(rows: list[sqlite3.Row]) -> str:
    if not rows:
        return ""
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(dict(row) for row in rows)
    return output.getvalue()
