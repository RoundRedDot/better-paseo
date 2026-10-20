import { describe, expect, it } from "vitest";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { mcpServiceIcon } from "../../client/tools/mcp-service-icon";
import { MARK_IDS, MONO_MARKS } from "../../client/components/marks";

function call(name: string): ToolCallPayload {
  return { name, status: "completed", detail: { type: "unknown", input: {}, output: "" }, callId: "c1", error: null };
}

describe("mcpServiceIcon", () => {
  it.each([
    ["mcp__linear-server__get_issue", "brand:linear"],
    ["mcp__claude_ai_Linear__get_issue", "brand:linear"],
    ["mcp__sentry__search_issues", "brand:sentry"],
    ["mcp__claude_ai_Figma__get_design_context", "brand:figma"],
    ["mcp__notion__search", "brand:notion"],
    ["mcp__claude_ai_Google_Calendar__list_events", "brand:google-calendar"],
    ["mcp__claude_ai_Gmail__search_threads", "brand:gmail"],
    ["mcp__claude_ai_Google_Drive__search_files", "brand:google-drive"],
    ["mcp__slack__post_message", "brand:slack"],
    ["mcp__feishu__send_message", "brand:feishu"],
    ["mcp__lark-mcp__im_v1_message_create", "brand:feishu"],
    ["mcp__github__get_me", "brand:GitHub"],
    ["mcp__gitlab__get_merge_request", "brand:gitlab"],
    ["mcp__git__git_status", "GitBranch"],
    ["mcp__mcp-server-git__git_log", "GitBranch"],
    ["mcp__filesystem__read_file", "FolderOpen"],
    ["mcp__postgres__query", "brand:postgresql"],
    ["mcp__sqlite__read_query", "Feather"],
    ["mcp__brave-search__brave_web_search", "brand:brave"],
    ["mcp__fetch__fetch", "Globe"],
    ["mcp__puppeteer__puppeteer_navigate", "brand:puppeteer"],
    ["mcp__plugin_playwright_playwright__browser_click", "brand:playwright"],
    ["mcp__memory__create_entities", "BrainCircuit"],
    ["mcp__aws-kb-retrieval__retrieve_from_aws_kb", "brand:aws"],
    ["mcp__perplexity-ask__perplexity_ask", "brand:perplexity"],
    ["mcp__google-maps__maps_geocode", "brand:google-maps"],
    ["mcp__everart__generate_image", "Palette"],
    ["mcp__everything__echo", "Blocks"],
    ["mcp__atlassian__jira_get_issue", "brand:jira"],
    ["mcp__mcp-atlassian__confluence_search", "brand:confluence"],
    ["mcp__jira__search", "brand:jira"],
    ["mcp__jenkins__get_build", "brand:jenkins"],
    ["mcp__gitee__list_repos", "brand:gitee"],
    ["mcp__bitbucket__get_pr", "brand:bitbucket"],
    ["mcp__circleci__get_build_failure_logs", "brand:circleci"],
    ["mcp__sonarqube__issues", "brand:sonarqube"],
    ["mcp__grafana__query_prometheus", "brand:grafana"],
    ["mcp__prometheus__execute_query", "brand:prometheus"],
    ["mcp__datadog__get_logs", "Dog"],
    ["mcp__elasticsearch__search", "brand:elastic"],
    ["mcp__postman__run_collection", "brand:postman"],
    ["mcp__redis__get", "brand:redis"],
    ["mcp__kafka__list_topics", "brand:kafka"],
    ["mcp__dingtalk__send_message", "brand:dingtalk"],
    ["mcp__wecom__send_message", "brand:wecom"],
    ["mcp__ms-teams__post", "brand:teams"],
    ["mcp__zapier__run_action", "brand:zapier"],
    ["mcp__chrome-devtools__take_screenshot", "brand:chrome"],
    ["mcp__claude-in-chrome__navigate", "brand:chrome"],
    ["mcp__plugin_playwright_playwright__browser_click", "brand:playwright"],
    ["mcp__ios-simulator__ui_tap", "Smartphone"],
    ["mcp__XcodeBuildMCP__build_sim", "brand:apple"],
    ["mcp__mobile-mcp__mobile_take_screenshot", "Smartphone"],
    ["mcp__android-mcp__tap", "brand:android"],
    ["mcp__docker__list_containers", "brand:docker"],
    ["mcp__kubernetes__get_pods", "ShipWheel"],
    ["mcp__vercel__deploy", "brand:vercel"],
    ["mcp__cloudflare__workers_list", "brand:cloudflare"],
    ["mcp__supabase__execute_sql", "brand:supabase"],
    ["mcp__stripe__create_customer", "brand:stripe"],
    ["mcp__mongodb__find", "brand:mongodb"],
    ["mcp__paseo__browser_click", "brand:Paseo"],
    ["mcp__plugin_context7_context7__query-docs", "LibraryBig"],
    ["mcp__sequential-thinking__sequentialthinking", "Lightbulb"],
    ["mcp__time__get_current_time", "Clock"],
    ["mcp__tavily__search", "Search"],
    ["mcp__exa__web_search", "Search"],
    ["mcp__firecrawl__scrape", "Globe"],
    ["mcp__cua-driver__click", "MousePointer2"],
    ["linear / get_issue", "brand:linear"],
  ])("%s draws %s", (name, icon) => {
    const { server, tool } = classifyTool(call(name)).mcp!;
    expect(mcpServiceIcon(server, tool)).toBe(icon);
  });

  it("leaves a server it does not know to the plug", () => {
    expect(mcpServiceIcon("devnav")).toBeUndefined();
    expect(mcpServiceIcon("timeline-tools")).toBeUndefined();
  });

  it("only draws marks the daemon serves, tinted like the other row icons", () => {
    for (const name of ["linear", "sentry", "figma", "notion", "google-calendar", "gmail", "google-drive", "slack", "feishu", "gitlab", "postgresql", "brave",
      "puppeteer", "playwright", "perplexity", "aws", "google-maps", "jira", "confluence", "jenkins", "gitee",
      "bitbucket", "circleci", "ansible", "sonarqube", "grafana", "prometheus", "elastic", "postman", "redis", "kafka",
      "trello", "asana", "dingtalk", "wecom", "teams", "discord", "telegram", "zapier", "airtable", "cypress", "storybook", "chrome", "vite", "nextjs", "nuxt",
      "react-native", "angular", "astro", "svelte", "vue", "tailwind", "firebase", "stripe", "django", "laravel", "youtube", "eslint",
      "vim", "netlify", "webpack", "turborepo", "jupyter", "prettier", "heroku", "expo", "vitest", "bun", "nginx"]) {
      expect(MARK_IDS.has(`brand:${name}`)).toBe(true);
      expect(MONO_MARKS.has(`brand:${name}`)).toBe(true);
    }
  });
});
