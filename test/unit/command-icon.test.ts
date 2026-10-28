import { describe, expect, it } from "vitest";
import { commandIcon, commandProgram } from "../../client/tools/command-icon";
import { MARK_IDS, MONO_MARKS } from "../../client/components/marks";

describe("commandProgram", () => {
  it.each([
    ["python3 - <<'EOF'\nprint(1)\nEOF", "python"],
    ["python3.12 -m pytest", "python"],
    ["/usr/bin/python3 x.py", "python"],
    ["pip3 install x", "pip"],
    ["cd /w && go test ./...", "go"],
    ["FOO=1 BAR=2 node index.js", "node"],
    ["sudo docker ps", "docker"],
    ["(cd app && npm test)", "npm"],
    ["# build first\ncargo build", "cargo"],
    ["export X=1; java -jar a.jar", "java"],
    ["sqlite3 db.sqlite", "sqlite"],
    ["g++ -o a a.cpp", "g++"],
    ["C:\\Python312\\python.exe x.py", "python"],
    ["cd /w", undefined],
    ["echo 'a && cd'; npm test", "echo"],
    ["FOO='a && b' pnpm build && npm test", "pnpm"],
  ])("%s runs %s", (command, program) => {
    expect(commandProgram(command)).toBe(program);
  });
});

