---
name: agent-browser
description: >
  Browser automation CLI for AI agents. Fast headless/headed Chromium control
  via CDP. Uses compact accessibility-tree snapshots with @eN refs (~200-400
  tokens per page) instead of raw HTML parsing. Supports navigation, forms,
  screenshots, network interception, multi-tabs, auth persistence, React
  introspection, and Web Vitals. Use when the user needs to interact with
  websites, extract data, take screenshots, automate forms, test web apps,
  or research documentation on the live web.
---

# Agent-Browser Skill

## What is agent-browser?

A **fast native Rust CLI** for browser automation optimized for AI agents.
Unlike Playwright/Puppeteer, it uses Chrome's accessibility tree to produce
compact `@eN` refs — reducing a typical page from 3000-5000 tokens of raw HTML
to ~200-400 tokens of structured refs.

**Key features:**
- Chrome DevTools Protocol (CDP) — no Node.js or Playwright dependency
- Compact `@e1`, `@e2` ... refs from accessibility snapshots
- Multi-tab sessions with labels (`docs`, `app`, `admin`)
- Auth persistence (Chrome profiles, state files, encrypted vault)
- Network interception, mock responses, HAR recording
- React DevTools introspection + Web Vitals metrics
- Screenshots, PDFs, video recording, annotated screenshots

---

## Installation

```bash
# Global (recommended)
npm install -g agent-browser
agent-browser install    # Download Chrome for Testing (first time)

# Project-local
npm install agent-browser
npx agent-browser install

# Homebrew (macOS)
brew install agent-browser
agent-browser install
```

After install, verify:
```bash
agent-browser --version
agent-browser doctor     # Diagnose environment
```

---

## The Core Loop

```bash
agent-browser open <url>          # 1. Open page
agent-browser snapshot -i         # 2. See interactive elements + refs
agent-browser click @e3           # 3. Act on ref
agent-browser snapshot -i         # 4. RE-SNAPSHOT after any page change!
```

**CRITICAL RULE**: Refs become stale the moment the page changes (navigation,
form submit, dynamic re-render, dialog open). Always re-snapshot before the
next ref interaction.

---

## Snapshots: The Heart of the Workflow

### Recommended flags
```bash
agent-browser snapshot -i         # Interactive elements only (buttons, links, inputs)
agent-browser snapshot -i -u      # Interactive + include href URLs on links
agent-browser snapshot -i -c      # Compact (remove empty structural nodes)
agent-browser snapshot -i -d 3    # Cap depth at 3 levels
agent-browser snapshot -s "#main" # Scope to CSS selector
agent-browser snapshot -i --json  # Machine-readable JSON output
```

### Output format
```
Page: Example - Log in
URL: https://example.com/login

@e1 [heading] "Log in"
@e2 [form]
  @e3 [input type="email"] placeholder="Email"
  @e4 [input type="password"] placeholder="Password"
@e5 [button type="submit"] "Continue"
@e6 [link] "Forgot password?"
```

### Annotated screenshots
Multimodal models can use visual overlays:
```bash
agent-browser screenshot --annotate page.png
# Output includes: [1] @e1 button "Submit", [2] @e2 link "Home" ...
agent-browser click @e2            # Works immediately after annotate
```

---

## Navigation

```bash
agent-browser open <url>          # Navigate (auto-prepends https://)
agent-browser open                # Launch browser, stay on about:blank
agent-browser back
agent-browser forward
agent-browser reload
agent-browser close               # Close current session
agent-browser close --all         # Close every session
```

### Pre-navigation setup (SSR debug, auth cookies, init scripts)
Launch browser first, stage state, then navigate:
```bash
agent-browser batch \
  '["open"]' \
  '["cookies","set","--curl","cookies.curl","--domain","localhost"]' \
  '["navigate","http://localhost:3000"]'
```

---

## Element Interaction

Use `@eN` refs from `snapshot` output, OR traditional CSS selectors, OR
semantic locators.

