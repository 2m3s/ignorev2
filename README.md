# Shadowisabot To-do List

A small, self-hosted task board. Everyone can view tasks; only the owner can create, edit, complete, or delete them after signing in with the administrator password.

## Features

- Public read-only board
- Password-protected owner mode
- Create, edit, delete, and complete tasks
- Priority, category, due date, search, and filters
- Responsive dark UI
- Persistent JSON data file
- No third-party APIs or paid services

## Requirements

- Ubuntu server
- Node.js 20 or newer
- A DNS record for \`todolist.shadowisabot.com\`
- Caddy or another HTTPS reverse proxy for public access

## Run locally

\`\`\`bash
npm install
cp .env.example .env
# Edit .env and set strong ADMIN_PASSWORD and SESSION_SECRET values.
npm start
\`\`\`

The app listens on \`127.0.0.1:3000\` by default. Set \`DATA_DIR\` to a persistent directory. Never commit \`.env\` or the task database.

Generate a session secret with:

\`\`\`bash
openssl rand -hex 32
\`\`\`

Use a unique administrator password of at least 14 characters. Since tasks are public, do not put private information on this board.

## Ubuntu deployment outline

1. Install Node.js 20+ and Git.
2. Clone this repository to \`/opt/shadowisabot-todo\`.
3. Run \`npm install --omit=dev\`.
4. Create \`/etc/shadowisabot-todo.env\` with the settings from \`.env.example\`, using \`DATA_DIR=/var/lib/shadowisabot-todo\`.
5. Run the service under a dedicated unprivileged user, with the data directory writable by that user.
6. Configure Caddy with \`Caddyfile.example\`, reload Caddy, and ensure DNS resolves to your public endpoint.
7. Keep port 3000 private; only Caddy should reach it.

For HTTPS behind Caddy, set \`NODE_ENV=production\` and \`TRUST_PROXY=1\` in the environment file. Caddy should proxy to \`127.0.0.1:3000\`.

### Important security notes

- Do not expose port 3000 directly to the internet.
- Protect the administrator password and session secret.
- Back up \`/var/lib/shadowisabot-todo/tasks.json\`.
- The app is intended for a single owner and a modest task list; its built-in session store is in memory, so signing in again may be required after a restart.
- If using an existing Caddy setup, merge the site block into the existing Caddy configuration rather than replacing the whole file.