describe("commandIcon", () => {
  it.each([
    ["python3 - <<'EOF'", "brand:python"],
    ["uv run pytest", "brand:python"],
    ["node -e 1", "brand:nodejs"],
    ["npx tsc --noEmit", "brand:typescript"],
    ["npx some-unknown-tool", "brand:npm"],
    ["npx playwright test", "brand:playwright"],
    ["npx --yes playwright install", "brand:playwright"],
    ["playwright test --ui", "brand:playwright"],
    ["playwright-cli snapshot", "brand:playwright"],
    ["npx playwright-cli screenshot", "brand:playwright"],
    ["agent-browser snapshot --delta", "AppWindow"],
    ["npx agent-browser open https://example.com", "AppWindow"],
    ["/home/dev/.claude/skills/gstack/browse/dist/browse snapshot", "AppWindow"],
    ["npx remotion render", "Film"],
    ["remotion studio", "Film"],
    ["npx impeccable detect src/", "Palette"],
    ["gstack --help", "Layers"],
    ["npx skills find browser", "Blocks"],
    ["skills add remotion-dev/skills", "Blocks"],
    ["firecrawl scrape https://example.com", "Flame"],
    ["npx firecrawl --help", "Flame"],
    ["bsk evaluate --session x 'document.title' 2>&1 | tail -20", "AppWindow"],
    ["bsk upload --help 2>&1 | head -25", "AppWindow"],
    ["bsk snapshot --session x | head -80", "AppWindow"],
    ["browserskill snapshot --session x", "AppWindow"],
    ["/usr/local/bin/bsk snapshot", "AppWindow"],
    ["cd /w && bsk snapshot", "AppWindow"],
    ["npx browserskill snapshot", "AppWindow"],
    ["pnpm install", "brand:pnpm"],
    ["cd x && npm test", "brand:npm"],
    ["FOO=1 pnpm build || npm test", "brand:pnpm"],
    ["npx 'playwright' test | cat", "brand:playwright"],
    ["npm test; pnpm build; cargo test", "brand:npm"],
    ["java -version", "Coffee"],
    ["./gradlew build", "Coffee"],
    ["go run .", "brand:go"],
    ["cargo test", "brand:rust"],
    ["bundle exec rake", "Gem"],
    ["docker compose up", "brand:docker"],
    ["kubectl get pods", "ShipWheel"],
    ["gh pr view 1", "brand:GitHub"],
    ["paseo agent ls", "brand:Paseo"],
    ["lark-cli skills list", "brand:feishu"],
    ["tccli cvm DescribeInstances", "Cloud"],
    ["hyperframes render", "Clapperboard"],
    ["npx hyperframes check", "Clapperboard"],
    ["cua-driver --help", "MousePointer2"],
    ["cua-studio --help", "MousePointer2"],
    ["lcu --chrome", "MousePointer2"],
    ["rea --help", "Cpu"],
    ["andromeld --help", "brand:android"],
    ["grok --help", "provider:grok"],
    ["pi --help", "provider:pi"],
    ["omp --help", "provider:omp"],
    ["agy --help", "provider:antigravity"],
    ["amp --help", "Zap"],
    ["kiro-cli --help", "Ghost"],
    ["kiro-cli-chat --help", "Ghost"],
    ["/Users/dev/.local/bin/lcu --chrome", "MousePointer2"],
    ["cd /w && lark-cli skills list 2>&1 | head -25", "brand:feishu"],
    ["psql -c 'select 1'", "brand:postgresql"],
    ["brew install jq", "Beer"],
    ["curl -s https://x", "Globe"],
    ["rg useAgent client", "Search"],
    ["xcrun simctl list", "Smartphone"],
    ["xcrun altool --upload-app", "brand:apple"],
    ["xcodebuild -scheme App build", "brand:apple"],
    ["serve-sim --detach -p 3160", "Smartphone"],
    ["adb shell input tap 10 10", "brand:android"],
    ["google-chrome --headless --dump-dom https://x", "brand:chrome"],
    ["chromium --version", "brand:chrome"],
    ["jenkins-cli build deploy", "brand:jenkins"],
    ["jira issue list", "brand:jira"],
    ["ansible-playbook site.yml", "brand:ansible"],
    ["redis-cli ping", "brand:redis"],
    ["kafka-topics.sh --list", "brand:kafka"],
    ["newman run api.json", "brand:postman"],
    ["sonar-scanner -Dsonar.projectKey=x", "brand:sonarqube"],
    ["promtool check rules a.yml", "brand:prometheus"],
    ["datadog-ci junit upload", "Dog"],
    ["cypress run", "brand:cypress"],
    ["claude -p 'fix the test'", "provider:claude"],
    ["codex exec 'lint'", "provider:codex"],
    ["gemini -p hi", "provider:gemini"],
    ["cursor-agent --print hi", "provider:cursor"],
    ["glab mr list", "brand:gitlab"],
    ["npx vitest run", "brand:vitest"],
    ["npx vite build", "brand:vite"],
    ["npx eslint .", "brand:eslint"],
    ["npx prettier --write .", "brand:prettier"],
    ["npx expo start", "brand:expo"],
    ["npx react-native run-ios", "brand:react-native"],
    ["npx jest", "FlaskConical"],
    ["bunx some-unknown-tool", "brand:bun"],
    ["next dev", "brand:nextjs"],
    ["ng serve", "brand:angular"],
    ["firebase deploy", "brand:firebase"],
    ["stripe listen", "brand:stripe"],
    ["ssh rrd-mac-studio uptime", "Server"],
    ["rsync -a a/ b/", "Server"],
    ["tar -xzf a.tgz", "Archive"],
    ["jq .version package.json", "Braces"],
    ["diff -u a b", "FileDiff"],
    ["podman ps", "Container"],
    ["vim README.md", "brand:vim"],
  ])("%s draws %s", (command, icon) => {
    expect(commandIcon(command)).toBe(icon);
  });

  it("leaves a program it does not know to the terminal", () => {
    expect(commandIcon("ls -la")).toBeUndefined();
    expect(commandIcon("echo hi")).toBeUndefined();
  });

  it("uses existing daemon marks for the added services and providers", () => {
    for (const id of ["brand:feishu", "brand:android", "provider:pi", "lobe:grok", "lobe:antigravity"]) {
      expect(MARK_IDS.has(id)).toBe(true);
    }
  });

  it("only draws marks the daemon serves", () => {
    for (const command of ["python3", "node", "npm", "go", "cargo", "docker", "deno", "tsc", "dotnet", "code", "az", "vite", "bun", "eslint", "nginx", "vim"]) {
      const icon = commandIcon(command)!;
      expect(icon.startsWith("brand:")).toBe(true);
      expect(MARK_IDS.has(icon.toLowerCase())).toBe(true);
      expect(MONO_MARKS.has(icon.toLowerCase())).toBe(true);
    }
  });
});
