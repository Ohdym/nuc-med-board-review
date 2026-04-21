import asyncio
import base64
import hashlib
import hmac
import json
import os
import random
import secrets
import time
from pathlib import Path

import esprima
from aiohttp import WSMsgType, web

try:
    import psycopg
    from psycopg.types.json import Jsonb
except Exception:
    psycopg = None
    Jsonb = None


ROOT = Path(__file__).parent
DATA_PATH = ROOT / "data.js"
ATTEMPTS_PATH = Path(os.getenv("ATTEMPTS_PATH", str(ROOT / ".shared_attempts.json")))
QUESTION_FLAGS_PATH = Path(os.getenv("QUESTION_FLAGS_PATH", str(ROOT / ".question_flags.json")))
QUESTION_EDITS_PATH = Path(os.getenv("QUESTION_EDITS_PATH", str(ROOT / ".question_edits.json")))
USER_STORE_PATH = Path(os.getenv("USER_STORE_PATH", str(ROOT / ".users.json")))
USER_CREDENTIALS_PATH = Path(os.getenv("USER_CREDENTIALS_PATH", str(ROOT / "user_credentials.json")))
USER_CREDENTIALS_JSON = os.getenv("USER_CREDENTIALS_JSON", "").strip()
USER_CREDENTIALS_B64 = os.getenv("USER_CREDENTIALS_B64", "").strip()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
PDF_SOURCE_ROOT = Path(os.getenv("PDF_SOURCE_ROOT", str(ROOT / "source-pdfs")))
PDF_SOURCE_FILES = {
    "early-sodee": "early-sodee.pdf",
    "waterstram-gilmore": "waterstram-gilmore.pdf",
    "saha": "saha.pdf",
    "shackett-part-1": "shackett-part-1.pdf",
    "shackett-part-2": "shackett-part-2.pdf",
    "shackett-part-3": "shackett-part-3.pdf",
    "shackett-part-4": "shackett-part-4.pdf",
    "adler-carlton": "adler-carlton.pdf",
}
BOARD_VALUES = [100, 200, 300, 400, 500]
PASSWORD_ITERATIONS = 260000
MAX_USER_ATTEMPTS = 10000
MAX_USER_PLACEMENTS = 500
MAX_CUSTOM_QUIZZES = 200
MAX_QUESTION_FLAGS = 20000
MAX_QUESTION_EDITS = 2000


def parse_js_literal(node):
    node_type = node.type

    if node_type == "Literal":
        return node.value
    if node_type == "ArrayExpression":
        return [parse_js_literal(element) for element in node.elements]
    if node_type == "ObjectExpression":
        output = {}
        for prop in node.properties:
            key_node = prop.key
            key = getattr(key_node, "name", None)
            if key is None:
                key = key_node.value
            output[key] = parse_js_literal(prop.value)
        return output

    raise ValueError(f"Unsupported AST node type: {node_type}")


def load_data_exports():
    module = esprima.parseModule(DATA_PATH.read_text())
    exports = {}

    for statement in module.body:
        if statement.type != "ExportNamedDeclaration" or not statement.declaration:
            continue
        declaration = statement.declaration
        if declaration.type != "VariableDeclaration":
            continue
        for item in declaration.declarations:
            exports[item.id.name] = parse_js_literal(item.init)

    return exports


DATA_EXPORTS = load_data_exports()
CATEGORY_CONFIG = DATA_EXPORTS["CATEGORY_CONFIG"]
QUESTION_BANK = DATA_EXPORTS["QUESTION_BANK"]
QUESTION_BY_ID = {question["id"]: question for question in QUESTION_BANK}


def has_database_store():
    return bool(DATABASE_URL and psycopg and Jsonb)


def open_database_connection():
    if not has_database_store():
        return None
    return psycopg.connect(DATABASE_URL, autocommit=True)


