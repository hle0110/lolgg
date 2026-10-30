import datetime as dt
import json
import os
import re
import subprocess
import sys

B = "https://esports-api.lolesports.com/persisted/gw"
F = "https://feed.lolesports.com/livestats/v1"
LEAGUE = "98767975604431411"
MATCHES = {"115660540726095077": "TLAW vs LOS", "115660540726095081": "G2 vs HLE"}
LAST_DAY = "2026-10-31"
KEY = re.search(r'ESPORTS_API_KEY = "([^"]+)"', open("app.js").read()).group(1)


def get(url, with_key=True):
    cmd = ["curl", "-s", "--max-time", "30", "-w", "\n%{http_code}", url]
    if with_key:
        cmd[1:1] = ["-H", f"x-api-key: {KEY}"]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    body, _, code = out.rpartition("\n")
    try:
        data = json.loads(body) if body.strip() else None
    except ValueError:
        data = None
    return int(code or 0), data


def stats_time(seconds_back):
    t = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds_back)
    t = t.replace(microsecond=0, second=t.second - t.second % 10)
    return t.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def main(out_dir):
    now = dt.datetime.now(dt.timezone.utc)
    if now.strftime("%Y-%m-%d") > LAST_DAY:
        print("Past the capture window, nothing to do.")
        return False
    found = None
    for match_id, name in MATCHES.items():
        code, details = get(f"{B}/getEventDetails?hl=en-US&id={match_id}")
        event = ((details or {}).get("data") or {}).get("event") or {}
        games = (event.get("match") or {}).get("games") or []
        print(f"{name} ({match_id}): HTTP {code}, games {[g.get('state') for g in games]}")
        states = [g.get("state") for g in games]
        live = [g for g in games if g.get("state") == "inProgress"]
        between = "completed" in states and "unstarted" in states and not live and (event.get("match") or {}).get("teams")
        if code == 200 and (live or between):
            found = (match_id, name, live[0] if live else None)
            break
    if not found:
        print("No series under way, nothing captured.")
        return False
    match_id, name, game = found
    captured_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    statuses = {}
    statuses["live"], live = get(f"{B}/getLive?hl=en-US")
    statuses["schedule"], schedule = get(f"{B}/getSchedule?hl=en-US&leagueId={LEAGUE}")
    statuses["eventDetails"], event_details = get(f"{B}/getEventDetails?hl=en-US&id={match_id}")
    stats = {"window": {"startingTime": None, "status": None, "body": None}, "details": {"startingTime": None, "status": None, "body": None}}
    missing = []
    for kind in ("window", "details") if game else ():
        for seconds_back in (90, 120):
            starting = stats_time(seconds_back)
            code, body = get(f"{F}/{kind}/{game['id']}?startingTime={starting}", with_key=False)
            stats[kind] = {"startingTime": starting, "status": code, "body": body}
            if code == 200 and body:
                break
        if not (stats[kind]["status"] == 200 and stats[kind]["body"]):
            missing.append(f"stats {kind} (HTTP {stats[kind]['status']})")
    statuses["statsWindow"] = stats["window"]["status"]
    statuses["statsDetails"] = stats["details"]["status"]
    note = (
        f"Captured by GitHub Actions from esports-api.lolesports.com and feed.lolesports.com at {captured_at}, "
        f"Worlds {name}, match {match_id}, "
        + (f"game {game.get('number')} id {game['id']} inProgress, stats startingTime window {stats['window']['startingTime']} details {stats['details']['startingTime']}. " if game else "between games, no game inProgress, no stats requested. ")
        + "Raw responses, nothing edited."
        + (f" Missing: {', '.join(missing)}." if missing else "")
    )
    fixture = {
        "capturedFrom": note,
        "statuses": statuses,
        "live": live,
        "schedule": schedule,
        "eventDetails": event_details,
        "statsWindow": stats["window"]["body"],
        "statsDetails": stats["details"]["body"],
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"worlds_live_{captured_at.replace(':', '').replace('-', '')}.json"), "w") as f:
        json.dump(fixture, f, indent=1, ensure_ascii=False)
    print(note)
    print(json.dumps(statuses))
    return True


if __name__ == "__main__":
    captured = main(sys.argv[1] if len(sys.argv) > 1 else "capture")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"captured={'true' if captured else 'false'}\n")
