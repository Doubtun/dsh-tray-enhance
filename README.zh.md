# 托盘菜单增强

[English](./README.md)

为 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）桌面端带来更丰富的 Windows 托盘右键菜单：每项带图标、增加重启入口、检查更新、以及浅色/深色主题子菜单。

## 安装

推荐在 DSH 桌面客户端内安装：

1. 打开侧边栏的 **插件（Plugins）**。
2. 点击 **添加插件**。
3. 输入包名 `dsh-tray-enhance`（或仓库地址 `https://github.com/Doubtun/dsh-tray-enhance`）。
4. 确认安装，然后重启一次 DSH，让托盘代码生效。

也可以在终端安装：

```shell
dsh plugin add dsh-tray-enhance
```

## 菜单

右键点击 DeepSeek Harness 托盘图标后显示：

| 菜单项 | 作用 |
| --- | --- |
| 打开（Open） | 显示并聚焦主窗口。 |
| 重启（Restart） | 重新启动应用，遵循与退出相同的任务确认逻辑。 |
| 检查更新（Check for Updates） | 打开应用自带的更新提示。 |
| 主题 ▸（Theme） | 在浅色、深色、跟随系统之间切换应用外观，与客户端自带的切换按钮同步。 |
| 退出（Exit） | 退出应用，保留原有的运行中/定时任务确认。 |

每项都有独立图标；图标配色始终跟随系统深浅自动切换。

## 设置

插件的设置页有一个选项，改动即时生效、无需重启：

| 设置项 | 可选值 | 作用 |
| --- | --- | --- |
| `language`（菜单语言） | `auto`、`zh`、`en` | 菜单文字语言。`auto` 跟随应用语言；非中文一律回退英文。 |

打开 **插件（Plugins）** 页，找到 **托盘菜单增强**，配置区块位于描述与行列表之间。该值会同步到 `resources/tray-enhance/menu.json`，托盘每次右键时重新读取，所以下次打开菜单即可生效。

## 为什么这个插件要改写外壳

托盘菜单位于桌面端外壳的 Electron 主进程里，而加载插件的 Host 是独立子进程，任何 Host 服务或 IPC 消息都触达不到托盘。因此本插件改为就地修补外壳中的托盘代码，同时保持 `app.asar` 的字节布局不变——因为 `app.asar` 为每个文件记录了 SHA-256，校验不一致时应用会拒绝启动。

被修补的区域只是一小段加载桩；真正的菜单代码写在 `resources/tray-enhance/tray.cjs`，图标 PNG 也放在同一目录。首次应用会把原始代码备份到 `resources/tray-enhance/backup/main.js.orig`。

## 主题子菜单如何作用到应用

主题是 Host 设置（`ui-theme`），外壳进程无法直接写入。点击子菜单会切换 `nativeTheme`（让窗口立即生效），并把请求写入 `resources/tray-enhance/theme-request.json`；本插件的 Host 半身读取后通过 settings 服务落库——与应用内切换外观走同一条路径。上一次运行的旧请求会被忽略，重启不会重复套用旧选择。

## 要求与限制

- 仅限 Windows 桌面端；网页版没有托盘，不受影响。
- 下次启动 DSH 后生效，因为外壳在启动时加载托盘代码。
- 应用更新后会自动重新应用。遇到无法识别的外壳版本会记录并跳过，绝不盲目修补。
- 卸载插件会还原保存的原始外壳代码。

## 命令行

DSH 关闭时也能用同一套逻辑：

```shell
node tools/apply.mjs check
node tools/apply.mjs patch
node tools/apply.mjs restore
```

## 许可

[MIT](./LICENSE)