def initialize_database_store():
    if DATABASE_URL and not has_database_store():
        print("DATABASE_URL is set, but psycopg is unavailable. Falling back to local JSON storage.")
        return False

    connection = open_database_connection()
    if not connection:
        return False

    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS app_state (
                        key TEXT PRIMARY KEY,
                        value JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
        return True
    except Exception as error:
        print(f"Could not initialize DATABASE_URL storage. Falling back to local JSON storage: {error}")
        return False
    finally:
        connection.close()


DATABASE_STORE_READY = initialize_database_store()


def load_database_store(key, fallback):
    if not DATABASE_STORE_READY:
        return fallback

    connection = open_database_connection()
    if not connection:
        return fallback

    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT value FROM app_state WHERE key = %s", (key,))
                row = cursor.fetchone()
                if row:
                    return row[0]
                cursor.execute(
                    """
                    INSERT INTO app_state (key, value)
                    VALUES (%s, %s)
                    ON CONFLICT (key) DO NOTHING
                    """,
                    (key, Jsonb(fallback)),
                )
        return fallback
    except Exception as error:
        print(f"Could not read DATABASE_URL store key {key}. Falling back to local JSON storage: {error}")
        return fallback
    finally:
        connection.close()


def save_database_store(key, value):
    if not DATABASE_STORE_READY:
        return False

    connection = open_database_connection()
    if not connection:
        return False

    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO app_state (key, value, updated_at)
                    VALUES (%s, %s, now())
                    ON CONFLICT (key)
                    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
                    """,
                    (key, Jsonb(value)),
                )
        return True
    except Exception as error:
        print(f"Could not write DATABASE_URL store key {key}. Falling back to local JSON storage: {error}")
        return False
    finally:
        connection.close()


def load_attempt_store():
    fallback = {"questions": {}}
    if ATTEMPTS_PATH.exists():
        try:
            fallback = json.loads(ATTEMPTS_PATH.read_text())
        except Exception:
            pass
    return load_database_store("attempt_store", fallback)


ATTEMPT_STORE = load_attempt_store()


def save_attempt_store():
    if save_database_store("attempt_store", ATTEMPT_STORE):
        return
    ATTEMPTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    ATTEMPTS_PATH.write_text(json.dumps(ATTEMPT_STORE))


def load_question_flag_store():
    fallback = {"items": {}}
    if QUESTION_FLAGS_PATH.exists():
        try:
            store = json.loads(QUESTION_FLAGS_PATH.read_text())
            if isinstance(store.get("items"), dict):
                fallback = store
        except Exception:
            pass
    return load_database_store("question_flags", fallback)


QUESTION_FLAG_STORE = load_question_flag_store()


def save_question_flag_store():
    if save_database_store("question_flags", QUESTION_FLAG_STORE):
        return
    QUESTION_FLAGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    QUESTION_FLAGS_PATH.write_text(json.dumps(QUESTION_FLAG_STORE, indent=2))


QUESTION_EDIT_FIELDS = {
    "question",
    "category",
    "topic",
    "type",
    "answerIndex",
    "difficulty",
    "examNumber",
    "questionNumber",
    "explanation",
    "source",
}


def normalize_question_edit(question_id, edit):
    if question_id not in QUESTION_BY_ID or not isinstance(edit, dict):
        return None

    normalized = {}
    for field in QUESTION_EDIT_FIELDS:
        if field not in edit:
            continue
        value = edit.get(field)
        if field in {"answerIndex", "difficulty", "examNumber", "questionNumber"}:
            try:
                number = int(value)
            except Exception:
                continue
            if field == "answerIndex":
                number = max(0, min(4, number))
            normalized[field] = number
        elif field in {"question", "explanation", "source"}:
            normalized[field] = str(value or "")[:12000]
        else:
            normalized[field] = str(value or "")[:240]

    if "options" in edit and isinstance(edit.get("options"), list):
        options = [str(option or "")[:4000] for option in edit.get("options", [])[:5]]
        while len(options) < 5:
            options.append("")
        normalized["options"] = options

    return normalized or None


def normalize_question_edit_store(raw):
    raw_edits = raw.get("edits", raw) if isinstance(raw, dict) else {}
    if not isinstance(raw_edits, dict):
        return {"edits": {}}

    edits = {}
    for question_id, edit in raw_edits.items():
        cleaned_id = str(question_id or "").strip()
        normalized = normalize_question_edit(cleaned_id, edit)
        if normalized:
            edits[cleaned_id] = normalized
        if len(edits) >= MAX_QUESTION_EDITS:
            break
    return {"edits": edits}


def load_question_edit_store():
    fallback = {"edits": {}}
    if QUESTION_EDITS_PATH.exists():
        try:
            fallback = normalize_question_edit_store(json.loads(QUESTION_EDITS_PATH.read_text()))
        except Exception:
            pass
    return normalize_question_edit_store(load_database_store("question_edits", fallback))


QUESTION_EDIT_STORE = load_question_edit_store()


def save_question_edit_store():
    if save_database_store("question_edits", QUESTION_EDIT_STORE):
        return
    QUESTION_EDITS_PATH.parent.mkdir(parents=True, exist_ok=True)
    QUESTION_EDITS_PATH.write_text(json.dumps(QUESTION_EDIT_STORE, indent=2))


def public_question_flag(flag):
    question = QUESTION_BY_ID.get(flag.get("questionId"), {})
    return {
        "id": flag.get("id"),
        "questionId": flag.get("questionId"),
        "targetType": flag.get("targetType") or "question",
        "answerIndex": flag.get("answerIndex"),
        "username": flag.get("username"),
        "displayName": flag.get("displayName") or flag.get("username"),
        "category": flag.get("category") or question.get("category") or "Unknown",
        "topic": flag.get("topic") or question.get("topic") or "Unknown",
        "label": flag.get("label") or flag.get("questionId"),
        "question": flag.get("question") or question.get("question") or flag.get("questionId"),
        "createdAt": flag.get("createdAt") or 0,
        "updatedAt": flag.get("updatedAt") or flag.get("createdAt") or 0,
    }


def question_flag_payload_for(username):
    flags = [
        public_question_flag(flag)
        for flag in QUESTION_FLAG_STORE.get("items", {}).values()
        if flag.get("username") == username
    ]
    flags.sort(key=lambda item: int(item.get("updatedAt") or item.get("createdAt") or 0), reverse=True)
    response = {"mine": flags}

    user = USER_STORE.get("users", {}).get(username, {})
    if user.get("role") == "instructor":
        all_flags = [public_question_flag(flag) for flag in QUESTION_FLAG_STORE.get("items", {}).values()]
        all_flags.sort(key=lambda item: int(item.get("updatedAt") or item.get("createdAt") or 0), reverse=True)
        response["all"] = all_flags[:MAX_QUESTION_FLAGS]

    return response


def load_user_store():
    fallback = {"users": {}}
    if USER_STORE_PATH.exists():
        try:
            store = json.loads(USER_STORE_PATH.read_text())
            if isinstance(store.get("users"), dict):
                fallback = store
        except Exception:
            pass
    return load_database_store("user_store", fallback)


USER_STORE = load_user_store()
AUTH_TOKENS = {}


def normalize_credential_entry(username, entry):
    cleaned_username = str(username or "").strip().lower()
    if len(cleaned_username) < 2 or len(cleaned_username) > 64:
        return None
    if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789._-@" for char in cleaned_username):
        return None

    if isinstance(entry, str):
        password = entry
        display_name = cleaned_username
        role = "student"
    elif isinstance(entry, dict):
        password = entry.get("password", "")
        display_name = entry.get("displayName") or entry.get("display_name") or cleaned_username
        role = str(entry.get("role") or "student").strip().lower()
    else:
        return None

    password = str(password)
    if not password:
        return None

    return {
        "username": cleaned_username,
        "password": password,
        "display_name": str(display_name).strip() or cleaned_username,
        "role": "instructor" if role == "instructor" else "student",
    }


def collect_plaintext_credentials(raw, source_label):
    raw_users = raw.get("users", raw) if isinstance(raw, dict) else raw
    credentials = {}

    if isinstance(raw_users, dict):
        for username, entry in raw_users.items():
            normalized = normalize_credential_entry(username, entry)
            if normalized:
                normalized["source"] = source_label
                credentials[normalized["username"]] = normalized
    elif isinstance(raw_users, list):
        for entry in raw_users:
            if not isinstance(entry, dict):
                continue
            normalized = normalize_credential_entry(entry.get("username"), entry)
            if normalized:
                normalized["source"] = source_label
                credentials[normalized["username"]] = normalized

    return credentials


def load_plaintext_credentials():
    credentials = {}

    if USER_CREDENTIALS_PATH.exists():
        try:
            credentials.update(collect_plaintext_credentials(json.loads(USER_CREDENTIALS_PATH.read_text()), "user_credentials.json"))
        except Exception:
            pass

    if USER_CREDENTIALS_JSON:
        try:
            credentials.update(collect_plaintext_credentials(json.loads(USER_CREDENTIALS_JSON), "USER_CREDENTIALS_JSON"))
        except Exception:
            pass

    if USER_CREDENTIALS_B64:
        try:
            decoded = base64.b64decode(USER_CREDENTIALS_B64).decode("utf-8")
            credentials.update(collect_plaintext_credentials(json.loads(decoded), "USER_CREDENTIALS_B64"))
        except Exception:
            pass

    return credentials


def ensure_plaintext_user(username, credential):
    users = USER_STORE.setdefault("users", {})
    user = users.setdefault(
        username,
        {
            "display_name": credential["display_name"],
            "performance": [],
            "created_at": time.time(),
        },
    )
    user["display_name"] = credential["display_name"]
    user["role"] = credential["role"]
    user["credential_source"] = credential.get("source", "private credentials")
    return user


def parse_student_name_line(line):
    cleaned = " ".join(str(line or "").replace(",", " ").strip().split())
    if not cleaned:
        return None
    parts = cleaned.split()
    if len(parts) < 2:
        return None
    return {
        "firstName": parts[0],
        "lastName": parts[-1],
        "displayName": f"{parts[0]} {parts[-1]}",
    }


def username_base_for_student(first_name, last_name):
    first_initial = normalize_name_piece(first_name)[:1]
    last_clean = normalize_name_piece(last_name)
    base = f"{first_initial}{last_clean}"
    return base or "student"


def unique_student_username(first_name, last_name, current_username=None):
    base = username_base_for_student(first_name, last_name)
    credentials = load_plaintext_credentials()
    used = set(credentials.keys()) | set(USER_STORE.get("users", {}).keys())
    if current_username:
        used.discard(current_username)

    if base not in used:
        return base

    index = 1
    while f"{base}{index}" in used:
        index += 1
    return f"{base}{index}"


def create_or_update_student(first_name, last_name, graduation_year):
    display_name = f"{first_name} {last_name}"
    normalized_display = display_name.strip().lower()
    users = USER_STORE.setdefault("users", {})

    existing_username = None
    for username, user in users.items():
        if (
            str(user.get("role") or "student") == "student"
            and str(user.get("display_name") or "").strip().lower() == normalized_display
        ):
            existing_username = username
            break

    username = existing_username or unique_student_username(first_name, last_name)
    password = f"{normalize_name_piece(last_name)}oit123"
    user = users.setdefault(
        username,
        {
            "performance": [],
            "live_placements": [],
            "created_at": time.time(),
        },
    )
    user["display_name"] = display_name
    user["first_name"] = first_name
    user["last_name"] = last_name
    user["role"] = "student"
    user["graduation_year"] = str(graduation_year or "").strip()
    user["credential_source"] = "instructor roster import"

    if not existing_username or not user.get("password_hash"):
        user.update(hash_password(password))

    return {
        "username": username,
        "password": password,
        "displayName": display_name,
        "graduationYear": user["graduation_year"],
        "created": not bool(existing_username),
    }


def save_user_store():
    if save_database_store("user_store", USER_STORE):
        return
    USER_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    USER_STORE_PATH.write_text(json.dumps(USER_STORE, indent=2))


def normalize_name_piece(value):
    return "".join(char for char in str(value or "").strip().lower() if char.isalnum())


def credential_aliases(credentials):
    first_name_counts = {}
    for credential in credentials.values():
        first_name = first_name_from_display(credential.get("display_name"))
        if first_name:
            key = normalize_name_piece(first_name)
            first_name_counts[key] = first_name_counts.get(key, 0) + 1

    aliases = {}
    for username, credential in credentials.items():
        aliases[username] = username
        display_first = normalize_name_piece(first_name_from_display(credential.get("display_name")))
        inferred_last = normalize_name_piece(username[1:]) if len(username) > 1 else ""
        if display_first and inferred_last:
            aliases[f"{display_first}.{inferred_last}@oit.edu"] = username
        if display_first and first_name_counts.get(display_first) == 1:
            aliases[display_first] = username

    return aliases


def infer_canonical_username(username, user, credentials, aliases):
    cleaned = str(username or "").strip().lower()
    if cleaned in credentials:
        return cleaned
    if cleaned in aliases:
        return aliases[cleaned]

    local_part = cleaned.split("@", 1)[0]
    if "." in local_part:
        first, last = local_part.split(".", 1)
        candidate = f"{normalize_name_piece(first)[:1]}{normalize_name_piece(last)}"
        if candidate in credentials:
            return candidate

    display_parts = [
        normalize_name_piece(part)
        for part in str(user.get("display_name") or "").replace(".", " ").split()
        if normalize_name_piece(part)
    ]
    if len(display_parts) >= 2:
        candidate = f"{display_parts[0][:1]}{''.join(display_parts[1:])}"
        if candidate in credentials:
            return candidate

    return cleaned


def merge_user_record(target, source):
    target.setdefault("performance", [])
    existing_attempts = {
        (
            str(attempt.get("questionId")),
            str(attempt.get("mode")),
            int(attempt.get("timestamp") or 0),
        )
        for attempt in target.get("performance", [])
    }
    for attempt in source.get("performance", []):
        key = (
            str(attempt.get("questionId")),
            str(attempt.get("mode")),
            int(attempt.get("timestamp") or 0),
        )
        if key not in existing_attempts:
            target["performance"].append(attempt)
            existing_attempts.add(key)

    target.setdefault("live_placements", [])
    existing_placements = {
        (
            str(placement.get("code")),
            int(placement.get("finishedAt") or 0),
            int(placement.get("placement") or 0),
        )
        for placement in target.get("live_placements", [])
    }
    for placement in source.get("live_placements", []):
        key = (
            str(placement.get("code")),
            int(placement.get("finishedAt") or 0),
            int(placement.get("placement") or 0),
        )
        if key not in existing_placements:
            target["live_placements"].append(placement)
            existing_placements.add(key)

    if source.get("created_at"):
        target["created_at"] = min(float(target.get("created_at") or source["created_at"]), float(source["created_at"]))
    if source.get("updated_at"):
        target["updated_at"] = max(float(target.get("updated_at") or 0), float(source["updated_at"]))


def migrate_user_store_aliases():
    credentials = load_plaintext_credentials()
    if not credentials:
        return 0

    users = USER_STORE.setdefault("users", {})
    aliases = credential_aliases(credentials)
    migrated = 0

    for username, user in list(users.items()):
        canonical = infer_canonical_username(username, user, credentials, aliases)
        if canonical == username or canonical not in credentials:
            continue

        target = ensure_plaintext_user(canonical, credentials[canonical])
        merge_user_record(target, user)
        users.pop(username, None)
        migrated += 1

    if migrated:
        save_user_store()
    return migrated


def hash_password(password, salt=None, iterations=PASSWORD_ITERATIONS):
    salt_bytes = base64.b64decode(salt) if salt else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        str(password).encode("utf-8"),
        salt_bytes,
        iterations,
    )
    return {
        "salt": base64.b64encode(salt_bytes).decode("ascii"),
        "password_hash": base64.b64encode(digest).decode("ascii"),
        "iterations": iterations,
    }


def verify_password(password, user):
    salt = user.get("salt")
    expected = user.get("password_hash")
    if not salt or not expected:
        return False
    iterations = int(user.get("iterations", PASSWORD_ITERATIONS))
    candidate = hash_password(password, salt, iterations)
    return hmac.compare_digest(candidate["password_hash"], expected)


def authenticate_user(username, password):
    migrate_user_store_aliases()
    credentials = load_plaintext_credentials()
    credential = credentials.get(username)
    if credential and hmac.compare_digest(str(password), credential["password"]):
        user = ensure_plaintext_user(username, credential)
        save_user_store()
        return user

    user = USER_STORE["users"].get(username)
    if user and verify_password(password, user):
        return user

    return None


def sanitize_account_username(value):
    cleaned = str(value or "").strip().lower()
    if len(cleaned) < 2:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Username must be at least 2 characters."}),
            content_type="application/json",
        )
    if len(cleaned) > 64 or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789._-@" for char in cleaned):
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Use 2-64 letters, numbers, dots, dashes, underscores, or @ for usernames."}),
            content_type="application/json",
        )
    return cleaned


def public_user(username, user):
    return {
        "username": username,
        "displayName": user.get("display_name") or username,
        "firstName": user.get("first_name") or first_name_from_display(user.get("display_name") or username),
        "lastName": user.get("last_name") or "",
        "graduationYear": str(user.get("graduation_year") or ""),
        "role": user.get("role") or "student",
        "attemptCount": len(user.get("performance", [])),
        "placementCount": len(user.get("live_placements", [])),
        "customQuizCount": len(user.get("custom_quizzes", [])),
    }


def normalize_custom_quiz_entry(quiz):
    if not isinstance(quiz, dict):
        return None

    title = " ".join(str(quiz.get("title") or "").strip().split())
    question_ids = []
    seen_ids = set()
    for raw_id in quiz.get("questionIds", []):
        question_id = str(raw_id or "").strip()
        if question_id and question_id not in seen_ids:
            question_ids.append(question_id)
            seen_ids.add(question_id)

    if not title or not question_ids:
        return None

    quiz_id = str(quiz.get("id") or "").strip()
    if not quiz_id:
        digest = hashlib.sha256(f"{title}|{','.join(question_ids)}".encode("utf-8")).hexdigest()[:16]
        quiz_id = f"custom-quiz-{digest}"

    filters = quiz.get("filters") if isinstance(quiz.get("filters"), dict) else {}
    created_at = int(quiz.get("createdAt") or time.time() * 1000)
    updated_at = int(quiz.get("updatedAt") or created_at)

    return {
        "id": quiz_id[:96],
        "title": title[:120],
        "description": " ".join(str(quiz.get("description") or "").strip().split())[:240],
        "questionIds": question_ids[:500],
        "filters": {
            "exam": str(filters.get("exam") or "all")[:32],
            "questionNumbers": str(filters.get("questionNumbers") or "")[:500],
            "category": str(filters.get("category") or "all")[:120],
            "topic": str(filters.get("topic") or "all")[:160],
        },
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def normalize_custom_quiz_library(quizzes):
    normalized = []
    seen_ids = set()
    if not isinstance(quizzes, list):
        return normalized

    for quiz in quizzes:
        item = normalize_custom_quiz_entry(quiz)
        if not item or item["id"] in seen_ids:
            continue
        normalized.append(item)
        seen_ids.add(item["id"])

    normalized.sort(key=lambda item: int(item.get("updatedAt") or 0), reverse=True)
    return normalized[:MAX_CUSTOM_QUIZZES]


def first_name_from_display(value):
    name = " ".join(str(value or "").strip().split())
    if not name:
        return ""
    return name.split(" ")[0]


def live_name_for_account(account_username, fallback):
    if account_username and account_username in USER_STORE["users"]:
        first_name = first_name_from_display(USER_STORE["users"][account_username].get("display_name"))
        if first_name:
            return first_name[:20]
    return sanitize_username(fallback)


def get_auth_username(request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.removeprefix("Bearer ").strip()
    username = AUTH_TOKENS.get(token)
    if username and username in USER_STORE["users"]:
        return username
    return None


def require_auth_username(request):
    username = get_auth_username(request)
    if not username:
        raise web.HTTPUnauthorized(
            text=json.dumps({"error": "Please sign in to save or review account history."}),
            content_type="application/json",
        )
    return username


def require_instructor_username(request):
    username = require_auth_username(request)
    user = USER_STORE["users"].get(username, {})
    if user.get("role") != "instructor":
        raise web.HTTPForbidden(
            text=json.dumps({"error": "Instructor access is required for this dashboard."}),
            content_type="application/json",
        )
    return username


def normalize_attempt_entry(attempt):
    question_id = str(attempt.get("questionId", "")).strip()
    if not question_id:
        return None

    question = QUESTION_BY_ID.get(question_id, {})
    return {
        "questionId": question_id,
        "category": str(attempt.get("category") or question.get("category") or "Unknown"),
        "topic": str(attempt.get("topic") or question.get("topic") or "Unknown"),
        "type": str(attempt.get("type") or question.get("type") or "unknown"),
        "difficulty": int(attempt.get("difficulty") or 1),
        "mode": str(attempt.get("mode", "unknown")).strip() or "unknown",
        "correct": bool(attempt.get("correct")),
        "timestamp": int(attempt.get("timestamp") or time.time() * 1000),
    }


def record_user_attempts(username, attempts):
    user = USER_STORE["users"][username]
    performance = user.setdefault("performance", [])
    normalized = [normalize_attempt_entry(attempt) for attempt in attempts]
    normalized = [attempt for attempt in normalized if attempt]
    if not normalized:
        return 0

    existing = {
        (
            str(attempt.get("questionId")),
            str(attempt.get("mode")),
            int(attempt.get("timestamp") or 0),
        )
        for attempt in performance
    }
    deduped = []
    for attempt in normalized:
        key = (
            str(attempt.get("questionId")),
            str(attempt.get("mode")),
            int(attempt.get("timestamp") or 0),
        )
        if key in existing:
            continue
        deduped.append(attempt)
        existing.add(key)

    if not deduped:
        return 0

    performance.extend(deduped)
    if len(performance) > MAX_USER_ATTEMPTS:
        user["performance"] = performance[-MAX_USER_ATTEMPTS:]
    user["updated_at"] = time.time()
    save_user_store()
    return len(deduped)


def rank_label(rank):
    if rank == 1:
        return "1st"
    if rank == 2:
        return "2nd"
    if rank == 3:
        return "3rd"
    return f"{rank}th"


def resolve_player_account_username(player):
    account_username = player.get("account_username")
    if account_username and account_username in USER_STORE["users"]:
        return account_username

    live_username = str(player.get("username", "")).strip().lower()
    if live_username in USER_STORE["users"]:
        return live_username

    display_matches = [
        username
        for username, user in USER_STORE["users"].items()
        if str(user.get("display_name", "")).strip().lower() == live_username
    ]
    if len(display_matches) == 1:
        return display_matches[0]

    return None


def record_live_game_placements(session):
    if getattr(session, "placements_recorded", False):
        return 0

    leaderboard = sorted_players(session.players)
    if not leaderboard:
        session.placements_recorded = True
        return 0

    finished_at = int(time.time() * 1000)
    display_names = session.player_display_names()
    previous_score = None
    current_rank = 0
    recorded = 0

    for index, player in enumerate(leaderboard, start=1):
        if previous_score is None or player["score"] != previous_score:
            current_rank = index
            previous_score = player["score"]

        username = resolve_player_account_username(player)
        if not username:
            continue

        user = USER_STORE["users"][username]
        placements = user.setdefault("live_placements", [])
        placements.append({
            "gameCode": session.code,
            "placement": current_rank,
            "placementLabel": rank_label(current_rank),
            "score": player["score"],
            "playerCount": len(leaderboard),
            "username": display_names.get(player["id"], player["username"]),
            "isHost": player["is_host"],
            "startedAt": int(session.created_at * 1000),
            "finishedAt": finished_at,
        })
        if len(placements) > MAX_USER_PLACEMENTS:
            user["live_placements"] = placements[-MAX_USER_PLACEMENTS:]
        user["updated_at"] = time.time()
        recorded += 1

    session.placements_recorded = True
    if recorded:
        save_user_store()
    return recorded


def record_shared_attempt(user_id, question_id, correct, mode):
    question_bucket = ATTEMPT_STORE["questions"].setdefault(
        question_id,
        {"attempts": 0, "correct": 0, "users": {}, "modes": {}},
    )
    question_bucket["attempts"] += 1
    question_bucket["correct"] += 1 if correct else 0
    question_bucket["modes"][mode] = question_bucket["modes"].get(mode, 0) + 1

    user_bucket = question_bucket["users"].setdefault(
        user_id,
        {"attempts": 0, "correct": 0},
    )
    user_bucket["attempts"] += 1
    user_bucket["correct"] += 1 if correct else 0
    save_attempt_store()


def summarize_attempts(attempts):
    summary = {
        "attempts": len(attempts),
        "correct": sum(1 for attempt in attempts if attempt.get("correct")),
        "accuracy": 0,
        "categoryStats": {},
        "modeStats": {},
        "topicStats": {},
        "typeStats": {},
    }
    summary["accuracy"] = round((summary["correct"] / summary["attempts"]) * 100, 1) if summary["attempts"] else 0

    for attempt in attempts:
        for key, bucket_name in (
            ("category", "categoryStats"),
            ("mode", "modeStats"),
            ("topic", "topicStats"),
            ("type", "typeStats"),
        ):
            label = str(attempt.get(key) or "Unknown")
            bucket = summary[bucket_name].setdefault(label, {"attempts": 0, "correct": 0, "accuracy": 0})
            bucket["attempts"] += 1
            bucket["correct"] += 1 if attempt.get("correct") else 0

    for bucket_name in ("categoryStats", "modeStats", "topicStats", "typeStats"):
        for bucket in summary[bucket_name].values():
            bucket["accuracy"] = round((bucket["correct"] / bucket["attempts"]) * 100, 1) if bucket["attempts"] else 0

    return summary


def summarize_placements(placements):
    counts = {"first": 0, "second": 0, "third": 0}
    best_score = 0
    for placement in placements:
        rank = int(placement.get("placement", 0) or 0)
        if rank == 1:
            counts["first"] += 1
        elif rank == 2:
            counts["second"] += 1
        elif rank == 3:
            counts["third"] += 1
        best_score = max(best_score, int(placement.get("score", 0) or 0))
    return {
        "gamesPlayed": len(placements),
        "podiumCounts": counts,
        "bestScore": best_score,
    }


def merge_stat_bucket(target, source):
    for label, stats in source.items():
        bucket = target.setdefault(label, {"attempts": 0, "correct": 0, "accuracy": 0})
        bucket["attempts"] += int(stats.get("attempts", 0) or 0)
        bucket["correct"] += int(stats.get("correct", 0) or 0)


def finalize_stat_bucket(bucket):
    for stats in bucket.values():
        stats["accuracy"] = round((stats["correct"] / stats["attempts"]) * 100, 1) if stats["attempts"] else 0
    return dict(sorted(bucket.items(), key=lambda item: (-item[1]["attempts"], item[0])))


def public_attempt(attempt):
    question = QUESTION_BY_ID.get(attempt.get("questionId"), {})
    return {
        "questionId": attempt.get("questionId"),
        "question": question.get("question", attempt.get("questionId", "Unknown question")),
        "category": attempt.get("category") or question.get("category") or "Unknown",
        "topic": attempt.get("topic") or question.get("topic") or "Unknown",
        "type": attempt.get("type") or question.get("type") or "unknown",
        "difficulty": attempt.get("difficulty") or 1,
        "mode": attempt.get("mode") or "unknown",
        "correct": bool(attempt.get("correct")),
        "timestamp": attempt.get("timestamp") or 0,
    }


def build_instructor_stats():
    credentials = load_plaintext_credentials()
    usernames = sorted(set(credentials.keys()) | set(USER_STORE.get("users", {}).keys()))
    users = []
    aggregate = {
        "totalUsers": 0,
        "activeUsers": 0,
        "totalAttempts": 0,
        "totalCorrect": 0,
        "accuracy": 0,
        "totalLiveGames": 0,
        "categoryStats": {},
        "modeStats": {},
        "topicStats": {},
        "typeStats": {},
        "recentAttempts": [],
    }

    for username in usernames:
        credential = credentials.get(username, {})
        user = USER_STORE.get("users", {}).get(username, {})
        role = user.get("role") or credential.get("role") or "student"
        display_name = user.get("display_name") or credential.get("display_name") or username
        first_name = user.get("first_name") or first_name_from_display(display_name)
        last_name = user.get("last_name") or ""
        graduation_year = str(user.get("graduation_year") or "")
        attempts = list(user.get("performance", []))
        placements = list(user.get("live_placements", []))
        attempt_summary = summarize_attempts(attempts)
        placement_summary = summarize_placements(placements)

        user_payload = {
            "username": username,
            "displayName": display_name,
            "firstName": first_name,
            "lastName": last_name,
            "fullName": display_name,
            "graduationYear": graduation_year,
            "role": role,
            "summary": attempt_summary,
            "placements": placement_summary,
            "recentAttempts": [public_attempt(attempt) for attempt in sorted(attempts, key=lambda item: item.get("timestamp", 0), reverse=True)[:100]],
            "livePlacements": sorted(placements, key=lambda item: item.get("finishedAt", 0), reverse=True)[:100],
        }
        users.append(user_payload)

        if role == "instructor":
            continue

        aggregate["totalUsers"] += 1
        if attempts:
            aggregate["activeUsers"] += 1
        aggregate["totalAttempts"] += attempt_summary["attempts"]
        aggregate["totalCorrect"] += attempt_summary["correct"]
        aggregate["totalLiveGames"] += placement_summary["gamesPlayed"]
        aggregate["recentAttempts"].extend(
            {
                **public_attempt(attempt),
                "username": username,
                "displayName": display_name,
                "graduationYear": graduation_year,
            }
            for attempt in attempts
        )
        merge_stat_bucket(aggregate["categoryStats"], attempt_summary["categoryStats"])
        merge_stat_bucket(aggregate["modeStats"], attempt_summary["modeStats"])
        merge_stat_bucket(aggregate["topicStats"], attempt_summary["topicStats"])
        merge_stat_bucket(aggregate["typeStats"], attempt_summary["typeStats"])

    aggregate["accuracy"] = round((aggregate["totalCorrect"] / aggregate["totalAttempts"]) * 100, 1) if aggregate["totalAttempts"] else 0
    aggregate["categoryStats"] = finalize_stat_bucket(aggregate["categoryStats"])
    aggregate["modeStats"] = finalize_stat_bucket(aggregate["modeStats"])
    aggregate["topicStats"] = finalize_stat_bucket(aggregate["topicStats"])
    aggregate["typeStats"] = finalize_stat_bucket(aggregate["typeStats"])
    aggregate["recentAttempts"] = sorted(
        aggregate["recentAttempts"],
        key=lambda item: item.get("timestamp", 0),
        reverse=True,
    )[:150]

    graduation_years = sorted(
        {
            user.get("graduationYear")
            for user in users
            if user.get("role") != "instructor" and user.get("graduationYear")
        },
        key=lambda value: (len(value), value),
    )
    users.sort(key=lambda user: (user["role"] == "instructor", user.get("graduationYear") or "zzzz", user["displayName"].lower()))
    return {"aggregate": aggregate, "users": users, "graduationYears": graduation_years}


def get_weighted_question_difficulty(question):
    bucket = ATTEMPT_STORE["questions"].get(question["id"])

    if not bucket or not bucket.get("users"):
        return 1

    user_accuracies = [
        user_stats["correct"] / user_stats["attempts"]
        for user_stats in bucket["users"].values()
        if user_stats["attempts"]
    ]
    if not user_accuracies:
        return 1

    average_accuracy = sum(user_accuracies) / len(user_accuracies)
    return 1 + (1 - average_accuracy) * 4


def has_live_question_bank():
    return bool(QUESTION_BANK)


def random_code(existing_codes):
    while True:
        code = "".join(random.choice("0123456789") for _ in range(6))
        if code not in existing_codes:
            return code


def sanitize_username(value):
    cleaned = " ".join(str(value or "").strip().split())
    if len(cleaned) < 2:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Username must be at least 2 characters."}),
            content_type="application/json",
        )
    if len(cleaned) > 20:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Username must be 20 characters or fewer."}),
            content_type="application/json",
        )
    return cleaned


def sorted_players(players):
    return sorted(players.values(), key=lambda player: (-player["score"], player["joined_at"]))


def choose_board_categories():
    if not QUESTION_BANK:
        return []

    counts = {}
    for question in QUESTION_BANK:
        counts[question["category"]] = counts.get(question["category"], 0) + 1

    categories = [category["name"] for category in CATEGORY_CONFIG if counts.get(category["name"], 0) >= 5]
    if len(categories) < 5:
        categories = list({question["category"] for question in QUESTION_BANK})

    random.shuffle(categories)
    return categories[: min(5, len(categories))]


def pick_board_question(category, difficulty, used_ids):
    pool = [
        question
        for question in QUESTION_BANK
        if question["category"] == category and question["id"] not in used_ids
    ]
    if not pool:
        return None

    random.shuffle(pool)
    scored = []
    for question in pool:
        weighted_difficulty = get_weighted_question_difficulty(question)
        score_gap = abs(weighted_difficulty - difficulty)
        scored.append((score_gap, weighted_difficulty, question))

    scored.sort(key=lambda item: item[0])
    top_choices = scored[: min(3, len(scored))]
    return random.choice(top_choices)[2]


def build_board():
    categories = choose_board_categories()
    used_ids = set()
    board = []

    for category in categories:
        column = []
        for row_index, value in enumerate(BOARD_VALUES, start=1):
            question = pick_board_question(category, row_index, used_ids)
            if question:
                used_ids.add(question["id"])
            column.append({
                "value": value,
                "question": question,
                "answered": False,
            })
        board.append(column)

    return categories, board


class GameSession:
    def __init__(self, code, host_name, host_account_username=None):
        self.code = code
        self.created_at = time.time()
        self.status = "lobby"
        self.players = {}
        self.sockets = {}
        self.host_player_id = None
        self.categories = []
        self.board = []
        self.current_turn_player_id = None
        self.active_question = None
        self.question_task = None
        self.last_results = []
        self.placements_recorded = False
        self.lock = asyncio.Lock()
        self._create_player(host_name, is_host=True, account_username=host_account_username)

    def _create_player(self, username, is_host=False, account_username=None):
        player_id = secrets.token_hex(6)
        token = secrets.token_urlsafe(18)
        player = {
            "id": player_id,
            "token": token,
            "username": username,
            "base_username": username,
            "account_username": account_username,
            "score": 0,
            "is_host": is_host,
            "connected": False,
            "joined_at": time.time(),
        }
        self.players[player_id] = player
        if is_host:
            self.host_player_id = player_id
        return player

    def player_display_names(self):
        base_groups = {}
        for player in self.players.values():
            base = str(player.get("base_username") or player.get("username") or "Player").strip() or "Player"
            base_groups.setdefault(base.lower(), {"base": base, "players": []})["players"].append(player)

        display_names = {}
        for group in base_groups.values():
            players = sorted(group["players"], key=lambda player: player["joined_at"])
            if len(players) == 1:
                display_names[players[0]["id"]] = group["base"]
                continue

            for index, player in enumerate(players, start=1):
                suffix = f" ({index})"
                display_names[player["id"]] = f"{group['base'][: max(1, 20 - len(suffix))]}{suffix}"

        return display_names

    def create_join_response(self, player):
        return {
            "code": self.code,
            "playerId": player["id"],
            "playerToken": player["token"],
            "host": player["is_host"],
        }

    def get_player_by_token(self, token):
        for player in self.players.values():
            if player["token"] == token:
                return player
        return None

    def join(self, username, account_username=None):
        if account_username:
            for player in self.players.values():
                if player.get("account_username") == account_username:
                    if player["connected"]:
                        raise web.HTTPBadRequest(
                            text=json.dumps({"error": "That account is already active in this game."}),
                            content_type="application/json",
                        )
                    player["token"] = secrets.token_urlsafe(18)
                    return player

        for player in self.players.values():
            if player["username"].lower() == username.lower():
                if account_username:
                    continue
                if player["connected"]:
                    raise web.HTTPBadRequest(
                        text=json.dumps({"error": "That username is already active in this game."}),
                        content_type="application/json",
                    )
                player["token"] = secrets.token_urlsafe(18)
                if account_username:
                    player["account_username"] = account_username
                return player

        if self.status != "lobby":
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "This game is already in progress. Rejoin using the same username you used before."}),
                content_type="application/json",
            )

        return self._create_player(username, account_username=account_username)

    def connected_player_ids(self):
        return [player_id for player_id, player in self.players.items() if player["connected"]]

    def choose_next_turn(self, exclude_player_id=None):
        connected_ids = self.connected_player_ids()
        if not connected_ids:
            self.current_turn_player_id = None
            return

        candidates = [player_id for player_id in connected_ids if player_id != exclude_player_id]
        if not candidates:
            candidates = connected_ids
        self.current_turn_player_id = random.choice(candidates)

    def remaining_tiles(self):
        return sum(1 for column in self.board for tile in column if tile["question"] and not tile["answered"])

    def all_tiles_answered(self):
        return self.remaining_tiles() == 0

    def winner_names(self):
        if not self.players:
            return []
        leaderboard = sorted_players(self.players)
        display_names = self.player_display_names()
        top_score = leaderboard[0]["score"]
        return [display_names.get(player["id"], player["username"]) for player in leaderboard if player["score"] == top_score]

    def public_state(self, viewer_id=None):
        display_names = self.player_display_names()
        players = [
            {
                "id": player["id"],
                "username": display_names.get(player["id"], player["username"]),
                "score": player["score"],
                "connected": player["connected"],
                "isHost": player["is_host"],
            }
            for player in sorted_players(self.players)
        ]

        board = []
        for column_index, category in enumerate(self.categories):
            tiles = []
            for row_index, tile in enumerate(self.board[column_index]):
                tiles.append({
                    "columnIndex": column_index,
                    "rowIndex": row_index,
                    "value": tile["value"],
                    "answered": tile["answered"] or not tile["question"],
                })
            board.append({"category": category, "tiles": tiles})

        active = None
        if self.active_question:
            opened_by = self.players.get(self.active_question["opened_by_player_id"])
            viewer_answer = self.active_question["answers"].get(viewer_id) if viewer_id else None
            active = {
                "questionId": self.active_question["question"]["id"],
                "columnIndex": self.active_question["column_index"],
                "rowIndex": self.active_question["row_index"],
                "value": self.active_question["value"],
                "category": self.active_question["question"]["category"],
                "topic": self.active_question["question"]["topic"],
                "type": self.active_question["question"]["type"],
                "difficulty": round(get_weighted_question_difficulty(self.active_question["question"])),
                "question": self.active_question["question"]["question"],
                "image": self.active_question["question"].get("image"),
                "imageAlt": self.active_question["question"].get("imageAlt"),
                "imageCaption": self.active_question["question"].get("imageCaption"),
                "options": self.active_question["question"]["options"],
                "openedByPlayerId": self.active_question["opened_by_player_id"],
                "openedByUsername": display_names.get(opened_by["id"], opened_by["username"]) if opened_by else "Player",
                "answerCount": len(self.active_question["answers"]),
                "hasAnswered": viewer_id in self.active_question["answers"],
                "selectedIndex": viewer_answer["selectedIndex"] if viewer_answer else None,
                "selectionLocked": self.status in {"reveal", "board_complete", "finished"},
                "hostCanReveal": self.status == "question" and viewer_id == self.host_player_id,
                "hostCanAdvance": self.status == "reveal" and viewer_id == self.host_player_id,
                "phase": self.status,
            }

            if self.status in {"reveal", "board_complete", "finished"}:
                active["correctAnswerIndex"] = self.active_question["question"]["answerIndex"]
                active["explanation"] = self.active_question["question"]["explanation"]
                active["source"] = self.active_question["question"].get("source")
                active["viewerResult"] = {
                    "selectedIndex": viewer_answer["selectedIndex"] if viewer_answer else None,
                    "correct": viewer_answer["selectedIndex"] == self.active_question["question"]["answerIndex"]
                    if viewer_answer
                    else False,
                }

        current_turn_name = None
        if self.current_turn_player_id and self.current_turn_player_id in self.players:
            current_turn = self.players[self.current_turn_player_id]
            current_turn_name = display_names.get(current_turn["id"], current_turn["username"])

        return {
            "code": self.code,
            "status": self.status,
            "players": players,
            "board": board,
            "currentTurnPlayerId": self.current_turn_player_id,
            "currentTurnUsername": current_turn_name,
            "hostPlayerId": self.host_player_id,
            "remainingTiles": self.remaining_tiles(),
            "activeQuestion": active,
            "winnerNames": self.winner_names() if self.status in {"board_complete", "finished"} else [],
        }

    async def broadcast_state(self):
        stale = []
        for player_id, socket in self.sockets.items():
            if socket.closed:
                stale.append(player_id)
                continue
            try:
                await socket.send_json({"type": "state", "session": self.public_state(player_id)})
            except Exception:
                stale.append(player_id)

        for player_id in stale:
            await self.handle_disconnect(player_id)

    async def send_error(self, player_id, message):
        socket = self.sockets.get(player_id)
        if socket and not socket.closed:
            await socket.send_json({"type": "error", "message": message})

    async def handle_connect(self, player_id, socket):
        self.sockets[player_id] = socket
        if player_id in self.players:
            self.players[player_id]["connected"] = True

        if self.status == "picking" and self.current_turn_player_id not in self.connected_player_ids():
            self.choose_next_turn()

        await self.broadcast_state()

    async def handle_disconnect(self, player_id):
        socket = self.sockets.pop(player_id, None)
        if socket and not socket.closed:
            await socket.close()

        if player_id in self.players:
            self.players[player_id]["connected"] = False

        if self.status == "question" and self.active_question:
            await self.broadcast_state()
            return

        if self.status == "picking" and self.current_turn_player_id == player_id:
            self.choose_next_turn(exclude_player_id=player_id)

        await self.broadcast_state()

    async def start_game(self, player_id):
        if player_id != self.host_player_id:
            await self.send_error(player_id, "Only the host can start the game.")
            return
        if self.status != "lobby":
            await self.send_error(player_id, "The game has already started.")
            return
        if len(self.connected_player_ids()) < 2:
            await self.send_error(player_id, "At least 2 connected players are needed to start.")
            return
        if not has_live_question_bank():
            await self.send_error(player_id, "No shared live question bank is loaded on the server yet.")
            return

        self.categories, self.board = build_board()
        if not self.categories or not any(tile["question"] for column in self.board for tile in column):
            await self.send_error(player_id, "The shared live question bank does not have enough content to build a board yet.")
            return
        self.status = "picking"
        self.last_results = []
        self.choose_next_turn()
        await self.broadcast_state()

    async def pick_tile(self, player_id, column_index, row_index):
        if self.status != "picking":
            await self.send_error(player_id, "Wait for the next selection turn.")
            return
        if player_id != self.current_turn_player_id:
            await self.send_error(player_id, "It is not your turn to pick a tile.")
            return

        if column_index < 0 or column_index >= len(self.board):
            await self.send_error(player_id, "That tile does not exist.")
            return
        if row_index < 0 or row_index >= len(self.board[column_index]):
            await self.send_error(player_id, "That tile does not exist.")
            return

        tile = self.board[column_index][row_index]
        if tile["answered"] or not tile["question"]:
            await self.send_error(player_id, "That tile has already been used.")
            return

        self.cancel_question_task()

        self.status = "question"
        self.active_question = {
            "column_index": column_index,
            "row_index": row_index,
            "value": tile["value"],
            "question": tile["question"],
            "opened_by_player_id": player_id,
            "answers": {},
        }
        await self.broadcast_state()

    async def select_answer(self, player_id, answer_index):
        if self.status != "question" or not self.active_question:
            await self.send_error(player_id, "There is no live question to answer.")
            return

        if answer_index < 0 or answer_index >= len(self.active_question["question"]["options"]):
            await self.send_error(player_id, "That answer choice is not valid.")
            return

        self.active_question["answers"][player_id] = {
            "selectedIndex": int(answer_index),
            "answeredAt": time.time(),
        }

        await self.broadcast_state()

    async def finalize_answers(self, player_id):
        if self.status != "question" or not self.active_question:
            await self.send_error(player_id, "There is no live question to finalize.")
            return
        if player_id != self.host_player_id:
            await self.send_error(player_id, "Only the host can submit the answers.")
            return

        await self.reveal_active_question()

    def cancel_question_task(self):
        if self.question_task and not self.question_task.done():
            self.question_task.cancel()
        self.question_task = None

    async def reveal_active_question(self):
        if self.status != "question" or not self.active_question:
            return

        self.cancel_question_task()

        question = self.active_question["question"]
        value = self.active_question["value"]
        answers = self.active_question["answers"]
        results = []

        for player in sorted_players(self.players):
            player_answer = answers.get(player["id"])
            selected_index = player_answer["selectedIndex"] if player_answer else None
            correct = selected_index == question["answerIndex"]
            if correct:
                player["score"] += value
            record_shared_attempt(player["id"], question["id"], correct, "live-jeopardy")

            results.append({
                "playerId": player["id"],
                "username": player["username"],
                "selectedIndex": selected_index,
                "correct": correct,
            })

        self.last_results = results
        tile = self.board[self.active_question["column_index"]][self.active_question["row_index"]]
        tile["answered"] = True
        self.status = "reveal"
        self.choose_next_turn(exclude_player_id=self.active_question["opened_by_player_id"])
        await self.broadcast_state()

    async def advance_round(self, player_id):
        if player_id != self.host_player_id:
            await self.send_error(player_id, "Only the host can move to the next round.")
            return
        if self.status != "reveal":
            await self.send_error(player_id, "There is no reveal screen to advance.")
            return

        if self.all_tiles_answered():
            self.status = "board_complete"
            self.active_question = None
            await self.broadcast_state()
            return

        self.active_question = None
        self.status = "picking"
        await self.broadcast_state()

    async def terminate_game(self, player_id):
        if player_id != self.host_player_id:
            await self.send_error(player_id, "Only the host can terminate the game.")
            return

        self.cancel_question_task()
        self.active_question = None
        self.status = "finished"
        record_live_game_placements(self)
        await self.broadcast_state()


class OnlineQuizSession:
    def __init__(self, code, title, description, question_ids, question_summaries, host_name, host_account_username=None):
        self.code = code
        self.created_at = time.time()
        self.title = title
        self.description = description
        self.question_ids = question_ids
        self.question_summaries = question_summaries
        self.host_account_username = host_account_username
        self.participants = {}
        self.host_participant_id = None
        self.status = "lobby"
        self._create_participant(host_name, is_host=True, account_username=host_account_username)

    def _create_participant(self, username, is_host=False, account_username=None):
        participant_id = secrets.token_hex(6)
        token = secrets.token_urlsafe(18)
        participant = {
            "id": participant_id,
            "token": token,
            "username": username,
            "account_username": account_username,
            "is_host": is_host,
            "connected": True,
            "score": 0,
            "joined_at": time.time(),
            "started_at": None,
            "current_index": 0,
            "answers": {},
            "finished_at": None,
            "results": [],
        }
        self.participants[participant_id] = participant
        if is_host:
            self.host_participant_id = participant_id
        return participant

    def create_join_response(self, participant):
        return {
            "code": self.code,
            "participantId": participant["id"],
            "participantToken": participant["token"],
            "host": participant["is_host"],
            "session": self.public_state(participant["token"]),
        }

    def get_participant_by_token(self, token):
        for participant in self.participants.values():
            if participant["token"] == token:
                return participant
        return None

    def require_participant_by_token(self, token):
        participant = self.get_participant_by_token(token)
        if not participant:
            raise web.HTTPForbidden(
                text=json.dumps({"error": "Invalid online quiz token."}),
                content_type="application/json",
            )
        return participant

    def require_host_by_token(self, token):
        participant = self.require_participant_by_token(token)
        if not participant["is_host"]:
            raise web.HTTPForbidden(
                text=json.dumps({"error": "Only the host can control the online quiz."}),
                content_type="application/json",
            )
        return participant

    def join(self, username, account_username=None):
        if account_username:
            for participant in self.participants.values():
                if participant.get("account_username") == account_username:
                    participant["connected"] = True
                    participant["token"] = secrets.token_urlsafe(18)
                    if self.status == "active" and participant.get("finished_at") is None:
                        participant["started_at"] = participant.get("started_at") or time.time()
                    return participant

        for participant in self.participants.values():
            if participant["username"].lower() == username.lower():
                if account_username:
                    continue
                participant["connected"] = True
                participant["token"] = secrets.token_urlsafe(18)
                if self.status == "active" and participant.get("finished_at") is None:
                    participant["started_at"] = participant.get("started_at") or time.time()
                return participant

        participant = self._create_participant(username, account_username=account_username)
        if self.status == "active":
            participant["started_at"] = time.time()
        return participant

    def active_question_for_participant(self, participant):
        if self.status not in {"active", "finished"} or not self.question_ids:
            return None
        if not participant:
            return None
        current_index = int(participant.get("current_index") or 0)
        current_index = max(0, min(current_index, len(self.question_ids) - 1))
        participant["current_index"] = current_index
        question_id = self.question_ids[current_index]
        return QUESTION_BY_ID.get(question_id)

    def start(self, token):
        self.require_host_by_token(token)
        if not self.question_ids:
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "This online quiz does not have any questions."}),
                content_type="application/json",
            )
        self.status = "active"
        for participant in self.participants.values():
            participant["score"] = 0
            participant["started_at"] = time.time()
            participant["current_index"] = 0
            participant["answers"] = {}
            participant["finished_at"] = None
            participant["results"] = []

    def submit_answer(self, token, question_index, answer_index):
        participant = self.require_participant_by_token(token)
        if self.status != "active":
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "The online quiz is not accepting answers right now."}),
                content_type="application/json",
            )
        if participant.get("finished_at"):
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "This participant has already finished the online quiz."}),
                content_type="application/json",
            )
        if question_index < 0 or question_index >= len(self.question_ids):
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "Choose a valid online quiz question."}),
                content_type="application/json",
            )
        question_id = self.question_ids[question_index]
        question = QUESTION_BY_ID.get(question_id)
        if not question:
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "No active question was found."}),
                content_type="application/json",
            )
        if answer_index < 0 or answer_index >= len(question.get("options", [])):
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "Choose a valid answer option."}),
                content_type="application/json",
            )
        participant.setdefault("answers", {})[question_id] = int(answer_index)

    def navigate(self, token, question_index):
        participant = self.require_participant_by_token(token)
        if self.status not in {"active", "finished"}:
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "Start the online quiz before moving through questions."}),
                content_type="application/json",
            )
        if question_index < 0 or question_index >= len(self.question_ids):
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "Choose a valid online quiz question."}),
                content_type="application/json",
            )
        participant["current_index"] = int(question_index)

    def finish(self, token):
        participant = self.require_participant_by_token(token)
        if self.status != "active":
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "Start the online quiz before finishing it."}),
                content_type="application/json",
            )
        if participant.get("finished_at"):
            return

        answers = participant.setdefault("answers", {})
        recorded_attempts = []
        timestamp = int(time.time() * 1000)
        results = []
        correct_count = 0
        for index, question_id in enumerate(self.question_ids):
            question = QUESTION_BY_ID.get(question_id)
            if not question:
                continue
            selected_index = answers.get(question_id)
            correct = selected_index == int(question.get("answerIndex", -1))
            if correct:
                correct_count += 1
            summary = self.question_summaries[index] if index < len(self.question_summaries) else {}
            results.append({
                "questionId": question["id"],
                "label": summary.get("label", question["id"]),
                "question": question.get("question") or question["id"],
                "category": question.get("category") or "Unknown",
                "topic": question.get("topic") or "Unknown",
                "selectedIndex": selected_index,
                "correctAnswerIndex": int(question.get("answerIndex", -1)),
                "correct": correct,
                "timestamp": timestamp,
                "explanation": question.get("explanation") or "",
                "source": question.get("source") or "",
            })

            record_shared_attempt(
                participant.get("account_username") or participant["id"],
                question["id"],
                correct,
                "online-quiz",
            )

            account_username = participant.get("account_username")
            if account_username and account_username in USER_STORE.get("users", {}):
                recorded_attempts.append(
                    (
                        account_username,
                        {
                            "questionId": question["id"],
                            "category": question.get("category") or "Unknown",
                            "topic": question.get("topic") or "Unknown",
                            "type": question.get("type") or "unknown",
                            "difficulty": int(question.get("difficulty") or 1),
                            "mode": "online-quiz",
                            "correct": correct,
                            "timestamp": timestamp + index,
                        },
                    )
                )

        participant["results"] = results
        participant["score"] = correct_count
        participant["finished_at"] = timestamp
        participant["current_index"] = 0
        for username, attempt in recorded_attempts:
            record_user_attempts(username, [attempt])
        if self.completed_count() >= len(self.participants):
            self.status = "finished"

    def completed_count(self):
        return sum(1 for participant in self.participants.values() if participant.get("finished_at"))

    def participant_analytics(self):
        analytics = []
        for participant in sorted(
            self.participants.values(),
            key=lambda item: (-item["score"], item["joined_at"]),
        ):
            results = list(participant.get("results", []))
            answers = participant.get("answers", {})
            answered_count = sum(1 for answer in answers.values() if answer is not None)
            correct_count = sum(1 for result in results if result.get("correct")) if results else 0
            accuracy = round((correct_count / answered_count) * 100, 1) if answered_count else 0
            analytics.append({
                "id": participant["id"],
                "username": participant["username"],
                "accountUsername": participant.get("account_username"),
                "isHost": participant["is_host"],
                "score": participant["score"],
                "completed": bool(participant.get("finished_at")),
                "answeredCount": answered_count,
                "correctCount": correct_count,
                "accuracy": accuracy,
                "results": results[-50:],
            })
        return analytics

    def public_state(self, viewer_token=None):
        viewer = self.get_participant_by_token(viewer_token) if viewer_token else None
        participants = sorted(
            self.participants.values(),
            key=lambda participant: (-participant["score"], participant["joined_at"]),
        )
        question = self.active_question_for_participant(viewer) if viewer else None
        active = None
        if question:
            current_index = int(viewer.get("current_index") or 0)
            viewer_answers = viewer.get("answers", {}) if viewer else {}
            selected_index = viewer_answers.get(question["id"])
            viewer_answer = None
            if selected_index is not None:
                viewer_answer = {
                    "selectedIndex": selected_index,
                }
                if viewer.get("finished_at"):
                    viewer_answer["correct"] = selected_index == int(question.get("answerIndex", -1))
            active = {
                "questionId": question["id"],
                "number": current_index + 1,
                "total": len(self.question_ids),
                "label": self.question_summaries[current_index].get("label", question["id"])
                if current_index < len(self.question_summaries)
                else question["id"],
                "category": question.get("category"),
                "topic": question.get("topic"),
                "type": question.get("type"),
                "question": question.get("question"),
                "image": question.get("image"),
                "imageAlt": question.get("imageAlt"),
                "imageCaption": question.get("imageCaption"),
                "options": question.get("options", []),
                "answerCount": self.completed_count(),
                "viewerAnswer": viewer_answer,
            }
            if viewer and viewer.get("finished_at"):
                active["correctAnswerIndex"] = question.get("answerIndex")
                active["explanation"] = question.get("explanation")
                active["source"] = question.get("source")

        viewer_progress = None
        if viewer:
            answers = viewer.get("answers", {})
            answered_count = sum(1 for answer in answers.values() if answer is not None)
            results = viewer.get("results", [])
            correct_count = sum(1 for result in results if result.get("correct")) if results else 0
            viewer_progress = {
                "currentIndex": int(viewer.get("current_index") or 0),
                "answeredCount": answered_count,
                "correctCount": correct_count,
                "total": len(self.question_ids),
                "finished": bool(viewer.get("finished_at")),
                "finishedAt": int(viewer.get("finished_at") or 0),
            }

        return {
            "code": self.code,
            "status": self.status,
            "title": self.title,
            "description": self.description,
            "questionCount": len(self.question_ids),
            "completedCount": self.completed_count(),
            "questions": self.question_summaries[:25],
            "activeQuestion": active,
            "viewerProgress": viewer_progress,
            "createdAt": int(self.created_at * 1000),
            "hostParticipantId": self.host_participant_id,
            "participants": [
                {
                    "id": participant["id"],
                    "username": participant["username"],
                    "isHost": participant["is_host"],
                    "connected": participant["connected"],
                    "score": participant["score"],
                    "answeredCount": sum(1 for answer in participant.get("answers", {}).values() if answer is not None),
                    "finished": bool(participant.get("finished_at")),
                }
                for participant in participants
            ],
            "analytics": self.participant_analytics() if viewer and viewer.get("is_host") else [],
        }


SESSIONS = {}
ONLINE_QUIZ_SESSIONS = {}


async def json_body(request):
    try:
        return await request.json()
    except Exception as error:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": f"Invalid JSON: {error}"}),
            content_type="application/json",
        )


async def login_user(request):
    payload = await json_body(request)
    username = sanitize_account_username(payload.get("username"))
    password = str(payload.get("password", ""))
    user = authenticate_user(username, password)

    if not user:
        raise web.HTTPUnauthorized(
            text=json.dumps({"error": "Username or password is incorrect."}),
            content_type="application/json",
        )

    token = secrets.token_urlsafe(32)
    AUTH_TOKENS[token] = username
    user["last_login_at"] = time.time()
    save_user_store()
    return web.json_response({
        "token": token,
        "user": public_user(username, user),
        "performance": user.get("performance", []),
        "placements": user.get("live_placements", []),
        "customQuizzes": normalize_custom_quiz_library(user.get("custom_quizzes", [])),
        "questionEdits": QUESTION_EDIT_STORE.get("edits", {}),
    })


async def logout_user(request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.removeprefix("Bearer ").strip()
        AUTH_TOKENS.pop(token, None)
    return web.json_response({"ok": True})


async def current_user(request):
    migrate_user_store_aliases()
    username = require_auth_username(request)
    user = USER_STORE["users"][username]
    return web.json_response({
        "user": public_user(username, user),
        "performance": user.get("performance", []),
        "placements": user.get("live_placements", []),
        "customQuizzes": normalize_custom_quiz_library(user.get("custom_quizzes", [])),
        "questionEdits": QUESTION_EDIT_STORE.get("edits", {}),
    })


async def instructor_stats(request):
    require_instructor_username(request)
    migrate_user_store_aliases()
    return web.json_response(build_instructor_stats())


async def instructor_custom_quizzes(request):
    username = require_instructor_username(request)
    user = USER_STORE["users"][username]

    if request.method == "GET":
        return web.json_response({
            "customQuizzes": normalize_custom_quiz_library(user.get("custom_quizzes", [])),
        })

    payload = await json_body(request)
    quizzes = normalize_custom_quiz_library(payload.get("customQuizzes", []))
    user["custom_quizzes"] = quizzes
    user["custom_quizzes_updated_at"] = time.time()
    save_user_store()
    return web.json_response({
        "customQuizzes": quizzes,
    })


async def question_edits(request):
    if request.method == "GET":
        require_auth_username(request)
        return web.json_response({
            "questionEdits": QUESTION_EDIT_STORE.get("edits", {}),
        })

    require_instructor_username(request)
    payload = await json_body(request)
    normalized = normalize_question_edit_store(payload.get("questionEdits", {}))
    QUESTION_EDIT_STORE["edits"] = normalized["edits"]
    QUESTION_EDIT_STORE["updated_at"] = int(time.time() * 1000)
    save_question_edit_store()
    return web.json_response({
        "questionEdits": QUESTION_EDIT_STORE.get("edits", {}),
        "saved": True,
    })


async def instructor_import_students(request):
    require_instructor_username(request)
    payload = await json_body(request)
    graduation_year = str(payload.get("graduationYear") or "").strip()
    lines = str(payload.get("students") or "").splitlines()

    if not graduation_year:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "A graduation year is required."}),
            content_type="application/json",
        )

    imported = []
    skipped = []
    for line in lines:
        parsed = parse_student_name_line(line)
        if not parsed:
            if str(line or "").strip():
                skipped.append(str(line).strip())
            continue
        imported.append(
            create_or_update_student(
                parsed["firstName"],
                parsed["lastName"],
                graduation_year,
            )
        )

    if not imported:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "No valid students were found. Use one student per line as First Last."}),
            content_type="application/json",
        )

    save_user_store()
    return web.json_response({
        "imported": imported,
        "skipped": skipped,
        "stats": build_instructor_stats(),
    })


async def instructor_update_student_graduation_year(request):
    require_instructor_username(request)
    payload = await json_body(request)
    username = sanitize_account_username(payload.get("username"))
    graduation_year = str(payload.get("graduationYear") or "").strip()

    if not graduation_year:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "A graduation year is required."}),
            content_type="application/json",
        )

    user = USER_STORE.get("users", {}).get(username)
    if not user or str(user.get("role") or "student") != "student":
        raise web.HTTPNotFound(
            text=json.dumps({"error": "Student account was not found."}),
            content_type="application/json",
        )

    user["graduation_year"] = graduation_year
    save_user_store()
    updated = {
        "username": username,
        "displayName": user.get("display_name") or username,
        "graduationYear": graduation_year,
    }
    return web.json_response({
        "updated": updated,
        "stats": build_instructor_stats(),
    })


async def storage_status(request):
    require_instructor_username(request)
    return web.json_response({
        "storageBackend": "postgres" if DATABASE_STORE_READY else "local-json",
        "databaseConfigured": bool(DATABASE_URL),
        "databaseReady": bool(DATABASE_STORE_READY),
        "postgresDriverAvailable": bool(psycopg and Jsonb),
        "userCount": len(USER_STORE.get("users", {})),
        "sharedQuestionBuckets": len(ATTEMPT_STORE.get("questions", {})),
        "questionEditCount": len(QUESTION_EDIT_STORE.get("edits", {})),
    })


async def create_game(request):
    if not has_live_question_bank():
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "No shared live question bank is loaded on the server yet."}),
            content_type="application/json",
        )

    payload = await json_body(request)
    auth_username = get_auth_username(request)
    requested_username = sanitize_username(payload.get("username"))
    username = live_name_for_account(auth_username, requested_username)
    code = random_code(SESSIONS.keys())
    session = GameSession(code, username, host_account_username=auth_username)
    SESSIONS[code] = session
    host_player = session.players[session.host_player_id]
    return web.json_response(session.create_join_response(host_player))


async def join_game(request):
    payload = await json_body(request)
    auth_username = get_auth_username(request)
    requested_username = sanitize_username(payload.get("username"))
    username = live_name_for_account(auth_username, requested_username)
    code = str(payload.get("code", "")).strip()

    if code not in SESSIONS:
        raise web.HTTPNotFound(
            text=json.dumps({"error": "Game not found. Check the join code and try again."}),
            content_type="application/json",
        )

    session = SESSIONS[code]
    player = session.join(username, account_username=auth_username)
    return web.json_response(session.create_join_response(player))


async def create_online_quiz(request):
    instructor_username = require_instructor_username(request)
    payload = await json_body(request)
    title = " ".join(str(payload.get("title") or "Online Quiz").strip().split())[:120] or "Online Quiz"
    description = " ".join(str(payload.get("description") or "").strip().split())[:240]
    question_ids = []
    seen_ids = set()

    for raw_id in payload.get("questionIds", []):
      question_id = str(raw_id or "").strip()
      if question_id and question_id in QUESTION_BY_ID and question_id not in seen_ids:
          question_ids.append(question_id)
          seen_ids.add(question_id)

    if not question_ids:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Select at least one valid question before hosting an online quiz."}),
            content_type="application/json",
        )

    summary_by_id = {}
    for item in payload.get("questionSummaries", []):
        if not isinstance(item, dict):
            continue
        question_id = str(item.get("id") or "").strip()
        if question_id in seen_ids:
            summary_by_id[question_id] = {
                "id": question_id,
                "label": str(item.get("label") or question_id)[:80],
                "category": str(item.get("category") or QUESTION_BY_ID[question_id].get("category") or "Unknown")[:80],
                "topic": str(item.get("topic") or QUESTION_BY_ID[question_id].get("topic") or "Unknown")[:120],
                "question": str(item.get("question") or QUESTION_BY_ID[question_id].get("question") or question_id)[:400],
            }

    question_summaries = []
    for question_id in question_ids:
        if question_id in summary_by_id:
            question_summaries.append(summary_by_id[question_id])
            continue
        question = QUESTION_BY_ID[question_id]
        question_summaries.append({
            "id": question_id,
            "label": question_id,
            "category": question.get("category") or "Unknown",
            "topic": question.get("topic") or "Unknown",
            "question": question.get("question") or question_id,
        })

    code = random_code(set(SESSIONS.keys()) | set(ONLINE_QUIZ_SESSIONS.keys()))
    host_name = live_name_for_account(instructor_username, "Instructor")
    session = OnlineQuizSession(
        code,
        title,
        description,
        question_ids,
        question_summaries,
        host_name,
        host_account_username=instructor_username,
    )
    ONLINE_QUIZ_SESSIONS[code] = session
    host_participant = session.participants[session.host_participant_id]
    return web.json_response(session.create_join_response(host_participant))


async def join_online_quiz(request):
    payload = await json_body(request)
    auth_username = get_auth_username(request)
    requested_username = sanitize_username(payload.get("username"))
    username = live_name_for_account(auth_username, requested_username)
    code = str(payload.get("code", "")).strip()

    if code not in ONLINE_QUIZ_SESSIONS:
        raise web.HTTPNotFound(
            text=json.dumps({"error": "Online quiz not found. Check the join code and try again."}),
            content_type="application/json",
        )

    session = ONLINE_QUIZ_SESSIONS[code]
    participant = session.join(username, account_username=auth_username)
    return web.json_response(session.create_join_response(participant))


async def online_quiz_state(request):
    code = request.match_info.get("code", "").strip()
    token = request.query.get("token", "").strip()

    if code not in ONLINE_QUIZ_SESSIONS:
        raise web.HTTPNotFound(
            text=json.dumps({"error": "Online quiz not found."}),
            content_type="application/json",
        )

    session = ONLINE_QUIZ_SESSIONS[code]
    if token:
        session.require_participant_by_token(token)

    return web.json_response({"session": session.public_state(token)})


async def online_quiz_action(request):
    code = request.match_info.get("code", "").strip()
    action = request.match_info.get("action", "").strip()
    payload = await json_body(request)
    token = str(payload.get("token") or "").strip()

    if code not in ONLINE_QUIZ_SESSIONS:
        raise web.HTTPNotFound(
            text=json.dumps({"error": "Online quiz not found."}),
            content_type="application/json",
        )

    session = ONLINE_QUIZ_SESSIONS[code]
    if action == "start":
        session.start(token)
    elif action == "answer":
        session.submit_answer(
            token,
            int(payload.get("questionIndex", 0)),
            int(payload.get("answerIndex", -1)),
        )
    elif action == "navigate":
        session.navigate(token, int(payload.get("questionIndex", 0)))
    elif action == "finish":
        session.finish(token)
    else:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "Unsupported online quiz action."}),
            content_type="application/json",
        )

    return web.json_response({"session": session.public_state(token)})


async def record_attempts(request):
    payload = await json_body(request)
    auth_username = get_auth_username(request)
    user_id = auth_username or str(payload.get("userId", "")).strip()
    attempts = payload.get("attempts", [])

    if not user_id:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "A userId is required."}),
            content_type="application/json",
        )

    if not isinstance(attempts, list) or not attempts:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "At least one attempt is required."}),
            content_type="application/json",
        )

    recorded = 0
    for attempt in attempts:
        question_id = str(attempt.get("questionId", "")).strip()
        if not question_id:
            continue
        correct = bool(attempt.get("correct"))
        mode = str(attempt.get("mode", "unknown")).strip() or "unknown"
        record_shared_attempt(user_id, question_id, correct, mode)
        recorded += 1

    userRecorded = 0
    if auth_username:
        userRecorded = record_user_attempts(auth_username, attempts)

    return web.json_response({"recorded": recorded, "userRecorded": userRecorded})


async def question_flags(request):
    username = require_auth_username(request)

    if request.method == "GET":
        return web.json_response(question_flag_payload_for(username))

    payload = await json_body(request)
    question_id = str(payload.get("questionId", "")).strip()
    if not question_id:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": "A questionId is required."}),
            content_type="application/json",
        )

    target_type = str(payload.get("targetType") or "question").strip()
    if target_type not in ("question", "answer", "explanation"):
        target_type = "question"

    answer_index = None
    if target_type == "answer":
        try:
            answer_index = int(payload.get("answerIndex"))
        except Exception:
            answer_index = None
        if answer_index is None or answer_index < 0 or answer_index > 4:
            raise web.HTTPBadRequest(
                text=json.dumps({"error": "A valid answerIndex is required for answer flags."}),
                content_type="application/json",
            )

    flagged = bool(payload.get("flagged"))
    flag_segment = answer_index if answer_index is not None else target_type
    flag_id = f"{username}:{question_id}:{target_type}:{flag_segment}"
    items = QUESTION_FLAG_STORE.setdefault("items", {})
    user = USER_STORE.get("users", {}).get(username, {})

    if flagged:
        now_ms = int(time.time() * 1000)
        question = QUESTION_BY_ID.get(question_id, {})
        existing = items.get(flag_id, {})
        items[flag_id] = {
            "id": flag_id,
            "questionId": question_id,
            "targetType": target_type,
            "answerIndex": answer_index,
            "username": username,
            "displayName": user.get("display_name") or username,
            "category": str(payload.get("category") or question.get("category") or "Unknown")[:120],
            "topic": str(payload.get("topic") or question.get("topic") or "Unknown")[:160],
            "label": str(payload.get("label") or question_id)[:120],
            "question": str(payload.get("question") or question.get("question") or question_id)[:1000],
            "createdAt": existing.get("createdAt") or now_ms,
            "updatedAt": now_ms,
        }
    elif payload.get("resolveAll") and user.get("role") == "instructor":
        for item_id, item in list(items.items()):
            if item.get("questionId") != question_id or item.get("targetType") != target_type:
                continue
            if target_type == "answer" and item.get("answerIndex") != answer_index:
                continue
            items.pop(item_id, None)
    elif user.get("role") == "instructor":
        items.pop(flag_id, None)

    if len(items) > MAX_QUESTION_FLAGS:
        newest = sorted(items.values(), key=lambda item: int(item.get("updatedAt") or item.get("createdAt") or 0), reverse=True)
        QUESTION_FLAG_STORE["items"] = {item["id"]: item for item in newest[:MAX_QUESTION_FLAGS]}

    save_question_flag_store()
    return web.json_response(question_flag_payload_for(username))


async def websocket_handler(request):
    code = request.query.get("code", "").strip()
    token = request.query.get("token", "").strip()

    if code not in SESSIONS:
        return web.Response(status=404, text="Game not found.")

    session = SESSIONS[code]
    player = session.get_player_by_token(token)
    if not player:
        return web.Response(status=403, text="Invalid player token.")

    socket = web.WebSocketResponse(heartbeat=20)
    await socket.prepare(request)

    async with session.lock:
        await session.handle_connect(player["id"], socket)

    async for message in socket:
        if message.type == WSMsgType.TEXT:
            try:
                payload = json.loads(message.data)
            except json.JSONDecodeError:
                async with session.lock:
                    await session.send_error(player["id"], "Could not read that live game message.")
                continue

            action = payload.get("action")
            async with session.lock:
                if action == "start_game":
                    await session.start_game(player["id"])
                elif action == "pick_tile":
                    await session.pick_tile(
                        player["id"],
                        int(payload.get("columnIndex", -1)),
                        int(payload.get("rowIndex", -1)),
                    )
                elif action == "select_answer":
                    await session.select_answer(player["id"], int(payload.get("answerIndex", -1)))
                elif action == "submit_answer":
                    await session.finalize_answers(player["id"])
                elif action == "advance_round":
                    await session.advance_round(player["id"])
                elif action == "terminate_game":
                    await session.terminate_game(player["id"])
                else:
                    await session.send_error(player["id"], "Unsupported live game action.")

        if message.type in {WSMsgType.ERROR, WSMsgType.CLOSE, WSMsgType.CLOSED}:
            break

    async with session.lock:
        await session.handle_disconnect(player["id"])

    return socket


async def serve_app(request):
    requested = request.match_info.get("path", "").strip("/")
    candidate = ROOT / requested if requested else ROOT / "index.html"

    if requested.startswith("api/") or requested == "ws":
        raise web.HTTPNotFound()

    if candidate.is_dir():
        candidate = candidate / "index.html"

    if candidate.exists() and candidate.is_file():
        return web.FileResponse(candidate)

    if requested.lower().endswith(".pdf") or requested.startswith("Book Pdf/"):
        raise web.HTTPNotFound(text="PDF source file was not found on this server.")

    return web.FileResponse(ROOT / "index.html")


async def serve_source_pdf(request):
    book_key = request.match_info.get("book_key", "").strip().lower()
    filename = PDF_SOURCE_FILES.get(book_key)
    if not filename:
        raise web.HTTPNotFound(text="Unknown PDF source.")

    candidate = PDF_SOURCE_ROOT / filename
    if not candidate.exists() or not candidate.is_file():
        raise web.HTTPNotFound(text="PDF source file was not found on this server.")

    return web.FileResponse(candidate)


def create_app():
    app = web.Application()
    app.router.add_post("/api/auth/login", login_user)
    app.router.add_post("/api/auth/logout", logout_user)
    app.router.add_get("/api/auth/me", current_user)
    app.router.add_get("/api/instructor/stats", instructor_stats)
    app.router.add_get("/api/instructor/custom-quizzes", instructor_custom_quizzes)
    app.router.add_put("/api/instructor/custom-quizzes", instructor_custom_quizzes)
    app.router.add_post("/api/instructor/students/import", instructor_import_students)
    app.router.add_post("/api/instructor/students/update-year", instructor_update_student_graduation_year)
    app.router.add_get("/api/system/storage", storage_status)
    app.router.add_post("/api/games/create", create_game)
    app.router.add_post("/api/games/join", join_game)
    app.router.add_post("/api/online-quizzes/create", create_online_quiz)
    app.router.add_post("/api/online-quizzes/join", join_online_quiz)
    app.router.add_get("/api/online-quizzes/{code}", online_quiz_state)
    app.router.add_post("/api/online-quizzes/{code}/{action}", online_quiz_action)
    app.router.add_post("/api/attempts", record_attempts)
    app.router.add_get("/api/question-edits", question_edits)
    app.router.add_put("/api/question-edits", question_edits)
    app.router.add_get("/api/question-flags", question_flags)
    app.router.add_post("/api/question-flags", question_flags)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_get("/source-pdfs/{book_key}.pdf", serve_source_pdf)
    app.router.add_get("/{path:.*}", serve_app)
    return app


if __name__ == "__main__":
    port = int(os.getenv("PORT", "4173"))
    web.run_app(create_app(), host="0.0.0.0", port=port)
