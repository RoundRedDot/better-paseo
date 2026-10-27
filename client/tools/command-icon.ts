import { cachedLookup } from "./lookup-cache";
import { splitShellCommands } from "./shell-command";

/**
 * Programs whose shell calls draw the program's icon instead of the terminal,
 * by the program's name with any version suffix dropped (`python3.12` is
 * `python`, `pip3` is `pip`). A `brand:*` icon is the program's mark; a
 * program with no line mark of its own draws the Lucide icon for what it is.
 */
const PROGRAM_ICONS: Readonly<Record<string, string>> = {
  ...programs("brand:python", "python", "pip", "uv", "uvx", "poetry", "pytest", "ipython", "conda", "pipx", "ruff", "mypy"),
  ...programs("brand:nodejs", "node"),
  ...programs("brand:npm", "npm", "npx"),
  ...programs("brand:pnpm", "pnpm", "pnpx"),
  ...programs("brand:yarn", "yarn"),
  ...programs("brand:deno", "deno"),
  ...programs("brand:typescript", "tsc", "tsx", "ts-node"),
  ...programs("Coffee", "java", "javac", "jar", "mvn", "mvnw", "gradle", "gradlew"),
  ...programs("brand:kotlin", "kotlin", "kotlinc"),
  ...programs("brand:go", "go", "gofmt"),
  ...programs("brand:rust", "cargo", "rustc", "rustup"),
  ...programs("Gem", "ruby", "gem", "bundle", "bundler", "rake", "rails", "irb"),
  ...programs("brand:php", "php", "composer"),
  ...programs("brand:swift", "swift", "swiftc"),
  ...programs("brand:apple", "xcodebuild", "xcrun", "pod"),
  ...programs("Smartphone", "simctl", "serve-sim", "ios-deploy"),
  ...programs("brand:cpp", "gcc", "g++", "clang", "clang++", "cmake"),
  ...programs("brand:csharp", "dotnet"),
  ...programs("brand:flutter", "flutter", "dart"),
  ...programs("brand:android", "adb", "emulator", "avdmanager", "sdkmanager"),
  ...programs("brand:docker", "docker", "docker-compose"),
  ...programs("ShipWheel", "kubectl", "helm", "minikube", "kind", "k9s"),
  ...programs("brand:terraform", "terraform"),
  ...programs("brand:aws", "aws"),
  ...programs("brand:google-cloud", "gcloud", "gsutil"),
  ...programs("brand:azure", "az"),
  ...programs("brand:vercel", "vercel"),
  ...programs("brand:cloudflare", "wrangler"),
  ...programs("brand:supabase", "supabase"),
  ...programs("brand:prisma", "prisma"),
  ...programs("brand:postgresql", "psql", "pg_dump", "pg_restore"),
  ...programs("brand:mysql", "mysql", "mysqldump"),
  ...programs("brand:mongodb", "mongosh", "mongo"),
  ...programs("Feather", "sqlite"),
  ...programs("brand:GitHub", "gh"),
  ...programs("brand:gitlab", "glab"),
  ...programs("brand:Paseo", "paseo"),
  // Coding agents draw the same provider mark as the agent rows that run them.
  ...programs("provider:claude", "claude"),
  ...programs("provider:codex", "codex"),
  ...programs("provider:gemini", "gemini"),
  ...programs("provider:opencode", "opencode"),
  ...programs("provider:cursor", "cursor-agent"),
  ...programs("provider:copilot", "copilot"),
  ...programs("provider:ollama", "ollama"),
  ...programs("provider:omp", "omp"),
  ...programs("brand:powershell", "pwsh", "powershell"),
  ...programs("brand:vscode", "code"),
  ...programs("Beer", "brew"),
  ...programs("Globe", "curl", "wget", "http", "xh"),
  ...programs("Hammer", "make"),
  ...programs("Clapperboard", "ffmpeg", "ffprobe"),
  ...programs("Search", "rg", "grep", "find", "fd", "ag"),
  ...programs("brand:jenkins", "jenkins", "jenkins-cli"),
  ...programs("brand:jira", "jira"),
  ...programs("brand:ansible", "ansible", "ansible-playbook", "ansible-galaxy", "ansible-vault", "ansible-inventory"),
  ...programs("brand:circleci", "circleci"),
  ...programs("brand:sonarqube", "sonar-scanner"),
  ...programs("brand:grafana", "grafana", "grafana-cli"),
  ...programs("brand:prometheus", "prometheus", "promtool"),
  ...programs("Dog", "datadog-ci"),
  ...programs("brand:postman", "postman", "newman"),
  ...programs("brand:redis", "redis-cli", "redis-server"),
  ...programs("brand:kafka", "kcat", "kafkacat", "kafka-topics.sh", "kafka-console-consumer.sh", "kafka-console-producer.sh"),
  ...programs("brand:cypress", "cypress"),
  ...programs("brand:storybook", "storybook"),
  ...programs("brand:playwright", "playwright"),
  ...programs("brand:puppeteer", "puppeteer"),
  ...programs("brand:chrome", "google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"),
  // Front-end and JavaScript tooling.
  ...programs("brand:bun", "bun", "bunx"),
  ...programs("brand:vite", "vite"),
  ...programs("brand:vitest", "vitest"),
  ...programs("FlaskConical", "jest", "mocha"),
  ...programs("brand:eslint", "eslint"),
  ...programs("brand:prettier", "prettier"),
  ...programs("brand:webpack", "webpack", "webpack-cli"),
  ...programs("brand:turborepo", "turbo"),
  ...programs("brand:nextjs", "next"),
  ...programs("brand:nuxt", "nuxt", "nuxi"),
  ...programs("brand:react-native", "react-native"),
  ...programs("brand:expo", "expo", "eas"),
  ...programs("brand:angular", "ng"),
  ...programs("brand:astro", "astro"),
  ...programs("brand:svelte", "sv", "svelte-kit"),
  ...programs("brand:vue", "vue"),
  ...programs("brand:tailwind", "tailwindcss"),
  ...programs("Atom", "electron", "electron-builder", "electron-forge"),
  // Frameworks, hosting and services.
  ...programs("brand:django", "django-admin"),
  ...programs("brand:laravel", "laravel"),
  ...programs("brand:jupyter", "jupyter", "jupyter-lab", "jupyter-notebook"),
  ...programs("brand:firebase", "firebase"),
  ...programs("brand:netlify", "netlify", "ntl"),
  ...programs("brand:heroku", "heroku"),
  ...programs("brand:stripe", "stripe"),
  ...programs("brand:nginx", "nginx"),
  ...programs("Container", "podman", "podman-compose"),
  // Everyday utilities, by what they do.
  ...programs("brand:vim", "vim", "vi", "gvim"),
  ...programs("Server", "ssh", "scp", "sftp", "rsync", "mosh"),
  ...programs("Archive", "tar", "zip", "unzip", "gzip", "gunzip", "7z", "xz"),
  ...programs("Braces", "jq", "yq"),
  ...programs("FileDiff", "diff", "colordiff", "difft"),
  ...programs("ExternalLink", "open", "xdg-open"),
};

