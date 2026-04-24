import sqlite3
import os
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from functools import wraps

app = Flask(__name__)
app.secret_key = "cricket_secret_key_123" # In production, use a strong random key

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'favicon.png', mimetype='image/png')

# Default 11-player names
DEFAULT_PLAYERS = [f"Player {i}" for i in range(1, 12)]

# Store match data (temporary, in memory)
match = {
    "score": 0,
    "wickets": 0,
    "balls": 0,
    "batsman1": {"name": DEFAULT_PLAYERS[0], "runs": 0, "balls": 0},
    "batsman2": {"name": DEFAULT_PLAYERS[1], "runs": 0, "balls": 0},
    "striker": "batsman1",
    "next_player_num": 2,
    "partnership": {"runs": 0, "balls": 0},
    "last_balls": [],
    "team1": "Team Alpha",
    "team2": "Team Beta",
    "player_names": list(DEFAULT_PLAYERS),
    "max_overs": 20,
    "innings_complete": False,
    "fours": 0,
    "sixes": 0,
    "dots": 0,
    "innings": 1,
    "target": None,
    "team1_score": None,
    "team1_wickets": None,
    "match_result": ""
}

# Login Required Decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function

@app.route("/")
@login_required
def home():
    return render_template("index.html", username=session.get("user"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        data = request.form
        username = data.get("username")
        password = data.get("password")
        
        conn = sqlite3.connect("matches.db")
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE username = ? AND password = ?", (username, password))
        user = cursor.fetchone()
        conn.close()
        
        if user:
            session["user"] = username
            return redirect(url_for("home"))
        else:
            return "Invalid credentials", 401
            
    return render_template("login.html")

@app.route("/register", methods=["POST"])
def register():
    data = request.form
    username = data.get("username")
    password = data.get("password")
    
    try:
        conn = sqlite3.connect("matches.db")
        cursor = conn.cursor()
        cursor.execute("INSERT INTO users (username, password) VALUES (?, ?)", (username, password))
        conn.commit()
        conn.close()
        return redirect(url_for("login"))
    except Exception as e:
        return f"Registration failed: {str(e)}", 400

@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect(url_for("login"))

@app.route("/update", methods=["POST"])
@login_required
def update():
    data = request.json
    action = data.get("action")
    max_overs = match.get("max_overs", 0)  # 0 = unlimited

    # Block scoring if innings already complete
    if match.get("innings_complete"):
        return jsonify(match)

    if action == "run":
        runs = data.get("value", 0)
        match["score"] += runs
        match["balls"] += 1

        # Update batsman
        current_batsman = match["striker"]
        match[current_batsman]["runs"] += runs
        match[current_batsman]["balls"] += 1

        # Update partnership
        match["partnership"]["runs"] += runs
        match["partnership"]["balls"] += 1

        # Track last 12 balls
        match["last_balls"].append(runs)
        if len(match["last_balls"]) > 12:
            match["last_balls"].pop(0)

        # Update Boundary/Dot counts
        if runs == 4: match["fours"] += 1
        elif runs == 6: match["sixes"] += 1
        elif runs == 0: match["dots"] += 1

        # STRIKE ROTATION
        if runs % 2 != 0:
            match["striker"] = "batsman2" if match["striker"] == "batsman1" else "batsman1"
        if match["balls"] % 6 == 0:
            match["striker"] = "batsman2" if match["striker"] == "batsman1" else "batsman1"

        # Check overs limit
        if max_overs > 0 and match["balls"] >= max_overs * 6:
            match["innings_complete"] = True

    elif action == "wicket":
        if match["wickets"] < 10:
            match["wickets"] += 1
            match["balls"] += 1

            # Track wicket in last_balls
            match["last_balls"].append("W")
            if len(match["last_balls"]) > 12:
                match["last_balls"].pop(0)

            # Reset partnership on wicket
            match["partnership"] = {"runs": 0, "balls": 0}

            # Pick next player name from lineup
            nxt = match["next_player_num"]
            names = match["player_names"]
            new_name = names[nxt] if nxt < len(names) else f"Player {nxt + 1}"

            # Replace current striker with new player
            current_striker_key = match["striker"]
            match[current_striker_key] = {
                "name": new_name,
                "runs": 0,
                "balls": 0
            }
            match["next_player_num"] += 1

            # All out
            if match["wickets"] >= 10:
                match["innings_complete"] = True

    elif action == "extra":
        etype = data.get("value") # "wide" or "noball"
        match["score"] += 1
        # No ball/Wide do NOT increment match["balls"]
        
        # Track in last_balls
        label = "WD" if etype == "wide" else "NB"
        match["last_balls"].append(label)
        if len(match["last_balls"]) > 12:
            match["last_balls"].pop(0)

        # On No Ball, batsman still gets a ball faced? 
        # Usually extras don't count towards batsman's balls, but runs scored on NB do.
        # For simple extras, we just add to score.

    # Check match end condition for 2nd innings
    if match["innings"] == 2 and match["target"] is not None:
        if match["score"] >= match["target"]:
            match["innings_complete"] = True
            match["match_result"] = f"{match['team2']} won by {10 - match['wickets']} wickets"
        elif match["innings_complete"]: # Overs out or all out
            if match["score"] < match["target"] - 1:
                match["match_result"] = f"{match['team1']} won by {match['target'] - 1 - match['score']} runs"
            elif match["score"] == match["target"] - 1:
                match["match_result"] = "Match Tied"

    return jsonify(match)

@app.route("/switch_striker", methods=["POST"])
@login_required
def switch_striker():
    match["striker"] = "batsman2" if match["striker"] == "batsman1" else "batsman1"
    return jsonify(match)

@app.route("/get")
@login_required
def get_score():
    return jsonify(match)

@app.route("/start_2nd_innings", methods=["POST"])
@login_required
def start_2nd_innings():
    if match["innings"] == 1 and match["innings_complete"]:
        match["team1_score"] = match["score"]
        match["team1_wickets"] = match["wickets"]
        match["target"] = match["score"] + 1
        match["innings"] = 2
        
        # Reset for 2nd innings
        match["score"] = 0
        match["wickets"] = 0
        match["balls"] = 0
        match["batsman1"] = {"name": match["player_names"][0], "runs": 0, "balls": 0}
        match["batsman2"] = {"name": match["player_names"][1], "runs": 0, "balls": 0}
        match["striker"] = "batsman1"
        match["next_player_num"] = 2
        match["partnership"] = {"runs": 0, "balls": 0}
        match["last_balls"] = []
        match["innings_complete"] = False
        match["fours"] = 0
        match["sixes"] = 0
        match["dots"] = 0
        match["match_result"] = ""
        
    return jsonify(match)

@app.route("/reset", methods=["POST"])
@login_required
def reset():
    global match
    data = request.json or {}
    t1 = data.get("team1", "Team Alpha")
    t2 = data.get("team2", "Team Beta")
    names = data.get("player_names", match.get("player_names", list(DEFAULT_PLAYERS)))
    max_ov = data.get("max_overs", match.get("max_overs", 20))
    match = {
        "score": 0,
        "wickets": 0,
        "balls": 0,
        "batsman1": {"name": names[0], "runs": 0, "balls": 0},
        "batsman2": {"name": names[1], "runs": 0, "balls": 0},
        "striker": "batsman1",
        "next_player_num": 2,
        "partnership": {"runs": 0, "balls": 0},
        "last_balls": [],
        "team1": t1,
        "team2": t2,
        "player_names": names,
        "max_overs": max_ov,
        "innings_complete": False,
        "fours": 0,
        "sixes": 0,
        "dots": 0,
        "innings": 1,
        "target": None,
        "team1_score": None,
        "team1_wickets": None,
        "match_result": ""
    }
    return jsonify(match)

@app.route("/set_players", methods=["POST"])
@login_required
def set_players():
    global match
    data = request.json or {}
    names = data.get("player_names", list(DEFAULT_PLAYERS))
    # Pad to 11 if fewer provided
    while len(names) < 11:
        names.append(f"Player {len(names) + 1}")
    match["player_names"] = names
    # Update current batsmen names
    match["batsman1"]["name"] = names[0]
    match["batsman2"]["name"] = names[1]
    match["next_player_num"] = 2
    return jsonify(match)

@app.route("/set_overs", methods=["POST"])
@login_required
def set_overs():
    data = request.json or {}
    overs = data.get("max_overs", 20)
    try:
        overs = int(overs)
        if overs < 0:
            overs = 0
    except (ValueError, TypeError):
        overs = 20
    match["max_overs"] = overs
    match["innings_complete"] = False  # re-open innings if overs changed
    return jsonify(match)

def init_db():
    conn = sqlite3.connect("matches.db")
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            score TEXT,
            overs TEXT,
            runrate TEXT,
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    """)

    conn.commit()
    conn.close()

@app.route("/save", methods=["POST"])
@login_required
def save_match():
    overs = str(match["balls"] // 6) + "." + str(match["balls"] % 6)
    runrate = str(round(match["score"] / (match["balls"]/6), 2)) if match["balls"] > 0 else "0"

    conn = sqlite3.connect("matches.db")
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO matches (score, overs, runrate) VALUES (?, ?, ?)",
        (f"{match['score']}/{match['wickets']}", overs, runrate)
    )
    conn.commit()
    conn.close()
    return {"message": "Saved"}

@app.route("/history")
@login_required
def history():
    conn = sqlite3.connect("matches.db")
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM matches ORDER BY id DESC")
    data = cursor.fetchall()
    conn.close()
    return jsonify(data)

if __name__ == "__main__":
    init_db()
    app.run(debug=True)
