const pool = require("../config/db.ts");

const githubCallback = async (req, res) => {
  const code = req.query.code;

  if (!code) return res.status(400).send("No code provided");

  try {
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      }
    );

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken)
      return res.status(400).send("Failed to get access token");

    // Fetch GitHub user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const githubUser = await userRes.json();

    const githubId = githubUser.id;
    const username = githubUser.login;

    // Handle signup
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE github_id = $1",
      [githubId]
    );

    if (existingUser.rows.length === 0) {
      // New user → create account
      await pool.query(
        "INSERT INTO users (github_id, username) VALUES ($1, $2)",
        [githubId, username]
      );
      console.log("New user created");
    } else {
      console.log("Existing user logged in");
    }

    req.session.user = {
        accessToken,
        githubId,
        username,
      };

    res.redirect("http://localhost:3000/usermenu/j");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth callback failed");
  }
};

const githubAuth = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = "http://localhost:4001/auth/github/callback";

  const githubAuthUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=repo user`;

  res.redirect(githubAuthUrl);
};

module.exports = { githubAuth, githubCallback };
