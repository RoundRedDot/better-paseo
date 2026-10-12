/**
 * The settings page in English and Chinese.
 *
 * The plugin SDK does not tell a plugin which language Paseo is set to, so
 * "Follow system" reads the device locale; a reader whose Paseo and system
 * languages differ picks one explicitly. Only the settings page is
 * translated: the chat itself shows the model's and the tools' own words.
 */

export type SettingsLanguagePreference = "system" | "en" | "zh";
export type SettingsLanguage = "en" | "zh";

/** The device locale, e.g. `zh-CN`, or null where the runtime exposes none. */
export function systemLanguage(): string | null {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  const fromNavigator = nav?.languages?.[0] ?? nav?.language;
  if (typeof fromNavigator === "string" && fromNavigator) return fromNavigator;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}

/** The language the page is drawn in: an explicit choice, else Chinese for any `zh` locale. */
export function resolveLanguage(
  preference: SettingsLanguagePreference,
  locale: string | null = systemLanguage(),
): SettingsLanguage {
  if (preference !== "system") return preference;
  return locale !== null && /^zh(?:[-_]|$)/i.test(locale) ? "zh" : "en";
}

const en = {
  pageTitle: "Chat presentation",
  pageIntro:
    "Saved on this Paseo host and shared by every client connected to it (desktop, web, iOS, Android). Options a platform cannot draw fall back there.",
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

  sectionAppearance: "Appearance",
  languageTitle: "Language",
  languageDescription:
    "The language of this page. Follow system reads the device's language; plugins cannot see the language Paseo itself is set to.",
  languageSystem: "Follow system",
  languageEnglish: "English",
  languageChinese: "简体中文",
  accentTitle: "Accent colour",
  accentDescription:
    "Follow the Paseo theme, or pick a presentation accent. Only the accent changes; every other colour comes from the theme.",
  accentHost: "Host",
  accentJade: "Jade",
  accentViolet: "Violet",
  accentAmber: "Amber",
  accentRose: "Rose",
  accentOption: (name: string) => `Accent: ${name}`,

  sectionFonts: "Fonts",
  paseoFontsTitle: "Paseo's font settings",
  paseoFontsNative:
    "This Paseo version does not share its font settings with plugins, so Follow Paseo uses Paseo's default monospace: the system monospace face, at 12px.",
  paseoFontsWeb:
    "This Paseo version does not share its font settings with plugins. Until it does, Follow Paseo reads the monospace font and code size from Paseo's Appearance settings on this computer (read only), and otherwise uses Paseo's default monospace: SF Mono, Menlo, Monaco or Consolas, at 12px.",
  monoTitle: "Monospace font",
  monoNative:
    "For code, diffs, terminals and paths. Custom offers only faces this device is known to have, since a missing face would turn code proportional.",
  monoWeb:
    "For code, diffs, terminals and paths. Iosevka Code adds programming ligatures inside code blocks; diffs and terminals stay literal.",
  monoSource: "Monospace source",
  customMono: "Custom monospace family",
  customMonoPlaceholder: "e.g. JetBrains Mono",
  monoFollowingHost: "Following Paseo's font settings",
  monoFollowingAppearance: (family: string | null, size: number) =>
    `Following Paseo appearance: ${family ?? "Paseo's default monospace"}, ${size} px`,
  monoDefaultWeb: (size: number) => `Paseo default: SF Mono, Menlo, Monaco or Consolas, ${size} px`,
  monoDefaultNative: (size: number) => `Paseo default: the system monospace face, ${size} px`,
  codeSizeTitle: "Code font size",
  codeSizeDescription: (min: number, max: number) =>
    `Follow Paseo, or choose ${min}–${max}px for code, diffs, terminals and paths. Line height is 1.5×.`,
  codeSizeSource: "Code font size source",
  codeSizeSmaller: "Smaller code font",
  codeSizeLarger: "Larger code font",
  codeSizeValue: (size: number) => `Code font size ${size} pixels`,
  fontPreview: "Font preview",
  uiFontTitle: "Interface font",
  uiFontNative: "Follow Paseo's interface font, or use the system face.",
  uiFontWeb: "Follow Paseo's interface font, or choose the embedded Inter face or the system face.",

  sectionTools: "Tools and paths",
  toolDetailTitle: "Tool details",
  toolDetailDescription: "Tool calls start as one line. Choose whether a failed call opens on its own.",
  toolDetailCollapsed: "Always collapsed",
  toolDetailExpandFailed: "Open failed calls",
  pathsTitle: "File paths",
  pathsDescription:
    "Relative to the workspace (a worktree's main repository is prefixed with its name), or in full. Copying always gives the absolute path.",
  pathsRelative: "Relative",
  pathsAbsolute: "Absolute",
  rowLabelsTitle: "Row icons and labels",
  rowLabelsDescription:
    "How tool and thought rows show what they are: an icon, a name such as Bash, Read or Thought, or both. Icon only leaves the most width for the command or preview.",
  rowLabelsIcon: "Icon only",
  rowLabelsLabel: "Label only",
  rowLabelsBoth: "Icon and label",
  rowSpacingTitle: "Compact row spacing",
  rowSpacingDescription:
    "Paseo 0.11 leaves 16pt under every row this plugin draws, where its own tool rows sit flush. This takes most of it back. Turn it off if rows overlap on a Paseo that already stacks them.",
  replySpacingTitle: "Compact reply spacing",
  replySpacingDescription:
    "A Paseo issue, not this plugin's: Paseo 0.11 leaves 16pt under a reply this plugin draws, but only 4pt under its own reply when a tool row follows. This takes the extra 12pt back when a tool, thought or todo row comes next; above a prompt or another reply the gap stays. Turn it off once Paseo spaces plugin replies itself, or if a reply overlaps the row below it.",

  sectionMessages: "Messages",
  bubbleTitle: "Enhanced prompt bubble",
  bubbleDescription:
    "Off by default: Paseo's own bubble keeps the rewind menu and image previews, which a plugin cannot reach. On, the plugin's bubble shows the turn's token usage and keeps Copy always visible, but has no rewind and no pasted images. New prompts follow the change.",
  selectionTitle: "Selection actions",
  selectionDescription:
    "Highlighting text in a callout raises a small bar with Copy and Add to chat. Add to chat drops the highlight into the composer as a quote, or a fenced block when it came from code.",
  markdownTitle: "Assistant markdown",
  markdownDescription:
    "Draws the reply with the plugin's own headings, lists and syntax-highlighted code blocks. The plugin cannot reach Paseo's markdown pipeline, so its version is a subset: turn this off for mermaid diagrams, images, and the host's file-path links.",
  markdownStyleTitle: "Markdown style",
  markdownStyleDescription:
    "Document is airy and built for long answers. Compact tightens the spacing for short replies. Terminal sets the body in the code face.",
  markdownDocument: "Document",
  markdownCompact: "Compact",
  markdownTerminal: "Terminal",

  resetDefaults: "Reset defaults",
};

