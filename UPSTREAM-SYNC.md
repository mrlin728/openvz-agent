# Upstream synchronization record

OpenVZ Agent 2.2.0 incorporates MIT-licensed changes from
[xiaoyuanda666-ship-it/BaiLongma](https://github.com/xiaoyuanda666-ship-it/BaiLongma).
The imported baseline is tag `v2.1.549`, commit
`7b9e7b378be5d3e9acc0daed8f0176eb51022b97`.

The upstream ancestry is recorded in Git history with an `ours` merge before
the audited source import. OpenVZ-specific workflow, MCP, encrypted settings,
branding, application identifier and user-data contracts remain maintained in
this repository.

## Included domains

- Modular API, database repositories and runtime loop
- Scene Protocol, SceneStore and Brain UI activity persistence/themes
- Heartbeat controls, long-running tasks, delivery deduplication and action evidence
- Stateful Playwright browser sessions and packaged offline Chromium
- Capability registry, dynamic API slots, local embeddings and software installation
- Image/media attachments, terminal streaming, voice wake/PTT and social media transport
- Weather, typhoon and map surfaces, plus upstream security fixes

## Deliberately excluded upstream files

The following upstream artifacts are not imported or distributed:

- `config.json` and `.dev-test/`
- `scripts/_tmp-feishu-token.mjs`
- Python `__pycache__/` directories and `*.pyc`
- `_tmp_brain_ui_huashu.png`
- precompiled `build/native-speech-recognizer` output
- `music/HedwigsTheme.mp3`

The native speech helper and Playwright Chromium are produced from pinned
dependencies on the target operating system during release builds. No
upstream credentials, developer caches or copyrighted theme music are shipped.

## Compatibility policy

`OPENVZ_*` variables are canonical. Existing `BAILONGMA_*` environment
variables, renderer bridge names, browser reference attributes and WebSocket
subprotocols remain accepted throughout the OpenVZ Agent 2.x line so existing
extensions and user data can migrate without a flag day.

Review this file whenever the BaiLongma baseline advances. Record the new tag,
commit, included feature domains and any additional exclusions before merging.