### By ref (fastest, ~200 tokens)
```bash
agent-browser click @e1
agent-browser click @e1 --new-tab
agent-browser dblclick @e1
agent-browser fill @e2 "text"     # Clear then type
agent-browser type @e2 "text"     # Type without clearing
agent-browser press Enter
agent-browser press Control+a
agent-browser hover @e1
agent-browser focus @e1
agent-browser check @e1
agent-browser uncheck @e1
agent-browser select @e1 "value"  # Dropdown
agent-browser select @e1 "a" "b"  # Multi-select
agent-browser upload @e1 file.pdf
agent-browser download @e1 ./file.pdf
agent-browser drag @e1 @e2        # Drag src to dst
agent-browser scrollintoview @e1  # Scroll element into view
agent-browser scroll down 500     # Page scroll (default 300px)
```

### Semantic locators (no snapshot needed)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find text "Sign In" click --exact
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search" type "query"
agent-browser find alt "Logo" click
agent-browser find testid "submit-btn" click
agent-browser find first ".item" click
agent-browser find nth 2 "a" hover
```

---

## Getting Information

```bash
agent-browser get text @e1        # Visible text
agent-browser get html @e1        # innerHTML
agent-browser get value @e1       # Input value
agent-browser get attr @e1 href   # Any attribute
agent-browser get title           # Page title
agent-browser get url             # Current URL
agent-browser get count ".item"   # Count matching elements
agent-browser get box @e1         # Bounding box
agent-browser get styles @e1      # Computed styles
```

### Check state
```bash
agent-browser is visible @e1
agent-browser is enabled @e1
agent-browser is checked @e1
```

---

## Waiting

```bash
agent-browser wait @e1            # Wait for element to be visible
agent-browser wait 2000           # Wait milliseconds
agent-browser wait --text "Success"
agent-browser wait --url "**/dashboard"
agent-browser wait --load networkidle
agent-browser wait --fn "window.ready === true"
agent-browser wait "#spinner" --state hidden   # Wait for disappearance
```

Load states: `load`, `domcontentloaded`, `networkidle`

---

## Sessions & Multi-Tab Workflows

### Isolated sessions
```bash
agent-browser --session agent1 open site-a.com
agent-browser --session agent2 open site-b.com
agent-browser session list
```

### Named tabs
```bash
agent-browser tab new --label docs https://docs.example.com
agent-browser tab new --label app  https://app.example.com
agent-browser tab docs             # Switch to docs tab
agent-browser snapshot -i          # Refs belong to active tab
agent-browser click @e1            # Click on docs tab
agent-browser tab app              # Switch to app tab
agent-browser tab close docs       # Close by label
```

Tab IDs are stable strings (`t1`, `t2`, `t3`). Labels are user-assigned and
interchangeable with IDs.

---

## Authentication Patterns

### 1. Chrome profile reuse (fastest)
```bash
agent-browser profiles                           # List Chrome profiles
agent-browser --profile Default open https://gmail.com
```

### 2. Persistent profile directory
```bash
agent-browser --profile ~/.myapp-profile open myapp.com
# Login once → all subsequent runs are authenticated
```

### 3. Session auto-persistence
```bash
agent-browser --session-name twitter open twitter.com
# Auto-saves/restores cookies + localStorage in ~/.agent-browser/sessions/
```

### 4. Import from running Chrome
```bash
# 1. Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# 2. Log in manually, then grab state
agent-browser --auto-connect state save ./auth.json

# 3. Reuse in automation
agent-browser --state ./auth.json open https://app.example.com/dashboard
```

### 5. Encrypted auth vault
```bash
echo "pass" | agent-browser auth save github \
  --url https://github.com/login --username user --password-stdin

agent-browser auth login github    # LLM never sees the password
```

### 6. Cookie-based auth
```bash
agent-browser cookies set session_token "abc123xyz"
agent-browser open https://app.example.com/dashboard
```

### 7. HTTP Basic Auth
```bash
agent-browser set credentials username password
agent-browser open https://protected.example.com
```

---

## Network Interception

```bash
# Mock an API response
agent-browser network route "**/api/users" --body '{"users":[]}'

