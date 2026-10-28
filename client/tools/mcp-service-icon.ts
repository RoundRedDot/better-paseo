import { cachedLookup } from "./lookup-cache";

/**
 * Services whose MCP calls draw the service's icon instead of the plug, by the
 * server name. Claude's connectors add a prefix and keep the case
 * (`claude_ai_Google_Calendar`), and local servers add one too
 * (`mcp-server-git`, `linear-server`), so the name is matched with case and
 * separators dropped. A `brand:*` icon is the service's mark; a service with
 * no mark of its own draws the Lucide icon for what it does.
 */
const MCP_SERVICE_ICONS: readonly (readonly [RegExp, string])[] = [
  [/linear/, "brand:linear"],
  [/sentry/, "brand:sentry"],
  [/figma/, "brand:figma"],
  [/notion/, "brand:notion"],
  [/gmail/, "brand:gmail"],
  [/googlecalendar|gcal/, "brand:google-calendar"],
  [/googledrive|gdrive/, "brand:google-drive"],
  [/googlemaps|gmaps/, "brand:google-maps"],
  [/slack/, "brand:slack"],
  [/feishu|lark/, "brand:feishu"],
  [/github/, "brand:GitHub"],
  [/gitlab/, "brand:gitlab"],
  // Only the whole name: `git` is also the start of `github` and `gitlab`.
  [/^(mcpserver)?git(mcp|server)?$/, "GitBranch"],
  [/postgres/, "brand:postgresql"],
  [/sqlite/, "Feather"],
  [/brave/, "brand:brave"],
  [/puppeteer/, "brand:puppeteer"],
  [/playwright/, "brand:playwright"],
  [/perplexity/, "brand:perplexity"],
  [/aws|bedrock/, "brand:aws"],
  [/filesystem/, "FolderOpen"],
  [/fetch/, "Globe"],
  [/memory/, "BrainCircuit"],
  [/everart/, "Palette"],
  [/everything/, "Blocks"],
  // Development tools. Atlassian's own server covers Jira and Confluence; Jira is the one
  // its calls are mostly about.
  [/confluence/, "brand:confluence"],
  [/jira|atlassian/, "brand:jira"],
  [/jenkins/, "brand:jenkins"],
  [/gitee/, "brand:gitee"],
  [/bitbucket/, "brand:bitbucket"],
  [/circleci/, "brand:circleci"],
  [/ansible/, "brand:ansible"],
  [/sonar/, "brand:sonarqube"],
  [/grafana/, "brand:grafana"],
  [/prometheus/, "brand:prometheus"],
  [/datadog/, "Dog"],
  [/elastic|kibana/, "brand:elastic"],
  [/postman/, "brand:postman"],
  [/redis/, "brand:redis"],
  [/kafka/, "brand:kafka"],
  [/trello/, "brand:trello"],
  [/asana/, "brand:asana"],
  [/dingtalk|dingding/, "brand:dingtalk"],
  [/wecom|wework|wechatwork|qywx/, "brand:wecom"],
  [/teams/, "brand:teams"],
  [/discord/, "brand:discord"],
  [/telegram/, "brand:telegram"],
  [/zapier/, "brand:zapier"],
  [/airtable/, "brand:airtable"],
  // Browsers and devices. Playwright and Puppeteer keep their own marks above.
  [/chrome/, "brand:chrome"],
  [/iossimulator|simulator|simctl|servesim|^mobile/, "Smartphone"],
  [/xcode/, "brand:apple"],
  [/android|adb|andromeld/, "brand:android"],
  [/^(mcpserver)?rea(mcp|server)?$/, "Cpu"],
  [/noderepl/, "brand:nodejs"],
  // Services the shell rows already know, and common utility servers.
  [/docker/, "brand:docker"],
  [/kubernetes|k8s|kubectl/, "ShipWheel"],
  [/terraform/, "brand:terraform"],
  [/vercel/, "brand:vercel"],
  [/cloudflare/, "brand:cloudflare"],
  [/supabase/, "brand:supabase"],
  [/firebase/, "brand:firebase"],
  [/netlify/, "brand:netlify"],
  [/heroku/, "brand:heroku"],
  [/stripe/, "brand:stripe"],
  [/mongo/, "brand:mongodb"],
  [/mysql/, "brand:mysql"],
  [/youtube/, "brand:youtube"],
  [/openai/, "brand:openai"],
  [/^paseo/, "brand:Paseo"],
  [/context7/, "LibraryBig"],
  [/sequentialthinking/, "Lightbulb"],
  [/^(mcpserver)?time(mcp|server)?$/, "Clock"],
  [/tavily|serper|searxng|kagi|^exa/, "Search"],
  [/firecrawl/, "Flame"],
  [/uizze/, "PanelsTopLeft"],
  [/browserbase|browseruse|browsermcp|browsertools|agentbrowser/, "AppWindow"],
  [/desktopcommander/, "SquareTerminal"],
  [/computeruse|cuadriver|cuastudio|^(mcpserver)?lcu(mcp|server)?$/, "MousePointer2"],
];

/**
 * Servers that carry more than one service, where the tool names the one a
 * call is for: Atlassian's server prefixes its Confluence tools
 * (`confluence_search`) and its Jira tools (`jira_get_issue`).
 */
const SHARED_SERVERS: readonly (readonly [RegExp, RegExp, string])[] = [
  [/atlassian/, /^confluence/, "brand:confluence"],
];

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const lookup = cachedLookup((key: string): string | undefined => {
  const [server = "", tool = ""] = key.split("\n").map(normalize);
  const shared = SHARED_SERVERS.find(([host, call]) => host.test(server) && call.test(tool));
  return shared?.[2] ?? MCP_SERVICE_ICONS.find(([pattern]) => pattern.test(server))?.[1];
});

/** The icon for an MCP call, by its server and tool, or undefined for a server it does not know. */
export function mcpServiceIcon(server: string, tool = ""): string | undefined {
  return lookup(`${server}\n${tool}`);
}