/**
 * Runners that fetch and run another program (`npx playwright test`). The row
 * draws that program's icon when it is one listed here, else the runner's.
 */
const RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx"]);
/** Subcommands that name a different tool than their program: `xcrun simctl` drives the simulator. */
const SUBCOMMAND_ICONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  xcrun: { simctl: "Smartphone" },
};

function programs(icon: string, ...names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, icon]));
}

/** Words that set up a command rather than name the program it runs. */
const PREFIXES = new Set(["sudo", "env", "time", "exec", "nohup", "command", "builtin", "nice"]);
/** Commands that only prepare the shell; the next command in the line is the one that runs. */
const SETUP = new Set(["cd", "pushd", "popd", "export", "set", "unset", "source", ".", "ulimit", "umask"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A command word as a program name: its file name, lower case, without `.exe` or a version suffix. */
function programName(word: string): string {
  const file = word.replace(/^[("']+|["')]+$/g, "").split(/[/\\]/).pop()!.toLowerCase().replace(/\.exe$/, "");
  return /^(.*[a-z+])[\d.]+$/.exec(file)?.[1] ?? file;
}

/**
 * The words of the command a shell line runs: the first one that is not
 * shell setup, from its program on.
 */
function commandWords(command: string): string[] | undefined {
  for (const segment of splitShellCommands(command).flatMap((part) => part.split("\n"))) {
    const words = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    let index = 0;
    while (index < words.length && (ASSIGNMENT.test(words[index]!) || PREFIXES.has(words[index]!))) index += 1;
    const word = words[index]?.replace(/^[("']+|["')]+$/g, "");
    if (!word || word.startsWith("#") || SETUP.has(word)) continue;
    return words.slice(index);
  }
  return undefined;
}

/**
 * The program a shell command runs: the first one in the line that is not
 * shell setup, under its file name without a version suffix or `.exe`.
 */
export function commandProgram(command: string): string | undefined {
  const words = commandWords(command);
  return words ? programName(words[0]!) : undefined;
}

/** The icon for a shell command's program, or undefined for one it does not know. */
export const commandIcon = cachedLookup((command: string): string | undefined => {
  const words = commandWords(command);
  if (!words) return undefined;
  const program = programName(words[0]!);
  const next = words.slice(1).find((word) => !word.startsWith("-"));
  if (next && RUNNERS.has(program)) {
    const target = PROGRAM_ICONS[programName(next)];
    if (target) return target;
  }
  const subcommand = next && SUBCOMMAND_ICONS[program]?.[next];
  return subcommand || PROGRAM_ICONS[program];
});