# Block requests
agent-browser network route "**/*.png" --abort
agent-browser network route "*" --abort --resource-type script

# View tracked requests
agent-browser network requests
agent-browser network requests --filter api --method POST --status 2xx

# HAR recording
agent-browser network har start
# ... actions ...
agent-browser network har stop ./trace.har
```

---

## Screenshots, PDFs, Video

```bash
agent-browser screenshot [path]          # Screenshot
agent-browser screenshot --full [path]   # Full page
agent-browser screenshot --annotate      # With numbered ref labels
agent-browser pdf output.pdf             # Save as PDF

# Video recording
agent-browser record start ./demo.webm
# ... actions ...
agent-browser record stop
```

### Screenshot options
```bash
agent-browser --screenshot-dir ./shots \
  --screenshot-format jpeg \
  --screenshot-quality 80 \
  screenshot page.jpg
```

---

## Browser Settings

```bash
agent-browser set viewport 1920 1080     # Viewport
agent-browser set viewport 1920 1080 2   # Retina (2x scale)
agent-browser set device "iPhone 14"     # Emulate device
agent-browser set geo 37.7749 -122.4194  # Geolocation
agent-browser set offline on             # Toggle offline
agent-browser set headers '{"X-Key":"v"}'
agent-browser set credentials user pass  # HTTP basic auth
agent-browser set media dark             # Dark mode
agent-browser set media light reduced-motion
```

---

## JavaScript Execution

```bash
agent-browser eval "document.title"      # Simple expression
agent-browser eval -b "<base64>"         # Base64-encoded JS (safer for special chars)
cat <<'EOF' | agent-browser eval --stdin
const links = document.querySelectorAll('a');
Array.from(links).map(a => a.href);
EOF
```

---

## React & Web Vitals

Requires `--enable react-devtools` at launch:

```bash
agent-browser open --enable react-devtools https://my-react-app.com
agent-browser react tree                 # Component tree
agent-browser react inspect <fiberId>    # Props, hooks, state, source
agent-browser react renders start
agent-browser react renders stop --json
agent-browser react suspense --only-dynamic
agent-browser vitals --json              # LCP/CLS/TTFB/FCP/INP
```

---

## Batch Execution

Reduce per-command startup overhead:

```bash
# Argument mode
agent-browser batch \
  "open https://example.com" \
  "snapshot -i" \
  "click @e1" \
  "screenshot result.png"

# JSON stdin mode
echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"],
  ["screenshot", "result.png"]
]' | agent-browser batch --json
```

---

## Diff / Regression Testing

```bash
# Snapshot diff
agent-browser diff snapshot
agent-browser diff snapshot --baseline before.txt

# Visual diff
agent-browser diff screenshot --baseline before.png -o diff.png

# Compare two URLs
agent-browser diff url https://v1.com https://v2.com --screenshot
```

---

## Debugging

```bash
agent-browser --headed open example.com  # Show browser window
agent-browser --cdp 9222 snapshot        # Connect via CDP port
agent-browser highlight @e1              # Highlight element
agent-browser inspect                    # Open Chrome DevTools
agent-browser console                    # View console messages
agent-browser console --json             # JSON output with CDP args
agent-browser errors                     # Page errors
agent-browser trace start                # Start trace
agent-browser trace stop trace.zip       # Save trace
agent-browser profiler start
agent-browser profiler stop profile.json
```

---

## Iframes

Refs inside iframes are automatically inlined in snapshots (one level deep).
Interact directly:

```bash
agent-browser snapshot -i
# @e2 [Iframe] "payment-frame"
#   @e3 [input] "Card number"
#   @e4 [button] "Pay"

agent-browser fill @e3 "4111111111111111"
agent-browser click @e4

