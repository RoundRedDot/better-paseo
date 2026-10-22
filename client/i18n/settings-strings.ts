/**
 * The settings page in English and Chinese.
 *
 * "Follow Paseo" (the "system" preference) follows Paseo's own language (`host-language.ts`): the
 * language set in Paseo's settings, else the device locales the way Paseo
 * reads them. Only the settings page (with the sample turn of its preview)
 * and the names preview toolbar buttons show on hover are translated
 * (`toolbar-strings.ts`): the chat itself shows the model's and the tools'
 * own words.
 */
import { deviceLocales, hostLanguage, isChineseLocale } from "./host-language";

export type SettingsLanguagePreference = "system" | "en" | "zh";
export type SettingsLanguage = "en" | "zh";

/** The device locale, e.g. `zh-CN`, or null where the runtime exposes none. */
export function systemLanguage(): string | null {
  return deviceLocales()[0] ?? null;
}

/**
 * The language the page is drawn in: an explicit choice, else Paseo's
 * language. A `locale` given (tests, a caller that knows it) stands in for
 * Paseo's: Chinese for any `zh` locale.
 */
export function resolveLanguage(preference: SettingsLanguagePreference, locale?: string | null): SettingsLanguage {
  if (preference !== "system") return preference;
  if (locale === undefined) return hostLanguage();
  return isChineseLocale(locale) ? "zh" : "en";
}