export type SettingsStrings = typeof en;

const zh: SettingsStrings = {
  pageTitle: "聊天展示",
  pageIntro:
    "保存在这台 Paseo 主机上，连接到它的所有客户端（桌面、网页、iOS、Android）共用。某个平台画不出来的选项会在该平台上自动回退。",
  syncFailed: "上一次修改没能保存到这台 Paseo 主机，只在当前客户端生效，直到下一次修改或重新加载。",
  syncInvalid: (error: string) =>
    `这台 Paseo 主机上保存的设置无法读取，当前显示的是默认值。修改任意一项都会覆盖已保存的记录。（${error}）`,
  syncError: (error: string) =>
    `暂时连不上这台 Paseo 主机上保存的设置，当前显示的是最近一次的值；主机恢复响应后会保存你的修改。（${error}）`,
  syncLoading: "正在读取这台 Paseo 主机上保存的设置…",

  followPaseo: "跟随 Paseo",
  custom: "自定义",
  system: "系统",

  sectionAppearance: "外观",
  languageTitle: "语言",
  languageDescription: "本设置页使用的语言。“跟随系统”读取设备的语言；插件无法得知 Paseo 本身设置的语言。",
  languageSystem: "跟随系统",
  languageEnglish: "English",
  languageChinese: "简体中文",
  accentTitle: "强调色",
  accentDescription: "跟随 Paseo 主题，或另选一种展示用的强调色。只改变强调色，其余颜色仍来自主题。",
  accentHost: "主题",
  accentJade: "翠绿",
  accentViolet: "紫罗兰",
  accentAmber: "琥珀",
  accentRose: "玫瑰",
  accentOption: (name: string) => `强调色：${name}`,

  sectionFonts: "字体",
  paseoFontsTitle: "Paseo 的字体设置",
  paseoFontsNative:
    "当前 Paseo 版本不会把字体设置提供给插件，所以“跟随 Paseo”使用 Paseo 的默认等宽字体：系统等宽字体，12px。",
  paseoFontsWeb:
    "当前 Paseo 版本不会把字体设置提供给插件。在那之前，“跟随 Paseo”会从这台电脑上 Paseo 的外观设置里读取等宽字体和代码字号（只读）；读不到时使用 Paseo 的默认等宽字体：SF Mono、Menlo、Monaco 或 Consolas，12px。",
  monoTitle: "等宽字体",
  monoNative: "用于代码、diff、终端和路径。“自定义”只列出这台设备确定有的字体，因为缺失的字体会让代码变成比例字体。",
  monoWeb: "用于代码、diff、终端和路径。Iosevka Code 会在代码块里显示编程连字；diff 和终端仍按原样显示字符。",
  monoSource: "等宽字体来源",
  customMono: "自定义等宽字体",
  customMonoPlaceholder: "例如 JetBrains Mono",
  monoFollowingHost: "正在跟随 Paseo 的字体设置",
  monoFollowingAppearance: (family: string | null, size: number) =>
    `正在跟随 Paseo 外观设置：${family ?? "Paseo 默认等宽字体"}，${size} px`,
  monoDefaultWeb: (size: number) => `Paseo 默认：SF Mono、Menlo、Monaco 或 Consolas，${size} px`,
  monoDefaultNative: (size: number) => `Paseo 默认：系统等宽字体，${size} px`,
  codeSizeTitle: "代码字号",
  codeSizeDescription: (min: number, max: number) =>
    `跟随 Paseo，或为代码、diff、终端和路径选择 ${min}–${max}px。行高为字号的 1.5 倍。`,
  codeSizeSource: "代码字号来源",
  codeSizeSmaller: "减小代码字号",
  codeSizeLarger: "增大代码字号",
  codeSizeValue: (size: number) => `代码字号 ${size} 像素`,
  fontPreview: "字体预览",
  uiFontTitle: "界面字体",
  uiFontNative: "跟随 Paseo 的界面字体，或使用系统字体。",
  uiFontWeb: "跟随 Paseo 的界面字体，或选择内置的 Inter 字体或系统字体。",

  sectionTools: "工具与路径",
  toolDetailTitle: "工具详情",
  toolDetailDescription: "工具调用默认只显示一行。可以选择失败的调用是否自动展开。",
  toolDetailCollapsed: "始终折叠",
  toolDetailExpandFailed: "展开失败的调用",
  pathsTitle: "文件路径",
  pathsDescription: "显示为相对 workspace 的路径（worktree 会在前面加上主仓库的名字），或完整路径。复制时总是得到绝对路径。",
  pathsRelative: "相对",
  pathsAbsolute: "绝对",
  rowLabelsTitle: "行图标与标签",
  rowLabelsDescription: "工具行和思考行用什么表明类型：图标、Bash / Read / Thought 这样的名称，或两者都显示。仅图标时，命令或预览能占用最多宽度。",
  rowLabelsIcon: "仅图标",
  rowLabelsLabel: "仅标签",
  rowLabelsBoth: "图标+标签",
  rowSpacingTitle: "紧凑行距",
  rowSpacingDescription:
    "Paseo 0.11 会在插件绘制的每一行下面留出 16pt，而它自己的工具行之间是紧挨着的。开启后会收回其中大部分。如果在已经修正了这个间距的 Paseo 上出现行重叠，请关闭。",
  replySpacingTitle: "紧凑回复间距",
  replySpacingDescription:
    "这是宿主 Paseo 的问题，不是插件的：Paseo 0.11 会在插件绘制的回复下面留出 16pt，而它自己的回复下面紧跟工具行时只留 4pt。开启后，回复下面紧跟工具、思考或待办行时会收回多出的 12pt；下面是提问或另一条回复时间距不变。等 Paseo 自己修正了插件回复的间距，或者回复和下面的行重叠时，请关闭。",

  sectionMessages: "消息",
  bubbleTitle: "增强的提问气泡",
  bubbleDescription:
    "默认关闭：使用 Paseo 自己的气泡，保留回退菜单和图片预览，这两样插件都拿不到。开启后改用插件的气泡，显示本轮 token 用量、复制按钮常显，但没有回退，也看不到粘贴的图片。之后发送的消息生效。",
  selectionTitle: "选中操作",
  selectionDescription:
    "在卡片里选中文字后会出现一个小工具栏，提供“复制”和“添加到对话”。“添加到对话”会把选中内容以引用的形式放进输入框；如果选自代码，则放成代码块。",
  markdownTitle: "助手回复 Markdown",
  markdownDescription:
    "用插件自己的标题、列表和语法高亮代码块来绘制回复。插件用不了 Paseo 的 Markdown 渲染流程，所以只支持其中一部分：需要 mermaid 图表、图片或 Paseo 的文件路径链接时，请关闭此项。",
  markdownStyleTitle: "Markdown 样式",
  markdownStyleDescription: "“文档”排版舒展，适合长回答；“紧凑”收紧间距，适合短回复；“终端”用代码字体显示正文。",
  markdownDocument: "文档",
  markdownCompact: "紧凑",
  markdownTerminal: "终端",

  resetDefaults: "恢复默认设置",
};

export const SETTINGS_STRINGS: Readonly<Record<SettingsLanguage, SettingsStrings>> = { en, zh };
