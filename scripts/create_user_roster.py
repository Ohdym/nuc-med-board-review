#!/usr/bin/env python3
import argparse
import csv
import json
import secrets
import string
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server

PASSWORD_ALPHABET = string.ascii_letters + string.digits


def generate_password(length):
    return "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(length))


def build_roster(count, prefix, password_length):
    rows = []
    users = {}

    for index in range(1, count + 1):
        username = f"{prefix}{index:02d}"
        password = generate_password(password_length)
        users[username] = {
            **server.hash_password(password),
            "display_name": f"Student {index:02d}",
            "performance": [],
            "created_at": time.time(),
        }
        rows.append({
            "username": username,
            "password": password,
            "display_name": users[username]["display_name"],
        })

    return users, rows


def main():
    parser = argparse.ArgumentParser(description="Create a local roster of hashed testing accounts.")
    parser.add_argument("--count", type=int, default=50, help="Number of accounts to create.")
    parser.add_argument("--prefix", default="student", help="Username prefix, for example student -> student01.")
    parser.add_argument("--password-length", type=int, default=12, help="Generated password length.")
    parser.add_argument("--overwrite", action="store_true", help="Replace an existing user store.")
    parser.add_argument("--store", type=Path, default=server.USER_STORE_PATH, help="Path for the hashed user store.")
    parser.add_argument(
        "--passwords",
        type=Path,
        default=ROOT / ".user_passwords.csv",
        help="Private CSV path for the generated plaintext passwords.",
    )
    args = parser.parse_args()

    if args.count < 1:
        raise SystemExit("--count must be at least 1")
    if args.password_length < 10:
        raise SystemExit("--password-length must be at least 10")
    if args.store.exists() and not args.overwrite:
        raise SystemExit(f"{args.store} already exists. Re-run with --overwrite to replace it.")

    users, rows = build_roster(args.count, args.prefix.strip().lower(), args.password_length)
    store = {"users": users}

    args.store.parent.mkdir(parents=True, exist_ok=True)
    args.store.write_text(json.dumps(store, indent=2))

    args.passwords.parent.mkdir(parents=True, exist_ok=True)
    with args.passwords.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["username", "password", "display_name"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Created {len(rows)} users in {args.store}")
    print(f"Private password roster written to {args.passwords}")
    print("Do not commit or publish the password CSV.")


if __name__ == "__main__":
    main()