const en = {
  /** The screen's title: Paseo's plugin menu item and the page header. */
  screenTitle: "Chat & Tasks settings",
  tabsLabel: "Settings for",
  tabDisplay: "Chat presentation",
  tabTasks: "Tasks board",
  pageTitle: "Chat presentation",
  pageIntro:
    "Saved on this Paseo host and shared by every client connected to it: desktop, web, iOS and Android. An option a platform cannot draw falls back there.",
  syncFailed:
    "Your last change could not be saved to this Paseo host. It applies on this client until the next change or reload.",
  syncInvalid: (error: string) =>
    `The settings stored on this Paseo host could not be read, so the defaults are shown. Changing any setting replaces the stored record. (${error})`,
  syncError: (error: string) =>
    `The settings stored on this Paseo host are unreachable right now; the last known values are shown, and a change is saved once the host answers. (${error})`,
  syncLoading: "Loading the settings stored on this Paseo host…",

  followPaseo: "Follow Paseo",
  custom: "Custom",
  system: "System",

  previewTitle: "Preview",
  previewHintPointer: "A sample turn that follows every change here, with the Read row's hover preview drawn open. Click a row to open it.",
  previewHintTouch: "A sample turn that follows every change here, with the Read row's preview drawn open. Tap a row to open it.",
  previewHintMobile: "The same turn as iOS draws it: a phone's width, the system monospace, and inline code in the colour picked above, without a fill.",
  previewDevice: "Preview for",
  previewDesktop: "Desktop",
  previewMobile: "Mobile",
  previewPanelCaption: "Hover preview of the row above, drawn open:",
  previewShow: "Show preview",
  previewHide: "Hide preview",
  previewPrompt: "Paths in tool rows should be relative to the workspace. Fix it and run the tests.",
  previewThought:
    "Paths are formatted in format-path.ts. Check how the roots are built before changing anything, then run the type check and the path tests.",
  previewLead: "Looking at where paths are formatted first.",
  previewPlanPhase: "Relative paths",
  previewPlanFind: "Find where paths are formatted",
  previewPlanFix: "Fix formatPath",
  previewPlanTest: "Run the type check and the path tests",
  previewReply:
    "Done. Paths in tool rows are now **relative to the workspace**, and copying one still gives the absolute path.\n\n- Fixed the missing `trim()` in `formatPath`\n- Added a test for a path outside the worktree\n\n| Check | Before | After |\n| --- | ---: | ---: |\n| Type check | 1 error | 0 |\n| Path tests | 30 / 31 | 31 / 31 |\n\n```ts\nformatPath(raw, { mode: \"relative\", roots })\n```\n\nThe options are listed under [Settings](https://github.com/RoundRedDot/better-paseo#settings).",

  sectionGeneral: "General",
  languageTitle: "Language",
  languageDescription:
    "For this page, the toolbar tooltips and the Tasks board. Follow Paseo uses the language set in Paseo, or the device's when Paseo follows the system.",
  languageSystem: "Follow Paseo",
  languageEnglish: "English",
  languageChinese: "简体中文",

  sectionAppearance: "Appearance",
  accentTitle: "Accent colour",
  accentDescription: "Only the accent changes; every other colour follows the Paseo theme.",
  accentHost: "Theme",
  accentJade: "Jade",
  accentViolet: "Violet",
  accentAmber: "Amber",
  accentRose: "Rose",
  accentOption: (name: string) => `Accent: ${name}`,
  inlineCodeTitle: "Inline code on mobile",
  inlineCodeDescription: "Text colour of inline code on iOS and Android, where it has no fill. The web keeps its grey chip.",
  inlineCodeGrey: "Dark grey",
  inlineCodeBlue: "Blue",
  inlineCodeViolet: "Violet",
  inlineCodeGreen: "Green",
  inlineCodeCoral: "Coral",
  inlineCodeOption: (name: string) => `Inline code: ${name}`,
  uiFontTitle: "Interface font",
  uiFontDescription: "For row labels, buttons and notes.",

  sectionCode: "Code font",
  paseoFontsNative:
    "This Paseo does not share its font settings with plugins, so Follow Paseo means the system monospace face at 12px.",
  paseoFontsWeb:
    "This Paseo does not share its font settings with plugins. Follow Paseo reads the monospace font and size from Paseo's Appearance settings on this computer, or uses Paseo's default (SF Mono, Menlo, Monaco or Consolas at 12px).",
  monoTitle: "Monospace font",
  monoNative:
    "For code, diffs, terminal output and paths. Custom lists only faces this device is known to have.",
  monoWeb: "For code, diffs, terminal output and paths.",
  monoSource: "Monospace source",
  customMono: "Custom monospace family",
  customMonoPlaceholder: "e.g. JetBrains Mono",
  monoFollowingHost: "Following Paseo's font settings",
  monoFollowingAppearance: (family: string | null, size: number) =>
    `Following Paseo appearance: ${family ?? "Paseo's default monospace"}, ${size} px`,
  monoDefaultWeb: (size: number) => `Paseo default: SF Mono, Menlo, Monaco or Consolas, ${size} px`,
  monoDefaultNative: (size: number) => `Paseo default: the system monospace face, ${size} px`,
  codeSizeTitle: "Code font size",
  codeSizeDescription: (min: number, max: number) => `${min}–${max}px. Lines are 1.5 times the size.`,
  codeSizeSource: "Code font size source",
  codeSizeSmaller: "Smaller code font",
  codeSizeLarger: "Larger code font",
  codeSizeValue: (size: number) => `Code font size ${size} pixels`,
  fontPreview: "Font preview",

  sectionTools: "Tool calls",
  blockSizeTitle: "Block text size",
  blockSizeDescription: (min: number, max: number) =>
    `${min}–${max}px for tool rows, thoughts, checklists and notices. Text inside those blocks grows with it. Code, diffs and terminal output keep the code font size.`,
  blockSizeSmaller: "Smaller block text",
  blockSizeLarger: "Larger block text",
  blockSizeValue: (size: number) => `Block text size ${size} pixels`,
  rowLabelsTitle: "Row icons and labels",
  rowLabelsDescription:
    "What a tool or thought row starts with: an icon, a name such as Bash or Read, or both. Icon only leaves the most room for the command or path.",
  rowLabelsIcon: "Icon",
  rowLabelsLabel: "Label",
  rowLabelsBoth: "Both",
  toolDetailTitle: "Open failed calls",
  toolCallRollupsTitle: "Tool call rollups",
  toolCallRollupsDescription: "Fold all consecutive tool calls into an expandable summary between messages, with running and failed counts. Expand to inspect every call.",
  toolDetailDescription: "On, a failed call opens to show its error. A call you opened or closed yourself keeps your choice.",
  pathsTitle: "File paths",
  pathsDescription:
    "Relative paths start at the workspace; a worktree's main repository is shown by name. Copying always gives the absolute path.",
  pathsRelative: "Relative",
  pathsAbsolute: "Absolute",

  sectionSpacing: "Spacing",
  rowSpacingTitle: "Tight rows",
  rowSpacingDescription:
    "Reduces the gap under a plugin row from 16pt to 4pt when another row follows. Rows Paseo already stacks are left alone. Turn it off if rows overlap.",
  replySpacingTitle: "Tight reply",
  replySpacingDescription:
    "Reduces the gap from 16pt to 4pt when a finished reply is followed by a plugin row, including a checklist. Turn it off if they overlap.",

  sectionMessages: "Messages",
  bubbleTitle: "Enhanced prompt bubble",
  bubbleDescription:
    "Shows the turn's token usage and keeps Copy visible. Pasted images it can read are drawn; prompts with other attachments stay with Paseo. Changing it updates existing prompts too. Rewind stays wherever this Paseo provides it.",
  markdownTitle: "Plugin markdown for replies",
  markdownDescription:
    "Headings, lists and highlighted code blocks drawn by the plugin. It has no mermaid diagrams, images or Paseo's file-path links; turn it off when a reply needs them.",
  markdownStyleTitle: "Markdown style",
  markdownStyleDescription:
    "Document is airy, for long answers. Compact is tighter, for short ones. Terminal sets the text in the code font.",
  markdownDocument: "Document",
  markdownCompact: "Compact",
  markdownTerminal: "Terminal",
  selectionTitle: "Selection toolbar",
  selectionDescription:
    "Selecting text in a card shows Copy and Add to chat. Add to chat quotes the selection in the composer, or fences it when it came from code.",

  sectionPreview: "Hover previews",
  hoverPreviewTitle: "Hover previews",
  hoverPreviewDescription:
    "Rest the pointer on a collapsed row or a file path on desktop, or long-press a collapsed row on a phone, to see its content.",
  blockDetailsTitle: "Block details panel (preview)",
  blockDetailsDescription: "Tap a row to read it in a drawer or panel; long-press shows actions.",
  hoverDelayTitle: "Delay",
  hoverDelayDescription: (min: number, max: number) =>
    `Seconds the pointer rests on a row before its preview opens on desktop, ${min}–${max}.`,
  hoverDelayUnit: "seconds",
  previewWrapTitle: "Wrap lines",
  previewWrapDescription:
    "Off, long lines keep their length and the preview scrolls sideways. The button at the left of a preview's toolbar switches it for that preview.",
  previewLineNumbersTitle: "Line numbers",
  previewLineNumbersDescription: "Beside a file, diff or command output. A diff shows the file's own line numbers.",
  previewStripesTitle: "Alternating line shading",
  previewStripesDescription: "Shades every other line, so a wrapped line is easy to follow.",

  resetDefaults: "Reset all settings",
  resetConfirm: "Press again to reset",
  resetDescription: "Puts every option on this page back to its default, on every client of this host.",
};

