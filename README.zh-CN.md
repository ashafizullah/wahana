<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Wahana icon">
</p>

<h1 align="center">Wahana</h1>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  非官方跨平台 WhatsApp 桌面客户端。直接与手机配对 —— 无需服务器，也不内嵌浏览器。<br>
  多账号同时聊天 —— 支持定时发送、群发、自动回复、动态（Stories）与内置 AI。
</p>

<p align="center">
  <a href="https://github.com/ashafizullah/wahana/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ashafizullah/wahana?display_name=tag&sort=semver"></a>
  <a href="https://github.com/ashafizullah/wahana/actions/workflows/build.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/ashafizullah/wahana/build.yml?label=build"></a>
  <a href="https://github.com/ashafizullah/wahana/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ashafizullah/wahana/total"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white">
</p>

> **Wahana** 在印尼语中意为“交通工具 / 平台”。本项目是非官方客户端，与 WhatsApp 或 Meta 没有任何隶属、背书或关联。“WhatsApp” 是 Meta Platforms, Inc. 的商标。
>
> 使用非官方客户端可能违反 WhatsApp 的服务条款，并可能导致你的号码被封禁，尤其是在进行批量发送或自动回复时。请自行承担风险。

## 下载

从 [Releases 页面](https://github.com/ashafizullah/wahana/releases/latest) 下载最新的 `.dmg`（macOS，Apple Silicon 或 Intel）或 `.msi`（Windows x64）。应用会自动检查并安装已签名的更新。

> macOS：当前构建尚未公证，Gatekeeper 可能提示应用“已损坏，无法打开”。其实并没有损坏 —— 复制到“应用程序”后，在终端执行一次 `xattr -cr /Applications/Wahana.app`，然后正常打开即可。Apple Silicon（M1–M4）选择 `aarch64`，Intel Mac 选择 `x64`。

## 工作原理

Wahana **只是一个客户端**。没有 Wahana 后端、账号或云端。它连接你自己的 WhatsApp 账号，方式与 WhatsApp Web 相同：用手机扫描二维码（或输入配对码）。

账号通过应用内运行的 [whatsapp-rust](https://github.com/oxidezap/whatsapp-rust) 直接连接 WhatsApp —— 没有服务器，也没有内嵌浏览器。每个账号的会话与聊天记录都以 SQLite 保存在你的机器上。消息和媒体始终只在你本机与 WhatsApp 之间传输，本项目无法看到。

可选的 AI 功能需要你自己的 API key：Anthropic 或任意兼容 OpenAI 的接口。请求由应用直接发送给对应服务商。

## 功能

**聊天**

- 使用二维码 / 配对码登录关联账号；同一个选择器管理多个账号，每个账号在磁盘上各自保存会话（可重命名、断开连接、退出登录、移除）
- 聊天记录：关联账号时由手机推送，保存在 SQLite 中；向上滚动时会从手机拉取更早的消息；群组、联系人和频道的名称与头像会自动补全
- WhatsApp 格式、表情、快捷回复（使用 `/shortcut`，支持变量）、链接预览、带媒体缩略图的引用回复
- 收发照片、视频、音频、语音、文档和贴纸（贴纸面板含已保存与最近使用；任意图片可转换为 512×512 WebP），带媒体查看器与保存；可直接粘贴截图发送
- 消息菜单：表情回应、回复、转发、置顶（24 小时 / 7 天 / 30 天，手机上设置的置顶也会显示）、编辑、为所有人删除、为我删除、信息、翻译
- 按类型设置媒体自动加载，未加载时显示模糊占位并可点击加载；磁盘缓存；支持缩放与保存的灯箱
- 已读回执与“正在输入”（遵循隐私设置）、未读角标（列表、标签页、Dock / 托盘）、筛选（未读 / 群组 / 频道）
- 置顶聊天、静音 8 小时 / 1 周 / 永久、草稿、标签（创建、重命名、删除、分配），全部与手机同步
- 聊天内搜索、跳转到置顶消息、无限历史分页、导出为 `.txt` / `.html` / `.json`

**群组与联系人**

- 群组信息：简介、可搜索的成员（头像、名称、号码）、添加 / 移除 / 设为管理员 / 取消管理员
- 入群申请（批准 / 拒绝）、邀请链接、重命名、简介、头像、仅管理员可发言设置、退出群组
- 联系人资料面板；关注频道

**动态（Stories）**

- 查看联系人的更新（标记为已看、自动播放、从未看开始、切换到下一位联系人），发布文字 / 照片 / 视频动态，删除自己的动态

**自动化**

- **定时发送** — 一次性或每天 / 每周 / 每月向聊天、群组、频道或你的动态发送消息，可从任意账号发送（基于 SQLite，带历史记录）
- **群发** — 从任意账号向多个收件人发送同一条消息，带随机间隔、进度、重试和逐条日志
- **自动回复** — 按账号设置规则（私聊 / 群组 / 指定聊天、时段与星期、关键词或正则匹配），以固定文本或遵循你指令的 AI 回复作答；每会话冷却、回复日志、一键暂停

**AI（自带 key）**

- Anthropic（官方 SDK）或任意兼容 OpenAI 的接口（各类 router、Ollama 等）；可选更便宜的“快速模型”处理短任务；全局 persona / 系统提示词在所有功能中生效，一个应用服务多个业务时可按账号覆盖
- 翻译收到的消息与草稿；按会话自动翻译（收到的用你的语言显示，发出的用对方语言）
- 总结聊天或群组（自上次已读 / 今天 / 最近 N 条），或就聊天内容提问
- 输入框内的写作助手（修正语法、正式 / 随意 / 更友好、更短 / 更长、转为列表）与回复建议
- 描述图片或提取其中的文字（OCR）
- 根据简短说明起草群发或动态消息（输入框中的“用 AI 起草”）
- 可选：用你已有的标签自动标记新的私聊（设置 → AI）
- **知识库**（功能 → Knowledge）— 自定义列的表格与自由文本文档，嵌入一次后作为权威事实注入 AI 回复；每条记录可限定给某个账号，或对所有账号共享；嵌入可单独使用不同的接口 / key

**应用**

- 首次启动引导：关联 WhatsApp，无需手动配置
- 系统托盘、桌面通知、键盘快捷键、浅色 / 深色主题
- 隐私微调：是否发送“正在输入”、已读回执（始终 / 回复时 / 手动 / 从不）
- 设置备份与恢复（含自动回复规则、主题、贴纸、账号名称）、自动更新

**尚未支持**：位置、联系人和投票（显示为“不支持的消息”）、通话。

## 开发

前置要求：Node 22+、Rust（通过 [rustup](https://rustup.rs)）、Xcode Command Line Tools（macOS）或 Visual Studio Build Tools + WebView2（Windows）。

```bash
npm install
npm run tauri dev
```

### 检查

```bash
npm run check           # tsc + eslint + prettier --check + 单元测试（vitest）
npm run format          # prettier --write .
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

拉取请求会在 CI 中运行相同的检查（`.github/workflows/ci.yml`）；打 tag 会触发发布构建。

### 构建

```bash
npm run tauri build     # macOS 生成 .dmg / .app，Windows 生成 .msi / .exe
```

### 发布

推送 tag（`git tag v0.2.0 && git push --tags`）。GitHub Actions 会构建 macOS（arm64、x64）与 Windows（x64），为更新包签名，并附带 `latest.json` 发布，供自动更新使用。

签名使用 minisign 密钥对：`npx tauri signer generate -w ~/.tauri/wahana.key`，把公钥填到 `src-tauri/tauri.conf.json → plugins.updater.pubkey`，并添加仓库密钥 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

### 项目结构

```
src/realtime/    定时发送、群发与自动回复的运行器，通知，更新
src/store/       zustand 状态（settings、reactions、pins、drafts 等）与 SQLite 数据层
src/screens/     聊天、动态、功能（Scheduler / Broadcast / Auto-reply / Knowledge / Tweaks / Quick replies）、账号、设置（settings/ = 每个区块一个文件）
                 WhatsAppScreen + whatsapp/ = 配对、信息面板、群组工具、媒体、标签、动态、AI
src/components/  对话框、菜单、媒体、选择器
src/lib/         WhatsApp markdown、AI 客户端、媒体缓存、密钥、备份；nativeWa.ts（命令与事件）、send.ts
src-tauri/       Rust 外壳：钥匙串、媒体缓存、托盘、SQLite 迁移
  whatsapp.rs    基于 whatsapp-rust 的原生客户端：账号、配对、事件、发送、媒体、群组、动态、标签
  whatsapp_db.rs 按账号的 SQLite 聊天存储：chats、messages、媒体密钥、LID ↔ 手机号映射、标签
```

## 许可证

[MIT](LICENSE) © Adam Suchi Hafizullah
