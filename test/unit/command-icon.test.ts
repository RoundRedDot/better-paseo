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
    ["pnpm install", "brand:pnpm"],
    ["java -version", "Coffee"],
    ["./gradlew build", "Coffee"],
    ["go run .", "brand:go"],
    ["cargo test", "brand:rust"],
    ["bundle exec rake", "Gem"],
    ["docker compose up", "brand:docker"],
    ["kubectl get pods", "ShipWheel"],
    ["gh pr view 1", "brand:GitHub"],
    ["paseo agent ls", "brand:Paseo"],
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

  it("only draws marks the daemon serves", () => {
    for (const command of ["python3", "node", "npm", "go", "cargo", "docker", "deno", "tsc", "dotnet", "code", "az", "vite", "bun", "eslint", "nginx", "vim"]) {
      const icon = commandIcon(command)!;
      expect(icon.startsWith("brand:")).toBe(true);
      expect(MARK_IDS.has(icon.toLowerCase())).toBe(true);
      expect(MONO_MARKS.has(icon.toLowerCase())).toBe(true);
    }
  });
});