export type SettingsStrings = typeof en;

const zh: SettingsStrings = {
  screenTitle: "聊天与任务设置",
  tabsLabel: "设置项",
  tabDisplay: "聊天展示",
  tabTasks: "任务看板",
  pageTitle: "聊天展示",
  pageIntro: "保存在这台 Paseo 主机上，连接它的桌面、网页、iOS 和 Android 客户端共用。某个平台不支持的选项会在该平台自动回退。",
  syncFailed: "上一次修改没能保存到这台 Paseo 主机，只在当前客户端生效，直到下一次修改或重新加载。",
  syncInvalid: (error: string) =>
    `这台 Paseo 主机上保存的设置无法读取，当前显示的是默认值。修改任意一项都会覆盖已保存的记录。（${error}）`,
  syncError: (error: string) =>
    `暂时连不上这台 Paseo 主机上保存的设置，当前显示的是最近一次的值；主机恢复响应后会保存你的修改。（${error}）`,
  syncLoading: "正在读取这台 Paseo 主机上保存的设置…",

  followPaseo: "跟随 Paseo",
  custom: "自定义",
  system: "系统",

  previewTitle: "效果预览",
  previewHintPointer: "一段示例对话，随这里的设置实时变化；Read 行的悬停预览常驻展开。点击行可展开。",
  previewHintTouch: "一段示例对话，随这里的设置实时变化；Read 行的预览常驻展开。点按行可展开。",
  previewHintMobile: "同一段对话按 iOS 的样子绘制：手机宽度、系统等宽字体，行内代码没有底色、使用上面选的颜色。",
  previewDevice: "预览端",
  previewDesktop: "桌面端",
  previewMobile: "移动端",
  previewPanelCaption: "上面这一行的悬停预览（常驻展开）：",
  previewShow: "显示预览",
  previewHide: "收起预览",
  previewPrompt: "工具行里的路径应该相对于工作区显示。帮我改一下，然后跑测试。",
  previewThought:
    "路径在 format-path.ts 里格式化。先看清根目录是怎么算出来的，再改代码，最后跑类型检查和路径相关的测试。",
  previewLead: "先看看路径是在哪里格式化的。",
  previewPlanPhase: "相对路径",
  previewPlanFind: "找到路径格式化的位置",
  previewPlanFix: "修复 formatPath",
  previewPlanTest: "跑类型检查和路径测试",
  previewReply:
    "改好了。工具行里的路径现在**相对于工作区**显示，复制时仍然是绝对路径。\n\n- 补上了 `formatPath` 里漏掉的 `trim()`\n- 为 worktree 之外的路径补了测试\n\n| 检查 | 修改前 | 修改后 |\n| --- | ---: | ---: |\n| 类型检查 | 1 个错误 | 0 |\n| 路径测试 | 30 / 31 | 31 / 31 |\n\n```ts\nformatPath(raw, { mode: \"relative\", roots })\n```\n\n各项选项的说明见 [设置文档](https://github.com/RoundRedDot/better-paseo/blob/main/README-zh.md#设置)。",

  sectionGeneral: "通用",
  languageTitle: "语言",
  languageDescription: "本页、工具栏提示和任务看板使用的语言。“跟随 Paseo”使用 Paseo 里设置的语言；Paseo 跟随系统时按设备语言判断。",
  languageSystem: "跟随 Paseo",
  languageEnglish: "English",
  languageChinese: "简体中文",

  sectionAppearance: "外观",
  accentTitle: "强调色",
  accentDescription: "只替换强调色，其余颜色跟随 Paseo 主题。",
  accentHost: "主题",
  accentJade: "翠绿",
  accentViolet: "紫罗兰",
  accentAmber: "琥珀",
  accentRose: "玫瑰",
  accentOption: (name: string) => `强调色：${name}`,
  inlineCodeTitle: "移动端行内代码",
  inlineCodeDescription: "iOS 和 Android 上行内代码没有底色，用文字颜色区分；网页端保留灰色底块。",
  inlineCodeGrey: "深灰",
  inlineCodeBlue: "蓝",
  inlineCodeViolet: "紫",
  inlineCodeGreen: "绿",
  inlineCodeCoral: "珊瑚红",
  inlineCodeOption: (name: string) => `行内代码：${name}`,
  uiFontTitle: "界面字体",
  uiFontDescription: "用于行标题、按钮和说明文字。",

  sectionCode: "代码字体",
  paseoFontsNative: "当前 Paseo 不向插件提供字体设置，“跟随 Paseo”即系统等宽字体，12px。",
  paseoFontsWeb:
    "当前 Paseo 不向插件提供字体设置。“跟随 Paseo”会读取这台电脑上 Paseo 外观设置里的等宽字体和字号，读不到时使用 Paseo 默认值（SF Mono、Menlo、Monaco 或 Consolas，12px）。",
  monoTitle: "等宽字体",
  monoNative: "用于代码、diff、终端输出和路径。“自定义”只列出这台设备确定已安装的字体。",
  monoWeb: "用于代码、diff、终端输出和路径。",
  monoSource: "等宽字体来源",
  customMono: "自定义等宽字体",
  customMonoPlaceholder: "例如 JetBrains Mono",
  monoFollowingHost: "正在跟随 Paseo 的字体设置",
  monoFollowingAppearance: (family: string | null, size: number) =>
    `正在跟随 Paseo 外观设置：${family ?? "Paseo 默认等宽字体"}，${size} px`,
  monoDefaultWeb: (size: number) => `Paseo 默认：SF Mono、Menlo、Monaco 或 Consolas，${size} px`,
  monoDefaultNative: (size: number) => `Paseo 默认：系统等宽字体，${size} px`,
  codeSizeTitle: "代码字号",
  codeSizeDescription: (min: number, max: number) => `${min}–${max}px，行高为字号的 1.5 倍。`,
  codeSizeSource: "代码字号来源",
  codeSizeSmaller: "减小代码字号",
  codeSizeLarger: "增大代码字号",
  codeSizeValue: (size: number) => `代码字号 ${size} 像素`,
  fontPreview: "字体预览",

  sectionTools: "工具调用",
  blockSizeTitle: "块字号",
  blockSizeDescription: (min: number, max: number) =>
    `${min}–${max}px，用于工具行、思考、待办和提示。这些块里的文字一起变化。代码、diff 和终端输出仍用代码字号。`,
  blockSizeSmaller: "减小块字号",
  blockSizeLarger: "增大块字号",
  blockSizeValue: (size: number) => `块字号 ${size} 像素`,
  rowLabelsTitle: "行首标识",
  rowLabelsDescription: "工具行和思考行开头显示图标、名称（如 Bash、Read），或两者都显示。只显示图标时，命令和路径能占用最多宽度。",
  rowLabelsIcon: "图标",
  rowLabelsLabel: "名称",
  rowLabelsBoth: "两者",
  toolDetailTitle: "自动展开失败的调用",
  toolCallRollupsTitle: "合并工具调用",
  toolCallRollupsDescription: "将消息之间所有连续的工具调用折叠为可展开的摘要，并显示运行中和失败的数量。展开可查看每次调用。",
  toolDetailDescription: "开启后，失败的调用会自动展开并显示错误；你手动展开或折叠过的调用保持原样。",
  pathsTitle: "文件路径",
  pathsDescription: "相对路径从工作区算起，worktree 的主仓库以名称显示。复制时总是得到绝对路径。",
  pathsRelative: "相对",
  pathsAbsolute: "绝对",

  sectionSpacing: "间距",
  rowSpacingTitle: "紧凑行距",
  rowSpacingDescription: "插件行后面还有一行时，下方间距从 16pt 缩到 4pt；Paseo 已经把插件行紧挨着排好时，不再额外收紧。行间重叠时请关闭。",
  replySpacingTitle: "紧凑回复间距",
  replySpacingDescription: "已完成的回复后紧跟插件行（包括待办行）时，把间距从 16pt 缩到 4pt。重叠时请关闭。",

  sectionMessages: "消息",
  bubbleTitle: "增强提问气泡",
  bubbleDescription: "显示本轮 token 用量，复制按钮常驻；能读取的粘贴图片会一并显示，其他附件仍交给 Paseo。切换后已有的提问也会更新。回退菜单按当前 Paseo 提供的方式显示。",
  markdownTitle: "回复使用插件 Markdown",
  markdownDescription: "由插件绘制标题、列表和语法高亮代码块。不支持 mermaid 图表、图片和 Paseo 的文件路径链接，需要时请关闭。",
  markdownStyleTitle: "Markdown 样式",
  markdownStyleDescription: "“文档”排版舒展，适合长回答；“紧凑”间距更小，适合短回复；“终端”正文使用代码字体。",
  markdownDocument: "文档",
  markdownCompact: "紧凑",
  markdownTerminal: "终端",
  selectionTitle: "选中文字工具栏",
  selectionDescription: "在卡片里选中文字后显示“复制”和“添加到对话”。添加到对话会把选中内容作为引用放进输入框，选自代码时放成代码块。",

  sectionPreview: "悬停预览",
  hoverPreviewTitle: "悬停预览",
  hoverPreviewDescription: "桌面端鼠标停在折叠行或文件路径上、手机上长按折叠行时，弹出内容预览。",
  blockDetailsTitle: "区块详情面板（预览）",
  blockDetailsDescription: "点按行可在抽屉或面板中阅读；长按可显示操作。",
  hoverDelayTitle: "延迟",
  hoverDelayDescription: (min: number, max: number) => `桌面端鼠标在行上停留多少秒后弹出预览，可填 ${min}–${max}。`,
  hoverDelayUnit: "秒",
  previewWrapTitle: "自动换行",
  previewWrapDescription: "关闭后长行保持原样，预览可以横向滚动。预览工具栏左侧的按钮可临时切换当前预览。",
  previewLineNumbersTitle: "显示行号",
  previewLineNumbersDescription: "在文件、diff 和命令输出左侧显示行号；diff 显示的是文件中的行号。",
  previewStripesTitle: "奇偶行底色",
  previewStripesDescription: "隔行加一层底色，长行折行后也容易分清是哪一行。",

  resetDefaults: "恢复全部默认设置",
  resetConfirm: "再点一次确认恢复",
  resetDescription: "把本页所有选项恢复为默认值，这台主机的所有客户端都会生效。",
};

export const SETTINGS_STRINGS: Readonly<Record<SettingsLanguage, SettingsStrings>> = { en, zh };
