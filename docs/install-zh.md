# 安装指南

[English](install.md) | **简体中文**

[← 返回 README](../README-zh.md)

## 插件市场安装

```bash
paseo plugin install roundreddot/better-paseo
```

需要 Paseo `>=0.14.0`，文中的性能测量基于 Paseo 0.13.0。版本要求见[兼容性](limitations-zh.md#兼容性)。在 **设置 → 插件 → Better Paseo**（页面标题为 **设置**）中配置。上面的命令经插件市场安装：市场钉住本仓库一个审核过的修订，并在安装时构建客户端。更新跟随这个钉住的修订，不跟随默认分支：

```bash
paseo plugin update better-paseo        # 列出更新并询问
paseo plugin update better-paseo --yes  # 不询问，直接更新
```

## Git 源安装

想直接运行仓库的默认分支，把市场安装换成 Git 源。同一个插件 ID 只能有一个来源，要先移除；移除也会删掉这个插件已保存的设置，请先记下要保留的设置，装好后再配：

```bash
paseo plugin remove better-paseo
paseo plugin install github:RoundRedDot/better-paseo
```

Git 源跟随仓库的默认分支（`main`），之后同一条 `paseo plugin update` 就能拿到推送的提交。