# Or switch frame context explicitly
agent-browser frame @e2
agent-browser snapshot -i
agent-browser frame main
```

---

## Global Options & Environment Variables

| Flag / Env Var | Description |
|---------------|-------------|
| `--session <name>` / `AGENT_BROWSER_SESSION` | Isolated browser session |
| `--session-name <name>` / `AGENT_BROWSER_SESSION_NAME` | Auto-save/restore state |
| `--profile <name\|path>` / `AGENT_BROWSER_PROFILE` | Chrome profile reuse |
| `--state <path>` / `AGENT_BROWSER_STATE` | Load saved state JSON |
| `--headed` / `AGENT_BROWSER_HEADED` | Show browser window |
| `--json` | JSON output for agents |
| `--annotate` / `AGENT_BROWSER_ANNOTATE` | Annotated screenshots |
| `--proxy <url>` / `AGENT_BROWSER_PROXY` | Proxy server |
| `--ignore-https-errors` | Ignore SSL cert errors |
| `--enable react-devtools` / `AGENT_BROWSER_ENABLE` | Enable features |
| `--executable-path <p>` / `AGENT_BROWSER_EXECUTABLE_PATH` | Custom Chrome |
| `--args <args>` / `AGENT_BROWSER_ARGS` | Browser launch args |
| `--user-agent <ua>` / `AGENT_BROWSER_USER_AGENT` | Custom UA |
| `--content-boundaries` / `AGENT_BROWSER_CONTENT_BOUNDARIES` | Wrap output in delimiters |
| `--max-output <n>` / `AGENT_BROWSER_MAX_OUTPUT` | Limit output chars |
| `--allowed-domains <list>` / `AGENT_BROWSER_ALLOWED_DOMAINS` | Domain allowlist |
| `AGENT_BROWSER_ENCRYPTION_KEY` | 64-char hex for AES-256-GCM |

---

## Common Workflows

### Research / documentation extraction
```bash
agent-browser open https://docs.example.com
agent-browser snapshot -i -c
cd /tmp/agent-browser-install  # project-local npx usage
npx agent-browser open https://zardui.com/docs/components/button
npx agent-browser snapshot -i
```

### Form automation
```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i            # Verify logged in
```

### Screenshot pipeline
```bash
agent-browser open https://example.com
agent-browser set viewport 1920 1080
agent-browser wait --load networkidle
agent-browser screenshot --full ./page.png
agent-browser close
```

### Data extraction
```bash
agent-browser open https://example.com/list
agent-browser wait --load networkidle
agent-browser eval --stdin <<'EOF'
Array.from(document.querySelectorAll('.item')).map(el => ({
  title: el.querySelector('h2')?.textContent,
  price: el.querySelector('.price')?.textContent
}));
EOF
```

---

## Best Practices

1. **Always snapshot before interacting** — refs don't exist until you snapshot.
2. **Re-snapshot after any page change** — navigation, submits, dynamic updates invalidate all refs.
3. **Use `-i` flag** — interactive-only snapshots are much smaller and clearer.
4. **Use semantic locators** (`find role button click --name "Submit"`) when you don't want the overhead of maintaining refs across commands.
5. **Use `--session-name`** for auth-heavy workflows to avoid re-logging in.
6. **Use `batch`** for multi-step workflows to avoid per-command startup cost.
7. **Don't commit state files** — they contain session tokens. Use `AGENT_BROWSER_ENCRYPTION_KEY`.
8. **Use `--headed`** when debugging visual issues or when the page behaves differently headless.
9. **Scope snapshots** (`-s "#main"`) on complex pages to reduce token usage.
10. **Use `agent-browser skills get core --full`** for the CLI's own built-in skill reference.

---

## External References

- **GitHub**: https://github.com/vercel-labs/agent-browser
- **Built-in skill**: `agent-browser skills get core --full`
- **Authentication patterns**: `agent-browser skills get core --full` → references/authentication.md
- **Command reference**: `agent-browser skills get core --full` → references/commands.md
- **Session management**: `agent-browser skills get core --full` → references/session-management.md
